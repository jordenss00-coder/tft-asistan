const { fetchJson } = require('../http');
const { percentileTiers } = require('./util');

const BASE = 'https://api-hc.metatft.com/tft-comps-api';
const RANKS = 'CHALLENGER,GRANDMASTER,MASTER,DIAMOND';

const parseList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function unitBuilds(builds) {
  const byUnit = new Map();
  for (const b of builds || []) {
    if (!b.unit || !Array.isArray(b.buildName) || !b.buildName.length) continue;
    const e = byUnit.get(b.unit) || { unit: b.unit, total: 0, best: null, bestScore: -1 };
    e.total += b.count || 0;
    const score = (b.buildName.length === 3 ? 1e9 : 0) + (b.count || 0);
    if (score > e.bestScore) { e.best = b; e.bestScore = score; }
    byUnit.set(b.unit, e);
  }
  return [...byUnit.values()].sort((a, b) => b.total - a.total);
}

function parseAugments(top) {
  if (!top) return [];
  const arr = Array.isArray(top)
    ? top
    : Object.entries(top).map(([k, v]) => (v && typeof v === 'object' ? { name: k, ...v } : { name: k }));
  return arr
    .map((a) => (typeof a === 'string' ? a : a.augment || a.name || a.itemNames || a.augmentName))
    .filter((a) => typeof a === 'string')
    .slice(0, 8);
}

function compName(c, S, units) {
  const parts = Array.isArray(c.name) ? c.name : [];
  const traitNames = parts.filter((p) => p.type === 'trait')
    .map((p) => (S.traitsById[p.name] || S.traitsById[String(p.name).replace(/_\d+$/, '')])?.name)
    .filter(Boolean);
  const unitNames = parts.filter((p) => p.type === 'unit').map((p) => S.champById[p.name]?.name).filter(Boolean);
  const name = [traitNames.join(' '), unitNames.join(' & ')].filter(Boolean).join(' ');
  return name || units.slice(-2).map((u) => S.champById[u]?.name || u).join(' & ');
}

module.exports = {
  id: 'metatft',
  name: 'MetaTFT',
  kind: 'stats',
  url: 'https://www.metatft.com/comps',
  maxAge: 60 * 60 * 1000,
  async fetch(S) {
    const [data, stats] = await Promise.all([
      fetchJson(`${BASE}/comps_data?queue=1100`, { timeoutMs: 45000 }),
      fetchJson(`${BASE}/comps_stats?queue=1100&patch=current&days=3&rank=${RANKS}`, { timeoutMs: 45000 }),
    ]);
    const d = data?.results?.data;
    if (!d?.cluster_details) throw new Error('Beklenmeyen veri biçimi.');
    if (d.tft_set && d.tft_set !== `TFTSet${S.setNumber}`) throw new Error(`Veri farklı bir sete ait (${d.tft_set}).`);

    const statMap = new Map();
    let totalGames = 0;
    for (const r of stats?.results || []) {
      if (!r.cluster) { totalGames = r.places?.[0] || 0; continue; }
      statMap.set(String(r.cluster), r);
    }

    const entries = [];
    for (const [id, c] of Object.entries(d.cluster_details)) {
      const units = parseList(c.units_string).filter((u) => S.champById[u]);
      if (units.length < 5) continue;
      const st = statMap.get(String(id));
      const places = st?.places?.slice(0, 8) || null;
      const count = st?.count || (places ? places.reduce((a, b) => a + b, 0) : 0);
      const builds = unitBuilds(c.builds);
      const e = {
        id: `metatft:${id}`,
        name: compName(c, S, units),
        units,
        stars: Array.isArray(c.stars) ? c.stars.filter((u) => units.includes(u)) : [],
        carries: builds.slice(0, 3).map((b) => ({ unit: b.unit, items: b.best.buildName })),
        itemsByUnit: builds.map((b) => ({ unit: b.unit, items: b.best.buildName, avg: b.best.avg, n: b.best.count, source: 'MetaTFT' })),
        augments: parseAugments(c.top_augments),
        levelling: c.levelling || '',
        count,
        places,
        pick: totalGames && count ? count / totalGames : null,
        avg: c.overall?.avg ?? null,
        top4: null,
        win: null,
      };
      if (places && count) {
        e.avg = places.reduce((s, n, i) => s + n * (i + 1), 0) / count;
        e.top4 = places.slice(0, 4).reduce((a, b) => a + b, 0) / count;
        e.win = places[0] / count;
      }
      entries.push(e);
    }
    percentileTiers(entries);
    return entries.filter((e) => e.tier !== 'D');
  },
};
