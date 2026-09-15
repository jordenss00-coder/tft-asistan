const { computeTraits, countTraits } = require('./traits');

const LEVEL_STAGE = { 4: '2-1', 5: '2-5', 6: '3-2', 7: '4-1', 8: '4-2', 9: '5-1', 10: '5-5+' };

function distinctByBase(champs) {
  const m = new Map();
  for (const c of champs) if (!m.has(c.baseName)) m.set(c.baseName, c);
  return [...m.values()];
}

function levelFor(slots, maxCost) {
  const costLevel = maxCost >= 5 ? 9 : maxCost >= 4 ? 8 : maxCost >= 3 ? 6 : 4;
  return Math.min(10, Math.max(slots, costLevel));
}

/**
 * Bir trait'i hedef sayıya (ör. 11 Çiçek) ulaştırmak için gereken şampiyonları, amblemleri,
 * seviye/slot ihtiyacını ve bu trait'le uyumlu tamamlayıcı birimleri hesaplar.
 */
function plan(S, metaComps, traitId, targetRaw) {
  const trait = S.traitsById[traitId];
  if (!trait) throw new Error('Trait bulunamadı.');
  const maxBp = trait.breakpoints[trait.breakpoints.length - 1] || 1;
  const target = Math.max(1, Math.min(Number(targetRaw) || maxBp, 15));

  const traitUnits = distinctByBase(S.champions.filter((c) => c.traits.includes(traitId)))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'tr'));
  const available = traitUnits.length;
  const usedUnits = available <= target ? traitUnits : [...traitUnits].sort((a, b) => b.cost - a.cost).slice(0, target);
  const emblemsNeeded = Math.max(0, target - available);
  const slotsNeeded = target;
  const recommendedLevel = levelFor(slotsNeeded, Math.max(0, ...usedUnits.map((u) => u.cost)));
  const extraSlots = Math.max(0, slotsNeeded - 10);

  // Meta comp'larda bu trait'le birlikte sık oynanan birimler tamamlayıcı seçiminde öne çıkar.
  const partnerFreq = {};
  const relatedComps = [];
  for (const comp of metaComps) {
    const n = distinctByBase(comp.units.map((u) => S.champById[u]).filter(Boolean)).filter((c) => c.traits.includes(traitId)).length;
    if (n < Math.min(3, available)) continue;
    relatedComps.push({ id: comp.id, name: comp.name, tier: comp.tier, avg: comp.avg, top4: comp.top4, levelling: comp.levelling, traitCount: n, units: comp.units, sources: (comp.sources || []).map((s) => s.name) });
    for (const u of comp.units) partnerFreq[u] = (partnerFreq[u] || 0) + Math.max(1, comp.count || 0);
  }
  relatedComps.sort((a, b) => b.traitCount - a.traitCount || (a.avg ?? 9) - (b.avg ?? 9));
  const maxFreq = Math.max(1, ...Object.values(partnerFreq));

  const chosen = [...usedUnits];
  const chosenBases = new Set(chosen.map((c) => c.baseName));
  const pool = distinctByBase(S.champions.filter((c) => !c.traits.includes(traitId)));
  const boardSize = Math.max(recommendedLevel, slotsNeeded);
  const fillers = [];
  while (chosen.length < boardSize) {
    const counts = countTraits(chosen.map((c) => c.apiName), S);
    let best = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      if (chosenBases.has(c.baseName)) continue;
      let score = c.cost * 0.35 + ((partnerFreq[c.apiName] || 0) / maxFreq) * 2.5;
      for (const t of c.traits) {
        const td = S.traitsById[t];
        if (!td) continue;
        if (td.unique) { score += 0.4; continue; }
        const cur = counts[t] || 0;
        const next = td.breakpoints.find((b) => b > cur);
        if (next === cur + 1) score += 3;
        else if (cur > 0 && next) score += 1.2;
        else if (next) score += 0.3;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) break;
    chosen.push(best);
    chosenBases.add(best.baseName);
    fillers.push(best);
  }
  const emblemCarriers = fillers.slice(0, emblemsNeeded).map((c) => c.apiName);
  const boardUnits = chosen.map((c) => c.apiName);

  const milestones = trait.breakpoints.filter((b) => b <= target).map((b) => {
    const units = traitUnits.slice(0, Math.min(b, available));
    const level = levelFor(b, Math.max(0, ...units.map((u) => u.cost)));
    return {
      count: b,
      units: units.map((u) => u.apiName),
      emblems: Math.max(0, b - available),
      level,
      stage: LEVEL_STAGE[level] || '',
      tierText: trait.tiers.find((t) => t.minUnits === b)?.text || '',
    };
  });

  const levels = [7, 8, 9, 10].map((L) => {
    const free = L - slotsNeeded;
    return { level: L, freeSlots: free, ok: free >= 0 };
  });

  const warnings = [];
  if (emblemsNeeded > 0) warnings.push(`Oyunda ${available} ${trait.name} şampiyonu var; ${target} için ${emblemsNeeded} adet ${trait.emblem?.name || `${trait.name} Amblemi`} gerekir.`);
  if (emblemsNeeded > 0 && !trait.emblem?.craftable) warnings.push('Bu trait\'in amblemi eşyayla yapılamıyor; yalnızca güçlendirme veya ödüllerden gelir.');
  if (extraSlots > 0) warnings.push(`${slotsNeeded} birimlik alan gerekiyor: seviye 10'da bile ${extraSlots} ek takım slotu (güçlendirme veya özel eşya) lazım.`);
  if (emblemsNeeded >= 3) warnings.push('Çok yüksek risk: 3 veya daha fazla amblem için aynı sayıda Spatula ya da Tava gerekir. Genelde güçlendirme desteği olmadan hedeflenmez.');
  if (target > maxBp) warnings.push('Seçilen sayı trait\'in son kademesini aşıyor; ek bonus vermez.');

  return {
    trait: { apiName: trait.apiName, name: trait.name, icon: trait.icon, summary: trait.summary, tiers: trait.tiers, breakpoints: trait.breakpoints },
    target,
    available,
    traitUnits: traitUnits.map((u) => u.apiName),
    emblemsNeeded,
    slotsNeeded,
    recommendedLevel,
    extraSlots,
    emblem: trait.emblem || null,
    milestones,
    board: {
      units: boardUnits,
      emblemCarriers,
      traits: computeTraits(boardUnits, S, Array(emblemsNeeded).fill(traitId)),
    },
    levels,
    augments: trait.augments.slice(0, 12),
    teamSizeAugments: S.teamSizeAugments.slice(0, 8),
    relatedComps: relatedComps.slice(0, 6),
    warnings,
  };
}

module.exports = { plan };
