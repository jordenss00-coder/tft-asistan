const path = require('path');
const { app, desktopCapturer, screen, nativeImage } = require('electron');

// Yalnızca oyuncunun kendi ekranındaki bilgiler (altın, seviye, stage, can, kendi dükkanı) okunur;
// görüntüler bilgisayarda işlenir, hiçbir yere gönderilmez.

// TFT penceresinin adı sondaki boşluklarla birlikte "TFT  " şeklinde gelir.
const GAME_WINDOW_RE = /^\s*TFT\s*$/i;

// Gerçek bir TFT penceresi görüntüsünden (1859×1080, pencereli mod) çıkarılan konumlar (0-1 oranı).
// Kenarlıksız modda veya farklı arayüz ölçeğinde kayabilir; Ayarlar'dan kalibrasyon önerilir.
const DEFAULT_REGIONS = {
  stage: { x: 0.397, y: 0.035, w: 0.024, h: 0.026 },
  level: { x: 0.182, y: 0.817, w: 0.035, h: 0.024 },
  gold: { x: 0.534, y: 0.820, w: 0.038, h: 0.022 },
  hp: null,
  // Sol taraftaki trait paneli (aktif özellikler ve sayıları) ve sağdaki oyuncu listesi (isim + can)
  traits: { x: 0.054, y: 0.250, w: 0.086, h: 0.269 },
  players: { x: 0.790, y: 0.190, w: 0.210, h: 0.580 },
  shop: [0, 1, 2, 3, 4].map((i) => ({ x: 0.287 + i * 0.106, y: 0.960, w: 0.075, h: 0.030 })),
};

let workersPromise = null;

function resourcePath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', '..', '..', 'resources', ...parts);
}

// Paketli uygulamada worker dosyaları arşiv dışına (app.asar.unpacked) çıkarılır.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function getWorkers() {
  if (!workersPromise) {
    workersPromise = (async () => {
      const { createWorker, PSM, OEM } = require('tesseract.js');
      const options = {
        langPath: resourcePath('tessdata'),
        cachePath: path.join(app.getPath('userData'), 'tessdata-cache'),
        cacheMethod: 'none',
        gzip: false,
      };
      try {
        options.workerPath = unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js'));
      } catch { /* varsayılan worker yolu */ }
      const digits = await createWorker('eng', OEM.LSTM_ONLY, options);
      await digits.setParameters({ tessedit_char_whitelist: '0123456789-', tessedit_pageseg_mode: PSM.SINGLE_LINE });
      // Tek haneli değerler (seviye gibi) için tek kelime modunda ayrı bir worker
      const word = await createWorker('eng', OEM.LSTM_ONLY, options);
      await word.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_WORD });
      const text = await createWorker('tur', OEM.LSTM_ONLY, options);
      await text.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
      // Çok satırlı paneller (trait listesi, oyuncu listesi) için blok modu
      const block = await createWorker('tur', OEM.LSTM_ONLY, options);
      await block.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return { digits, word, text, block };
    })().catch((e) => {
      workersPromise = null;
      throw e;
    });
  }
  return workersPromise;
}

async function capture() {
  const display = screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize, fetchWindowIcons: false });
  const game = sources.find((s) => GAME_WINDOW_RE.test(s.name));
  const src = game || sources.find((s) => s.id.startsWith('screen:'));
  if (!src || src.thumbnail.isEmpty()) {
    throw new Error('Ekran görüntüsü alınamadı. Oyun tam ekran moddaysa Kenarlıksız moda geç.');
  }
  return { image: src.thumbnail, source: game ? 'game' : 'screen', size: src.thumbnail.getSize() };
}

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * Bölgeyi kırpar, büyütür ve açık renkli oyun yazısını beyaz zemin üzerinde koyu hale getirir.
 * binarize=false: siyah-beyaz yerine ters çevrilmiş gri ton (kalın rakamlarda halkalar kapanmasın diye).
 */
