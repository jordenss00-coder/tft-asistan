const econCoach = require('./econCoach');
const { matchBoard } = require('./boardMatch');
const { countTraits } = require('../traits');
const { recommendComps } = require('./compRecommender');
const { adviseItems } = require('./itemCoach');
const { checkBoard } = require('./boardCoach');

/**
 * "Şu an ne yapmalıyım?" — oyun durumundan ekonomi, comp, eşya ve board önerilerini birlikte üretir.
 *
 * state: {
 *   stage, level, xp, gold, hp, streak,
 *   components: [bileşen id], completed: [eşya id], augments: [güçlendirme id],
 *   units: [{ id, star, items }], compId (isteğe bağlı: hedeflenen comp)
 * }
 */
/**
 * Bu tura özel somut yönlendirmeler: dükkandan alınacak birimler, bir birim uzaktaki trait'ler,
 * eksik carry eşyaları. Ekrandan okunan dükkan ve trait bilgisini kullanır.
 */
function roundAdvice({ S, state, chosen, items }) {
  const tips = [];
  const name = (id) => S.champById[id]?.name || id;
  const shop = (state.shop || []).filter(Boolean);

  if (shop.length) {
    const inComp = [...new Set(shop.filter((id) => chosen?.units.includes(id)))];
    const carries = new Set((chosen?.carries || []).map((c) => c.unit));
    if (inComp.length) {
      tips.push({
        type: 'buy',
        text: `Dükkanda comp'una uyan birim var: ${inComp.map((id) => `${name(id)}${carries.has(id) ? ' (carry)' : ''}`).join(', ')} — al.`,
      });
    }
    const owned = new Map((state.units || []).map((u) => [u.id, u.star || 1]));
    const upgrades = [...new Set(shop.filter((id) => owned.has(id) && owned.get(id) < 3))];
    if (upgrades.length) tips.push({ type: 'buy', text: `Yıldız yükseltmek için: ${upgrades.map(name).join(', ')} dükkanda.` });
  }

  // Sahadaki trait'ler bir birim uzaktaysa, o trait'i açacak birimleri öner
  const current = new Map((state.traits || []).map((t) => [t.apiName, t.count]));
  if (!current.size && state.units?.length) {
    for (const [id, count] of Object.entries(countTraits(state.units.map((u) => u.id), S))) current.set(id, count);
  }
  for (const [traitId, count] of current) {
    const trait = S.traitsById[traitId];
    if (!trait || trait.unique) continue;
    const next = trait.breakpoints.find((b) => b > count);
    if (next !== count + 1) continue;
    const owned = new Set((state.units || []).map((u) => u.id));
    const candidates = S.champions
      .filter((c) => c.traits.includes(traitId) && !owned.has(c.apiName))
      .sort((a, b) => (chosen?.units.includes(b.apiName) ? 1 : 0) - (chosen?.units.includes(a.apiName) ? 1 : 0) || a.cost - b.cost)
      .slice(0, 3);
    if (candidates.length) {
      tips.push({
        type: 'trait',
        text: `${next} ${trait.name} bir birim uzakta: ${candidates.map((c) => `${c.name} (${c.cost})`).join(', ')}`,
      });
    }
  }

  for (const miss of (items?.missing || []).slice(0, 2)) {
    tips.push({ type: 'item', text: `${name(miss.unit)} için ${S.items[miss.item]?.name || miss.item} eksik (${miss.from.map((f) => S.items[f]?.name || f).join(' + ')}).` });
  }

  return tips.slice(0, 6);
}

function coachNow({ S, metaComps, stats, unitStats = null, state }) {
  const recs = recommendComps({ S, metaComps, stats, unitStats, state });
  const detectedComp = matchBoard(state.units, metaComps);
  const chosen = metaComps.find((c) => c.id === state.compId)
    || metaComps.find((c) => c.id === detectedComp?.id)
    || metaComps.find((c) => c.id === recs.top[0]?.id)
    || null;

  const econ = econCoach.advise({ ...state, plan: state.plan || (chosen ? econCoach.planFromLevelling(chosen.levelling) : 'standard') });
  const items = adviseItems({ S, stats, unitStats, comp: chosen, components: state.components || [], completed: state.completed || [], stage: state.stage });
  const board = (state.units || []).length ? checkBoard({ S, stats, state, comp: chosen }) : null;

  return {
    generatedAt: Date.now(),
    detectedComp,
    chosenCompId: chosen?.id || null,
    round: roundAdvice({ S, state, chosen, items }),
    econ,
    comps: recs,
    items,
    board,
    usesEngineStats: !!stats?.matches,
    engineMatches: stats?.matches || 0,
  };
}

module.exports = { coachNow };
