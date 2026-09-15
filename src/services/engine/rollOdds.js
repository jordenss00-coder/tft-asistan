const { SHOP_ODDS, POOL_PER_UNIT, UNITS_PER_COST, ROLL_COST } = require('./constants');

/** Binom(n, p) için en az k başarı olasılığı. */
function atLeast(n, p, k) {
  if (k <= 0) return 1;
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n >= k ? 1 : 0;
  let term = (1 - p) ** n;
  let below = 0;
  for (let i = 0; i < k; i++) {
    if (i > 0) term = (term * (n - i + 1) / i) * (p / (1 - p));
    below += term;
  }
  return Math.min(1, Math.max(0, 1 - below));
}

/**
 * Belirli bir birimden istenen sayıda kopyayı roll yaparak bulma olasılığı.
 * Havuz dükkan boyunca sabit kabul edilir (küçük roll'larda iyi bir yaklaşımdır).
 */
function hitChance({
  cost, level, gold, copiesWanted = 1, copiesOwned = 0, takenByOthers = 0, sameCostTaken = 0, includeCurrentShop = false,
}) {
  const odds = SHOP_ODDS[Math.min(Math.max(level, 1), 11)]?.[cost - 1] || 0;
  const unitLeft = Math.max(0, POOL_PER_UNIT[cost] - copiesOwned - takenByOthers);
  const costPool = Math.max(1, POOL_PER_UNIT[cost] * UNITS_PER_COST[cost] - copiesOwned - takenByOthers - sameCostTaken);
  const perSlot = odds * (unitLeft / costPool);
  // Bulunan kopyaları satın almak için gereken altın roll bütçesinden düşülür.
  const rollGold = Math.max(0, gold - copiesWanted * cost);
  const shops = Math.floor(rollGold / ROLL_COST) + (includeCurrentShop ? 1 : 0);
  const slots = shops * 5;
  const chance = copiesWanted > unitLeft ? 0 : atLeast(slots, perSlot, copiesWanted);
  return { chance, perSlot, shops, unitLeft, expectedCopies: slots * perSlot };
}

/** İstenen olasılığa ulaşmak için gereken en az altın (bulunamazsa null). */
function goldForChance(opts, target = 0.8, maxGold = 200) {
  for (let gold = 0; gold <= maxGold; gold += ROLL_COST) {
    if (hitChance({ ...opts, gold }).chance >= target) return gold;
  }
  return null;
}

module.exports = { atLeast, hitChance, goldForChance };
