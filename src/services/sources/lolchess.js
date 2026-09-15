const { getQueries, query, URL } = require('./lolchessPage');

module.exports = {
  id: 'lolchess',
  name: 'lolchess.gg',
  kind: 'guide',
  url: URL,
  maxAge: 3 * 60 * 60 * 1000,
  async fetch(S) {
    const queries = await getQueries();
    const champRefs = query(queries, 'championRefs')?.champions || [];
    const itemRefs = query(queries, 'itemRefs')?.items || [];
    const decks = query(queries, 'getGuideDecks')?.guideDecks;
    if (!decks) throw new Error('Deste verisi bulunamadı.');

    const champKey = new Map(champRefs.map((c) => [c.key, c.ingameKey]));
    const itemKey = new Map(itemRefs.map((i) => [i.key, i.ingameKey]));
    const toItem = (k) => {
      const id = itemKey.get(k);
      if (id && S.items[id]) return id;
      return S.items[`DA_${k}`] ? `DA_${k}` : id || k;
    };

    return decks
      .filter((d) => d.season === `set${S.setNumber}` && !/^summary/i.test(d.name || ''))
      .map((d) => {
        const slots = (d.data?.slots || []).map((s) => ({ ...s, id: champKey.get(s.champion) })).filter((s) => s.id && S.champById[s.id]);
        const units = [...new Set(slots.map((s) => s.id))];
        const carries = slots
          .filter((s) => (s.items || []).length >= 2)
          .sort((a, b) => b.items.length - a.items.length || (S.champById[b.id].cost - S.champById[a.id].cost))
          .slice(0, 3)
          .map((s) => ({ unit: s.id, items: s.items.map(toItem) }));
        return {
          id: `lolchess:${d.teamBuilderKey}`,
          name: d.name,
          tier: null,
          tag: d.tag || null,
          units,
          carries,
          stars: slots.filter((s) => s.star >= 3).map((s) => s.id),
          url: URL,
        };
      })
      .filter((e) => e.units.length >= 5);
  },
};
