const econCoach = require('./econCoach');
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
function coachNow({ S, metaComps, stats, unitStats = null, state }) {
  const recs = recommendComps({ S, metaComps, stats, unitStats, state });
  const chosen = metaComps.find((c) => c.id === state.compId)
    || metaComps.find((c) => c.id === recs.top[0]?.id)
    || null;

  const econ = econCoach.advise({ ...state, plan: state.plan || (chosen ? econCoach.planFromLevelling(chosen.levelling) : 'standard') });
  const items = adviseItems({ S, stats, unitStats, comp: chosen, components: state.components || [], completed: state.completed || [], stage: state.stage });
  const board = (state.units || []).length ? checkBoard({ S, stats, state, comp: chosen }) : null;

  return {
    generatedAt: Date.now(),
    chosenCompId: chosen?.id || null,
    econ,
    comps: recs,
    items,
    board,
    usesEngineStats: !!stats?.matches,
    engineMatches: stats?.matches || 0,
  };
}

module.exports = { coachNow };
