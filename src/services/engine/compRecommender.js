const { parseStage } = require('./constants');
const { adviseItems } = require('./itemCoach');
const { planFromLevelling } = require('./econCoach');
const { BASELINE } = require('./stats');

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const fmt = (v) => v.toFixed(2).replace('.', ',');

const WEIGHTS = {
  early: { strength: 0.35, items: 0.35, augments: 0.15, units: 0.15 },
  mid: { strength: 0.3, items: 0.3, augments: 0.15, units: 0.25 },
  late: { strength: 0.25, items: 0.25, augments: 0.1, units: 0.4 },
};

/** Site comp'unu motorun kendi comp gruplarından (ana trait + ana carry) biriyle eşleştirir. */
function engineCompFor(comp, stats) {
  if (!stats?.comps?.length) return null;
  const carry = comp.carries?.[0]?.unit || comp.mainChampion;
  const activeTraits = new Set((comp.traits || []).filter((t) => t.tierIndex > 0).map((t) => t.apiName));
  return stats.comps.find((e) => e.carry === carry && activeTraits.has(e.trait))
    || stats.comps.find((e) => e.carry === carry)
    || null;
}

function strengthOf(comp, stats) {
  const eng = stats?.metaComps?.[comp.id];
  const useEngine = eng && eng.n >= 30;
  const avg = useEngine ? eng.smoothed : comp.avg;
  // rankScore, az kaynaklı comp'ları ortalamaya çeker; tek sitenin görüşü tek başına yüksek puan vermez.
  const tierSource = comp.rankScore ?? comp.tierScore;
  const tierPart = tierSource != null ? clamp((tierSource - 1) / 4) : 0.5;
  const avgPart = avg != null ? clamp((4.8 - avg) / 1.3) : tierPart;
  const reasons = [];
  if (comp.tierScore != null) reasons.push(`${comp.sources.length} kaynakta ortalama tier ${comp.tier}`);
  if (useEngine) reasons.push(`yüksek elo verinde ort. sıra ${fmt(eng.avg)} (${eng.n} oyun)`);
  else if (comp.avg != null) reasons.push(`site istatistiğinde ort. sıra ${fmt(comp.avg)}`);
  return { score: 0.5 * tierPart + 0.5 * avgPart, reasons };
}

function augmentsOf(comp, augments, S, stats) {
  if (!augments.length) return { score: 0.5, reasons: [] };
  const eng = engineCompFor(comp, stats);
  const active = new Set((comp.traits || []).filter((t) => t.tierIndex > 0).map((t) => t.apiName));
  let delta = 0;
  const reasons = [];
  for (const a of augments) {
    const name = S.items[a]?.name || a;
    const inComp = eng?.augments?.find((x) => x.id === a);
    if (inComp) {
      const gain = eng.smoothed - inComp.smoothed;
      delta += clamp(gain, -0.5, 0.5);
      reasons.push(`${name} bu comp'la yüksek elo'da ort. sıra ${fmt(inComp.avg)}`);
    } else if (comp.augments?.includes(a)) {
      delta += 0.3;
      reasons.push(`${name} bu comp için rehberlerde öneriliyor`);
    } else if ((S.items[a]?.traits || []).some((t) => active.has(t))) {
      delta += 0.25;
      reasons.push(`${name} comp'un trait'lerini destekliyor`);
    } else if (stats?.augments?.[a]) {
      delta += clamp((BASELINE - stats.augments[a].smoothed) * 0.2, -0.1, 0.1);
    }
  }
  return { score: clamp(0.5 + delta / augments.length), reasons };
}

function unitsOf(comp, owned, S, phase) {
  if (!owned.length) return { score: phase === 'early' ? 0.4 : 0.2, reasons: [] };
  const byId = new Map(owned.map((u) => [u.id, u]));
  let total = 0;
  let have = 0;
  const hits = [];
  for (const id of comp.units) {
    const cost = S.champById[id]?.cost || 1;
    total += cost;
    const o = byId.get(id);
    if (o) {
      have += cost * (o.star >= 2 ? 1.5 : 1);
      hits.push(S.champById[id]?.name || id);
    }
  }
  const starHits = comp.stars.filter((id) => (byId.get(id)?.star || 0) >= 2).length;
  const score = clamp(have / Math.max(1, total) + starHits * 0.15);
  const reasons = hits.length ? [`elindeki ${hits.length}/${comp.units.length} birim bu comp'ta (${hits.slice(0, 4).join(', ')})`] : [];
  if (starHits) reasons.push(`${starHits} reroll birimin zaten 2★`);
  return { score, reasons };
}