function preprocess(image, r, { scale = 3, binarize = true } = {}) {
  const { width, height } = image.getSize();
  const x = clampInt(r.x * width, 0, width - 4);
  const y = clampInt(r.y * height, 0, height - 4);
  const rect = { x, y, width: clampInt(r.w * width, 4, width - x), height: clampInt(r.h * height, 4, height - y) };
  const scaled = image.crop(rect).resize({ width: rect.width * scale, height: rect.height * scale, quality: 'best' });
  const size = scaled.getSize();
  const bmp = scaled.toBitmap();
  const lum = new Float32Array(size.width * size.height);
  let sum = 0;
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    lum[p] = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
    sum += lum[p];
  }
  const mean = sum / lum.length;
  const threshold = mean + (255 - mean) * 0.35;
  // Yazının etrafına beyaz boşluk: OCR tek haneli ve kenara yapışık metinleri çok daha iyi tanır.
  const pad = 16;
  const outW = size.width + pad * 2;
  const outH = size.height + pad * 2;
  const out = Buffer.alloc(outW * outH * 4, 255);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const l = lum[y * size.width + x];
      const v = binarize ? (l > threshold ? 0 : 255) : Math.max(0, Math.min(255, Math.round(255 - l)));
      const i = ((y + pad) * outW + (x + pad)) * 4;
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(out, { width: outW, height: outH }).toPNG();
}

// Aksanları sadeleştirir (êŁßruž → elssruz) ki OCR'ın bozuk okuduğu isimler de eşleşebilsin.
const normName = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/ß/gi, 'ss')
  .replace(/[łŁ]/g, 'l')
  .replace(/[đĐ]/g, 'd')
  .replace(/[øØ]/g, 'o')
  .toLocaleLowerCase('tr')
  .replace(/[^a-zçğıöşü]/g, '');

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function fuzzyMatch(text, candidates, { minLength = 3, threshold = 0.6 } = {}) {
  const q = normName(text);
  if (q.length < minLength) return null;
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const n = normName(c.name);
    if (!n) continue;
    const score = 1 - levenshtein(q, n) / Math.max(q.length, n.length);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= threshold ? { ...best, score: bestScore } : null;
}

/** Sol paneldeki "3 Alev" gibi satırlardan aktif trait'leri ve sayılarını çıkarır. */
function parseTraits(text, S) {
  const candidates = S.traits.map((t) => ({ id: t.apiName, name: t.name }));
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split('\n')) {
    const clean = line.trim();
    // Kademe satırları ("2 > 3 > 5 > 7") ve boş satırlar atlanır.
    if (!clean || clean.includes('>') || !/[a-zçğıöşü]/i.test(clean)) continue;
    const m = clean.match(/^\s*([0-9]{1,2}|[IiLl|!])?\s*(.+)$/);
    if (!m) continue;
    // Kısa adlarda (Alev, Fey) neredeyse birebir eşleşme istenir; uzun adlarda OCR hatasına tolerans tanınır.
    const hit = fuzzyMatch(m[2], candidates, { minLength: 3, threshold: normName(m[2]).length <= 4 ? 0.85 : 0.7 });
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    const count = /^\d+$/.test(m[1] || '') ? Number(m[1]) : 1;
    out.push({ apiName: hit.id, name: hit.name, count: Math.min(11, Math.max(1, count)) });
  }
  return out;
}

/** Sağdaki oyuncu listesinden kendi canını bulur (hesap adıyla eşleştirerek). */
function parseOwnHp(text, ownName) {
  if (!ownName) return null;
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const target = normName(ownName);
  if (target.length < 3) return null;
  for (let i = 0; i < lines.length; i++) {
    const nameOnly = lines[i].replace(/\d+/g, '');
    const n = normName(nameOnly);
    if (!n) continue;
    const score = 1 - levenshtein(target, n) / Math.max(target.length, n.length);
    if (score < 0.55) continue;
    for (const candidate of [lines[i], lines[i + 1], lines[i - 1]]) {
      const hp = String(candidate || '').match(/\b(\d{1,3})\b/);
      if (hp && Number(hp[1]) >= 1 && Number(hp[1]) <= 100) return Number(hp[1]);
    }
  }
  return null;
}

