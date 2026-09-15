const { fetchJson } = require('../http');
const { devalue } = require('./util');

const BASE = 'https://tftacademy.com/tierlist/comps';

module.exports = {
  id: 'tftacademy',
  name: 'TFT Academy',
  kind: 'guide',
  url: BASE,
  maxAge: 3 * 60 * 60 * 1000,
  async fetch(S) {
    const raw = await fetchJson(`${BASE}/__data.json`, { timeoutMs: 45000 });
    const nodes = (raw.nodes || []).map((n) => (n && n.type === 'data' ? devalue(n.data) : null));
    const guides = nodes.find((n) => n && Array.isArray(n.guides))?.guides;
    if (!guides) throw new Error('Rehber verisi bulunamadı.');

    return guides
      .filter((g) => g.isPublic && Number(g.set) === S.setNumber && ['S', 'A', 'B', 'C'].includes(g.tier))
      .map((g) => {
        const final = (g.finalComp || []).filter((u) => S.champById[u.apiName]);
        const units = [...new Set(final.map((u) => u.apiName))];
        const carries = final
          .filter((u) => (u.items || []).length >= 2)
          .sort((a, b) => b.items.length - a.items.length || (S.champById[b.apiName]?.cost || 0) - (S.champById[a.apiName]?.cost || 0))
          .slice(0, 3)
          .map((u) => ({ unit: u.apiName, items: u.items }));
        // Board yerleşimi: boardIndex 0-27 (4 sıra × 7 altıgen; 0-6 ön sıra).
        const positions = final
          .filter((u) => Number.isInteger(u.boardIndex))
          .map((u) => ({ unit: u.apiName, index: u.boardIndex, star: u.stars || 1, items: u.items || [] }));
        const itemsByUnit = final
          .filter((u) => (u.items || []).length)
          .map((u) => ({ unit: u.apiName, items: u.items, source: 'rehber' }));
        const early = (g.earlyComp || []).map((u) => u.apiName).filter((id) => S.champById[id]);
        const maxCap = (g.maxCap || [])
          .filter((u) => S.champById[u.apiName])
          .map((u) => ({ unit: u.apiName, items: u.items || [], replaces: (u.predecessors || []).filter((p) => S.champById[p]) }));
        return {
          id: `tftacademy:${g.id}`,
          name: String(g.title || g.metaTitle || '').trim(),
          tier: g.tier,
          units,
          carries,
          stars: final.filter((u) => u.stars >= 3).map((u) => u.apiName),
          positions,
          itemsByUnit,
          maxCap,
          early,
          tips: (g.tips || []).filter((t) => t && t.tip).map((t) => ({ stage: t.stage || '', tip: t.tip })),
          augments: (g.augments || []).filter((a) => a && !a.disabled).map((a) => a.apiName),
          augmentsTip: g.augmentsTip || '',
          carousel: (g.carousel || []).map((c) => c.apiName),
          difficulty: g.difficulty || null,
          levelling: g.style || '',
          mainChampion: g.mainChampion?.apiName || null,
          url: g.compSlug ? `${BASE}/${g.compSlug}` : BASE,
        };
      })
      .filter((e) => e.units.length >= 5);
  },
};
