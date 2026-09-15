// Set 18.2 oyun sistemi tabloları (kaynak: TFT Flow, yama 18.2). Yeni yamalarda güncellenmelidir.
const PATCH = '18.2';

// Seviye → [1, 2, 3, 4, 5 maliyet] dükkan olasılığı
const SHOP_ODDS = {
  1: [1, 0, 0, 0, 0],
  2: [1, 0, 0, 0, 0],
  3: [0.75, 0.25, 0, 0, 0],
  4: [0.55, 0.30, 0.15, 0, 0],
  5: [0.45, 0.33, 0.20, 0.02, 0],
  6: [0.30, 0.40, 0.25, 0.05, 0],
  7: [0.16, 0.30, 0.43, 0.10, 0.01],
  8: [0.15, 0.20, 0.32, 0.30, 0.03],
  9: [0.10, 0.17, 0.25, 0.33, 0.15],
  10: [0.05, 0.10, 0.20, 0.40, 0.25],
  11: [0.01, 0.02, 0.12, 0.50, 0.35],
};

const POOL_PER_UNIT = { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 };
const UNITS_PER_COST = { 1: 14, 2: 13, 3: 14, 4: 14, 5: 10 };

// Seviye → bir sonraki seviyeye gereken XP
const XP_TO_NEXT = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 64, 9: 64 };

const XP_PER_PURCHASE = 4;
const PURCHASE_COST = 4;
const ROLL_COST = 2;
const BASE_INCOME = 5;
const MAX_INTEREST = 5;

/** Seri bonusu (yaklaşık; setler arasında değişebilir). streak: +galibiyet / -mağlubiyet sayısı. */
function streakBonus(streak) {
  const n = Math.abs(Number(streak) || 0);
  if (n >= 6) return 3;
  if (n === 5) return 2;
  if (n >= 3) return 1;
  return 0;
}

function interestFor(gold) {
  return Math.min(MAX_INTEREST, Math.floor(Math.max(0, gold) / 10));
}

/** "3-2" → { stage: 3, round: 2, index: 13 } (1. stage 4 tur, sonrakiler 7 tur) */
function parseStage(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\s*-\s*(\d)$/);
  if (!m) return null;
  const stage = Number(m[1]);
  const round = Number(m[2]);
  if (stage < 1 || round < 1 || (stage === 1 && round > 4) || round > 7) return null;
  return { stage, round, index: stage === 1 ? round : 4 + (stage - 2) * 7 + round, text: `${stage}-${round}` };
}

module.exports = {
  PATCH, SHOP_ODDS, POOL_PER_UNIT, UNITS_PER_COST, XP_TO_NEXT,
  XP_PER_PURCHASE, PURCHASE_COST, ROLL_COST, BASE_INCOME, MAX_INTEREST,
  streakBonus, interestFor, parseStage,
};