function matchChampion(text, S) {
  const q = normName(text);
  if (q.length < 3) return null;
  let best = null;
  let bestScore = 0;
  const seen = new Set();
  for (const c of S.champions) {
    if (seen.has(c.baseName)) continue;
    seen.add(c.baseName);
    const n = normName(c.baseName);
    const score = 1 - levenshtein(q, n) / Math.max(q.length, n.length);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.6 ? best.apiName : null;
}

/** Görüntüden oyuncunun kendi değerlerini okur. Güveni düşük değerler null döner. */
async function read(image, regions, S, { ownName = null } = {}) {
  const { digits, word, text, block } = await getWorkers();
  const out = { at: Date.now(), raw: {}, confidence: {}, shop: [] };

  const recognize = async (worker, key, png) => {
    const { data } = await worker.recognize(png);
    out.raw[key] = data.text.replace(/\s+/g, ' ').trim();
    out.confidence[key] = Math.round(data.confidence);
    return data;
  };

  const number = async (key, lo, hi, { textFirst = false } = {}) => {
    if (!regions[key]) return null;
    const png = preprocess(image, regions[key]);
    // Seviye gibi alanlarda rakam, yazının içindedir ("3. Svy"); metin modu bu yazı tipinde çok daha başarılı.
    if (textFirst) {
      const textData = await recognize(text, key, png);
      const hit = out.raw[key].match(/(\d{1,2})/);
      if (hit && textData.confidence >= 50) {
        const value = Number(hit[1]);
        if (value >= lo && value <= hi) return value;
      }
    }
    let data = await recognize(digits, key, png);
    let m = out.raw[key].match(/(\d{1,3})/);
    if (!m || data.confidence < 50) {
      data = await recognize(word, key, png);
      m = out.raw[key].match(/(\d{1,3})/);
    }
    if (!m || data.confidence < 50) {
      data = await recognize(word, key, preprocess(image, regions[key], { scale: 4, binarize: false }));
      m = out.raw[key].match(/(\d{1,3})/);
    }
    if (!m || data.confidence < 50) return null;
    const v = Number(m[1]);
    return v >= lo && v <= hi ? v : null;
  };

  out.gold = await number('gold', 0, 999);
  out.level = await number('level', 1, 10, { textFirst: true });
  out.hp = await number('hp', 0, 100);

  out.stage = null;
  if (regions.stage) {
    const data = await recognize(digits, 'stage', preprocess(image, regions.stage));
    // "3-2" kalıbı tek başına güçlü bir kanıt olduğundan burada düşük güven eşiği yeterli.
    const m = out.raw.stage.replace(/\s/g, '').match(/([1-7])-([1-7])/);
    if (m && data.confidence >= 25) out.stage = `${m[1]}-${m[2]}`;
  }

  out.traits = [];
  if (regions.traits) {
    const data = await block.recognize(preprocess(image, regions.traits, { scale: 3 }));
    out.raw.traits = data.data.text.replace(/\n+/g, ' | ').trim();
    out.confidence.traits = Math.round(data.data.confidence);
    out.traits = parseTraits(data.data.text, S);
  }

  if (regions.players && ownName && out.hp == null) {
    const data = await block.recognize(preprocess(image, regions.players, { scale: 2 }));
    out.raw.players = data.data.text.replace(/\n+/g, ' | ').trim();
    out.confidence.players = Math.round(data.data.confidence);
    out.hp = parseOwnHp(data.data.text, ownName);
  }

  for (let i = 0; i < (regions.shop || []).length; i++) {
    if (!regions.shop[i]) { out.shop.push(null); continue; }
    await recognize(text, `shop${i}`, preprocess(image, regions.shop[i]));
    out.shop.push(matchChampion(out.raw[`shop${i}`], S));
  }
  return out;
}

async function shutdown() {
  if (!workersPromise) return;
  const w = await workersPromise.catch(() => null);
  workersPromise = null;
  await Promise.all([w?.digits, w?.word, w?.text, w?.block].filter(Boolean).map((x) => x.terminate())).catch(() => {});
}

module.exports = { DEFAULT_REGIONS, capture, read, shutdown, matchChampion, parseTraits, parseOwnHp };
