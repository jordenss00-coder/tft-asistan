const { computeTraits } = require('../traits');

const TIER_SCORE = { OP: 5, 'S+': 4.5, S: 4, A: 3, B: 2, C: 1, D: 0.5 };

function tierScore(tier) {
  if (tier == null) return null;
  return TIER_SCORE[String(tier).toUpperCase().trim()] ?? null;
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Sayfa verisi bulunamadı (site yapısı değişmiş olabilir).');
  return JSON.parse(m[1]);
}

/** SvelteKit'in "devalue" biçimindeki sayfa verisini düz nesneye çevirir. */
function devalue(arr) {
  const seen = new Map();
  const hydrate = (i) => {
    if (i < 0) return undefined;
    if (seen.has(i)) return seen.get(i);
    const v = arr[i];
    if (v === null || typeof v !== 'object') { seen.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && ['Date', 'Set', 'Map', 'BigInt', 'RegExp', 'Object'].includes(v[0])) {
        const r = v[0] === 'Date' ? v[1] : v[1];
        seen.set(i, r);
        return r;
      }
      const out = [];
      seen.set(i, out);
      for (const x of v) out.push(hydrate(x));
      return out;
    }
    const o = {};
    seen.set(i, o);
    for (const [k, x] of Object.entries(v)) o[k] = hydrate(x);
    return o;
  };
  return hydrate(0);
}

/** İstatistik kaynakları için ortalama sıralamaya göre göreli tier (S: ilk %15). */
function percentileTiers(entries, minCount = 150) {
  const q = entries.filter((e) => e.avg != null && (e.count || 0) >= minCount).sort((a, b) => a.avg - b.avg);
  q.forEach((e, i) => {
    const p = i / q.length;
    e.tier = p < 0.15 ? 'S' : p < 0.4 ? 'A' : p < 0.7 ? 'B' : 'C';
  });
  for (const e of entries) if (!e.tier) e.tier = 'D';
}

function nameFromUnits(units, carries, S) {
  const main = computeTraits(units, S).filter((t) => t.tierIndex > 0 && !t.unique).sort((a, b) => b.count - a.count)[0];
  const carryNames = (carries || []).slice(0, 2).map((c) => S.champById[c.unit]?.name).filter(Boolean);
  return [main?.name, carryNames.join(' & ')].filter(Boolean).join(' ') || 'Comp';
}

module.exports = { tierScore, htmlDecode, nextData, devalue, percentileTiers, nameFromUnits };
