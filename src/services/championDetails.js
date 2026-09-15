const cache = require('./cache');
const { getQueries, query } = require('./sources/lolchessPage');

// Şampiyon yetenek metinleri ve sayıları CommunityDragon'da boş geldiği için lolchess'ten alınır.
// Sayılar dilden bağımsızdır; metin İngilizcedir (site Türkçe sürüm sunmuyor).
const MAX_AGE = 12 * 60 * 60 * 1000;

let memo = null;

const clean = (s) => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/%i:[^%]+%/g, '')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

function build(champions, S) {
  const out = {};
  for (const c of champions || []) {
    const id = c.ingameKey;
    if (!id || !S.champById[id]) continue;
    out[id] = {
      ability: c.skill ? {
        name: c.skill.name || '',
        desc: clean(c.skill.desc),
        stats: (c.skill.stats || []).map(clean).filter(Boolean),
        startingMana: c.skill.startingMana ?? null,
        skillMana: c.skill.skillMana ?? null,
      } : null,
      recommendItems: (c.recommendItems || []).filter((i) => S.items[i]),
      role: c.role || null,
      stats: {
        health: c.health || null,
        attackDamage: c.attackDamage || null,
        dps: c.damagePerSecond || null,
        range: c.attackRange ?? null,
        attackSpeed: c.attackSpeed ?? null,
        armor: c.armor ?? null,
        magicResist: c.magicalResistance ?? null,
      },
    };
  }
  return { fetchedAt: Date.now(), source: 'lolchess.gg', language: 'en', champions: out };
}

async function getChampionDetails(S, force = false) {
  if (!force && memo && Date.now() - memo.fetchedAt < MAX_AGE) return memo;
  const cacheKey = `champ_details_set${S.setNumber}_v1`;
  const cached = cache.read(cacheKey, MAX_AGE);
  if (!force && cached?.fresh) return (memo = cached.data);
  try {
    const champions = query(await getQueries(), 'championRefs')?.champions;
    if (!champions?.length) throw new Error('Şampiyon verisi bulunamadı.');
    memo = build(champions, S);
    cache.write(cacheKey, memo);
    return memo;
  } catch (e) {
    if (cached?.data) return (memo = { ...cached.data, stale: true, error: e.message });
    throw new Error(`Şampiyon detayları alınamadı: ${e.message}`);
  }
}

module.exports = { getChampionDetails };
