const { fetchText } = require('../http');
const teamCode = require('../teamCode');
const { nextData, percentileTiers, nameFromUnits } = require('./util');

const URL = 'https://tactics.tools/team-compositions';

function topUnits(node, S) {
  const byUnit = new Map();
  for (const [id, , count] of node.units || []) {
    if (!S.champById[id]) continue;
    byUnit.set(id, (byUnit.get(id) || 0) + (count || 0));
  }
  return [...byUnit.entries()]
    .filter(([, n]) => n / (node.count || 1) >= 0.45)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
}

module.exports = {
  id: 'tacticstools',
  name: 'tactics.tools',
  kind: 'stats',
  url: URL,
  maxAge: 60 * 60 * 1000,
  async fetch(S) {
    const data = nextData(await fetchText(URL, { timeoutMs: 45000 })).props?.pageProps?.initialData;
    if (!data?.groups) throw new Error('Beklenmeyen veri biçimi.');
    const nodes = [];
    for (const g of data.groups) {
      if (g.full) nodes.push(g.full);
      for (const child of g.children || []) nodes.push(child.full || child);
    }
    const entries = nodes.map((n, i) => {
      let units = teamCode.decode(n.code, S);
      if (units.length < 5) units = topUnits(n, S);
      const carries = (n.carryUnits || []).slice(0, 3).map(([unit]) => ({
        unit,
        items: (n.unitItems || []).filter((x) => x.unitId === unit).sort((a, b) => b.count - a.count).slice(0, 3).map((x) => x.itemId),
      })).filter((c) => S.champById[c.unit]);
      const stars = Object.entries(n.starUnits || {})
        .filter(([u, v]) => Array.isArray(v) && v[0] >= 0.35 && (S.champById[u]?.cost || 9) <= 3)
        .map(([u]) => u);
      return {
        id: `tacticstools:${n.code || i}`,
        name: nameFromUnits(units, carries, S),
        units,
        carries,
        stars,
        avg: n.place ?? null,
        top4: n.count ? n.top4 / n.count : null,
        win: n.count ? n.win / n.count : null,
        count: n.count || 0,
        pick: data.count && n.count ? n.count / data.count : null,
        places: Array.isArray(n.placementDistribution) ? n.placementDistribution.slice(0, 8) : null,
      };
    }).filter((e) => e.units.length >= 5);
    percentileTiers(entries);
    return entries;
  },
};
