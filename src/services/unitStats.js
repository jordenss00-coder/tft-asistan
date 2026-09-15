const { fetchText } = require('./http');
const cache = require('./cache');
const { nextData } = require('./sources/util');

// tactics.tools birim/eşya/trait istatistikleri: her birim için ortalama sıra, top 4, 1.lik,
// en iyi eşyalar ve 3★ verisi; her eşya için genel başarı; her trait kademesi için sonuçlar.
const URL = 'https://tactics.tools/units';
const MAX_AGE = 2 * 60 * 60 * 1000;

let memo = null;

function build(statsData, S) {
  const units = {};
  for (const [id, u] of Object.entries(statsData.units || {})) {
    if (!S.champById[id]) continue;
    units[id] = {
      count: u.count,
      avg: u.place,
      top4: u.top4 != null ? u.top4 / 100 : null,
      win: u.won != null ? u.won / 100 : null,
      topItems: (u.topItems || []).filter((i) => S.items[i]),
      star3: u.starCount ? { count: u.starCount, avg: u.starPlace, top4: u.starTop4 / 100, win: u.starWon / 100 } : null,
    };
  }

  const items = {};
  const MIN_ITEM_GAMES = 2000;
  for (const it of statsData.items || []) {
    const def = S.items[it.itemId];
    // Tüketilebilirler ve çok az oynanan kayıtlar elenir; yalnızca gerçek savaş eşyaları kalır.
    if (!def || def.isAugment || (it.count || 0) < MIN_ITEM_GAMES) continue;
    if (/iksir|consumable|potion/i.test(`${def.name} ${def.apiName}`)) continue;
    items[it.itemId] = {
      count: it.count,
      avg: it.place,
      top4: it.top4 != null ? it.top4 / 100 : null,
      win: it.won != null ? it.won / 100 : null,
      holders: [],
    };
  }
  // Birimlerin "en iyi eşyaları" tersine çevrilerek her eşya için en iyi taşıyıcılar çıkarılır.
  for (const [unitId, u] of Object.entries(units)) {
    u.topItems.forEach((itemId, rank) => {
      if (!items[itemId]) return;
      items[itemId].holders.push({ unit: unitId, rank, avg: u.avg, count: u.count });
    });
  }
  for (const it of Object.values(items)) {
    it.holders.sort((a, b) => a.rank - b.rank || a.avg - b.avg);
    it.holders = it.holders.slice(0, 8);
  }

  const traits = {};
  for (const [key, t] of Object.entries(statsData.traits || {})) {
    const [id, tierIndex] = key.split('__');
    const def = S.traitsById[id];
    if (!def) continue;
    // Kaynak kademeyi sırayla numaralandırır (1, 2, 3…); biz birim sayısına çeviriyoruz.
    const units = def.breakpoints[Number(tierIndex) - 1];
    if (!units) continue;
    (traits[id] ||= {})[units] = { count: t.count, avg: t.place, top4: t.top4 != null ? t.top4 / 100 : null, win: t.won != null ? t.won / 100 : null };
  }

  return {
    fetchedAt: Date.now(),
    source: 'tactics.tools',
    games: statsData.totalEntries || 0,
    units,
    items,
    traits,
  };
}

async function getUnitStats(S, force = false) {
  if (!force && memo && Date.now() - memo.fetchedAt < MAX_AGE) return memo;
  const cacheKey = `unit_stats_set${S.setNumber}_v2`;
  const cached = cache.read(cacheKey, MAX_AGE);
  if (!force && cached?.fresh) return (memo = cached.data);
  try {
    const data = nextData(await fetchText(URL, { timeoutMs: 45000 })).props?.pageProps?.statsData;
    if (!data?.units) throw new Error('Beklenmeyen veri biçimi.');
    memo = build(data, S);
    cache.write(cacheKey, memo);
    return memo;
  } catch (e) {
    if (cached?.data) return (memo = { ...cached.data, stale: true, error: e.message });
    throw new Error(`Birim istatistikleri alınamadı: ${e.message}`);
  }
}

/** Bir birim için en iyi eşyalar: motor verisi (varsa) ve site verisi birleştirilir. */
function bestItemsFor(unitId, { unitStats, engineStats, limit = 5 }) {
  const out = new Map();
  for (const it of engineStats?.unitItems?.[unitId]?.slice(0, limit) || []) {
    out.set(it.item, { item: it.item, avg: it.avg, n: it.n, source: 'motor' });
  }
  (unitStats?.units?.[unitId]?.topItems || []).forEach((item) => {
    if (out.has(item)) out.get(item).source = 'motor + tactics.tools';
    else if (out.size < limit + 2) out.set(item, { item, avg: null, n: null, source: 'tactics.tools' });
  });
  return [...out.values()].slice(0, limit);
}

module.exports = { getUnitStats, bestItemsFor };
