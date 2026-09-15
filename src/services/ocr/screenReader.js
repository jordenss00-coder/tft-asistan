const path = require('path');
const { app, desktopCapturer, screen, nativeImage } = require('electron');

// Yalnızca oyuncunun kendi ekranındaki bilgiler (altın, seviye, stage, can, kendi dükkanı) okunur;
// görüntüler bilgisayarda işlenir, hiçbir yere gönderilmez.

const GAME_WINDOW_RE = /League of Legends \(TM\) Client/i;

// 1920×1080 ve varsayılan arayüz ölçeği için yaklaşık konumlar (0-1 oranı). Kalibrasyon önerilir.
const DEFAULT_REGIONS = {
  stage: { x: 0.405, y: 0.004, w: 0.05, h: 0.03 },
  level: { x: 0.155, y: 0.808, w: 0.07, h: 0.03 },
  gold: { x: 0.475, y: 0.808, w: 0.05, h: 0.03 },
  hp: null,
  shop: [0, 1, 2, 3, 4].map((i) => ({ x: 0.26 + i * 0.1055, y: 0.955, w: 0.075, h: 0.03 })),
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
      return { digits, word, text };
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

const normName = (s) => String(s || '').toLocaleLowerCase('tr').replace(/[^a-zçğıöşü]/g, '');

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
async function read(image, regions, S) {
  const { digits, word, text } = await getWorkers();
  const out = { at: Date.now(), raw: {}, confidence: {}, shop: [] };

  const recognize = async (worker, key, png) => {
    const { data } = await worker.recognize(png);
    out.raw[key] = data.text.replace(/\s+/g, ' ').trim();
    out.confidence[key] = Math.round(data.confidence);
    return data;
  };

  const number = async (key, lo, hi) => {
    if (!regions[key]) return null;
    const png = preprocess(image, regions[key]);
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
  out.level = await number('level', 1, 10);
  out.hp = await number('hp', 0, 100);

  out.stage = null;
  if (regions.stage) {
    const data = await recognize(digits, 'stage', preprocess(image, regions.stage));
    const m = out.raw.stage.replace(/\s/g, '').match(/([1-7])-([1-7])/);
    if (m && data.confidence >= 50) out.stage = `${m[1]}-${m[2]}`;
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
  await Promise.all([w?.digits, w?.word, w?.text].filter(Boolean).map((x) => x.terminate())).catch(() => {});
}

module.exports = { DEFAULT_REGIONS, capture, read, shutdown, matchChampion };