/**
 * Oyuncunun eşyaları, güçlendirmeleri, birimleri ve oyun aşamasına göre en uygun comp'ları sıralar.
 * Kural gereği tek bir karar dayatmaz; gerekçeleriyle birden fazla seçenek sunar.
 */
function recommendComps({ S, metaComps, stats = null, unitStats = null, state }) {
  const st = parseStage(state.stage);
  const phase = !st || st.stage <= 2 ? 'early' : st.stage === 3 ? 'mid' : 'late';
  const W = WEIGHTS[phase];
  const hp = Number(state.hp ?? 100);
  const owned = (state.units || []).filter((u) => S.champById[u.id]);
  const components = state.components || [];
  const completed = state.completed || [];
  const augments = state.augments || [];
  const heldItems = Math.floor(components.length / 2) + completed.length;

  const results = metaComps
    .filter((c) => c.units?.length >= 5)
    .map((comp) => {
      const strength = strengthOf(comp, stats);
      const itemPlan = adviseItems({ S, stats, unitStats, comp, components, completed, stage: state.stage });
      const carryIds = new Set(comp.carries.map((c) => c.unit));
      // Her eşya, değerine (istatistik kazancı / rehber uyumu) ve carry'ye gidip gitmediğine göre katkı verir.
      const useful = [...itemPlan.crafts, ...itemPlan.assignments].filter((x) => x.holder && x.value > 0.2);
      const onCarries = useful.filter((x) => carryIds.has(x.holder));
      const contribution = useful.reduce((sum, x) => sum + (carryIds.has(x.holder) ? 1 : 0.55) * clamp(x.value / 0.9), 0);
      const items = heldItems
        ? { score: clamp(contribution / Math.max(1, Math.min(3, heldItems))), reasons: onCarries.length ? [`${onCarries.length} eşyan doğrudan carry'lere uyuyor`] : [] }
        : { score: 0.5, reasons: [] };
      const aug = augmentsOf(comp, augments, S, stats);
      const units = unitsOf(comp, owned, S, phase);

      // Ekrandan okunan aktif trait'ler: sahadaki board'unla uyumlu comp'lar öne çıkar.
      let traitBonus = 0;
      const traitReasons = [];
      if (state.traits?.length) {
        const compTraits = new Map((comp.traits || []).map((t) => [t.apiName, t.count]));
        const matched = state.traits.filter((t) => compTraits.has(t.apiName));
        const covered = matched.reduce((sum, t) => sum + Math.min(t.count, compTraits.get(t.apiName)), 0);
        const total = state.traits.reduce((sum, t) => sum + t.count, 0) || 1;
        traitBonus = clamp(covered / total) * 0.12;
        if (matched.length) traitReasons.push(`sahadaki trait'lerinle uyumlu: ${matched.slice(0, 3).map((t) => `${t.count} ${t.name}`).join(', ')}`);
      }

      let penalty = 0;
      const warnings = [];
      const plan = planFromLevelling(comp.levelling);
      if (plan === 'fast9' && hp < 50) { penalty += 0.15; warnings.push('Canın düşükken Fast 9 riskli'); }
      if (plan.startsWith('reroll') && st && st.stage >= 4 && !comp.stars.some((id) => owned.find((u) => u.id === id))) {
        penalty += 0.1;
        warnings.push('Reroll birimlerine sahip değilsin; bu aşamada geç kalınmış olabilir');
      }

      const score = W.strength * strength.score + W.items * items.score + W.augments * aug.score + W.units * units.score + traitBonus - penalty;
      return {
        id: comp.id,
        name: comp.name,
        tier: comp.tier,
        levelling: comp.levelling,
        plan,
        units: comp.units,
        carries: comp.carries,
        score: Math.round(score * 100),
        parts: {
          strength: Math.round(strength.score * 100),
          items: Math.round(items.score * 100),
          augments: Math.round(aug.score * 100),
          units: Math.round(units.score * 100),
        },
        reasons: [...traitReasons, ...units.reasons, ...items.reasons, ...aug.reasons, ...strength.reasons],
        warnings,
        itemPlan: { crafts: itemPlan.crafts.slice(0, 4), missing: itemPlan.missing.slice(0, 4), hold: itemPlan.hold },
      };
    })
    .sort((a, b) => b.score - a.score);

  return { phase, weights: W, top: results.slice(0, 5) };
}

module.exports = { recommendComps, engineCompFor };
