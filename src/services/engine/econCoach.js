const C = require('./constants');
const { hitChance } = require('./rollOdds');

// Oyun tarzına göre planlanan seviye zamanlamaları ve roll anları.
const PLANS = {
  standard: { name: 'Standart', levels: [['2-1', 4], ['2-5', 5], ['3-2', 6], ['4-1', 7], ['4-2', 8], ['5-2', 9]] },
  fast8: { name: 'Fast 8', levels: [['2-1', 4], ['2-5', 5], ['3-2', 6], ['4-1', 7], ['4-2', 8], ['5-2', 9]], rolldown: { at: '4-2', level: 8, cost: 4 } },
  fast9: { name: 'Fast 9', levels: [['2-1', 4], ['2-5', 5], ['3-2', 6], ['3-5', 7], ['4-2', 8], ['5-1', 9]], rolldown: { at: '5-1', level: 9, cost: 5 } },
  reroll1: { name: '1 maliyet reroll', levels: [['2-1', 4], ['2-5', 5], ['4-1', 7], ['4-5', 8]], slowroll: { from: '2-5', level: 5, cost: 1 } },
  reroll2: { name: '2 maliyet reroll', levels: [['2-1', 4], ['2-5', 5], ['3-1', 6], ['4-2', 7], ['4-5', 8]], slowroll: { from: '3-1', level: 6, cost: 2 } },
  reroll3: { name: '3 maliyet reroll', levels: [['2-1', 4], ['2-5', 5], ['3-2', 6], ['3-5', 7], ['5-1', 8]], slowroll: { from: '3-5', level: 7, cost: 3 } },
};

function planFromLevelling(levelling) {
  const l = String(levelling || '');
  if (/fast\s*9/i.test(l)) return 'fast9';
  if (/fast\s*8|4-cost/i.test(l)) return 'fast8';
  if (/1.?cost|1 maliyet|½/i.test(l)) return 'reroll1';
  if (/2.?cost|2 maliyet|lvl\s*6/i.test(l)) return 'reroll2';
  if (/3.?cost|3 maliyet|lvl\s*7|reroll/i.test(l)) return 'reroll3';
  return 'standard';
}

const pct = (v) => `%${Math.round(v * 100)}`;

/** Planın bu stage'e kadar hedeflediği seviye. */
function targetLevel(plan, stage, currentLevel) {
  let target = 0;
  for (const [s, L] of plan.levels) if (C.parseStage(s).index <= stage.index) target = Math.max(target, L);
  return target || currentLevel;
}

/**
 * Oyun durumuna göre ekonomi/seviye/roll seçeneklerini gerekçeleriyle sıralar.
 * Karar oyuncuya bırakılır: birincil öneri + alternatifler döner.
 *
 * state: { stage: "3-2", level, xp, gold, hp, streak (+galibiyet/-mağlubiyet), plan, boardStable }
 */
function advise(state) {
  const stage = C.parseStage(state.stage);
  if (!stage) throw new Error('Stage "3-2" biçiminde olmalı.');
  const level = Math.min(Math.max(Number(state.level) || 1, 1), 10);
  const gold = Math.max(0, Number(state.gold) || 0);
  const hp = Math.min(Math.max(Number(state.hp ?? 100), 0), 100);
  const xp = Math.max(0, Number(state.xp) || 0);
  const streak = Number(state.streak) || 0;
  const planId = PLANS[state.plan] ? state.plan : 'standard';
  const plan = PLANS[planId];

  const interest = C.interestFor(gold);
  const xpNeed = level < 10 ? Math.max(0, C.XP_TO_NEXT[level] - xp) : 0;
  const goldToLevel = Math.ceil(xpNeed / C.XP_PER_PURCHASE) * C.PURCHASE_COST;
  const target = targetLevel(plan, stage, level);
  const income = C.BASE_INCOME + interest + C.streakBonus(streak);
  const late = stage.stage >= 4;

  const options = [];
  const add = (action, score, title, detail) => options.push({ action, score, title, detail });

  if (hp <= 30 && stage.stage >= 3 && !state.boardStable) {
    add('rolldown', 100, 'Canını kurtar: board\'u güçlendir',
      `Can ${hp}. Ekonomiyi bırak ve en güçlü board'u kurmak için roll yap. Seviye atlamak bu turda sana yeni birim alanı veya daha iyi olasılık kazandırmıyorsa roll'u tercih et.`);
  } else if (hp <= 50 && late && !state.boardStable) {
    add('rolldown', 75, 'Stabilize olmayı düşün',
      `Can ${hp} ve stage ${stage.text}. Birkaç tur daha kaybetmek oyunu bitirebilir; 20-30 altın bırakacak şekilde roll yapmak güvenli bir orta yol.`);
  }

  if (plan.rolldown && !state.boardStable) {
    const at = C.parseStage(plan.rolldown.at);
    if (stage.index >= at.index && level >= plan.rolldown.level && gold >= 30) {
      const budget = Math.max(0, gold - 10);
      const odds = hitChance({ cost: plan.rolldown.cost, level, gold: budget, copiesWanted: 2 });
      add('rolldown', 90, `${plan.name} roll zamanı`,
        `Planın ${plan.rolldown.at}'de seviye ${plan.rolldown.level}'de roll yapmak. ~${budget} altınla belirli bir ${plan.rolldown.cost} maliyet birimden en az 2 kopya bulma olasılığın yaklaşık ${pct(odds.chance)}. 2★ ana birimlerini bulduktan sonra dur.`);
    }
  }

  if (plan.slowroll) {
    const from = C.parseStage(plan.slowroll.from);
    if (stage.index >= from.index && level === plan.slowroll.level) {
      if (gold > 50) {
        const spend = gold - 50;
        const odds = hitChance({ cost: plan.slowroll.cost, level, gold: spend, copiesWanted: 1 });
        add('slowroll', 85, '50 altının üstünü roll yap',
          `${plan.name}: ${spend} altınla (${Math.floor(spend / C.ROLL_COST)} yenileme) belirli bir ${plan.slowroll.cost} maliyet birimi en az bir kez görme olasılığın ${pct(odds.chance)}. Faizi korumak için 50'nin altına inme; 3★'ları tamamlayınca seviye atla.`);
      } else {
        add('save', 60, '50 altına kadar biriktir', `${plan.name} planında seviye ${level}'de yavaş roll için önce 50 altına ulaş (${50 - gold} altın eksik).`);
      }
    }
  }

  if (level < target) {
    if (gold >= goldToLevel) {
      const after = gold - goldToLevel;
      const lostInterest = interest - C.interestFor(after);
      const exact = plan.levels.some(([s, L]) => s === stage.text && L === level + 1);
      add('level', exact ? 88 : 80, `Seviye ${level + 1}'e çık (${goldToLevel} altın)`,
        `${plan.name} planına göre ${stage.text} itibarıyla seviye ${target} olmalısın.${lostInterest > 0 ? ` Bu, sonraki tur faizini ${lostInterest} azaltır` : ' Faiz kaybı yok'}; kalan altın ${after}.`);
    } else {
      add('save', 55, 'Seviye için altın biriktir', `Planın seviye ${target} istiyor ama ${level + 1}. seviye için ${goldToLevel - gold} altın eksik.`);
    }
  } else if (streak >= 3 && level < 9 && gold >= goldToLevel + 30 && !late) {
    add('level', 70, `Seriyi korumak için seviye ${level + 1}`, `${streak} galibiyet serin var; ekstra birim alanı seriyi uzatır ve seri bonusu (+${C.streakBonus(streak)}) kazandırır.`);
  }

  if (streak <= -3 && hp > 40 && stage.stage <= 3) {
    add('save', 72, 'Kayıp serisini sürdür', `${-streak} mağlubiyet serisi +${C.streakBonus(streak)} altın veriyor ve canın ${hp}. Board'a altın harcayıp seriyi bozmak yerine biriktir; ilk karuselde seçim önceliği de kazanırsın.`);
  }

  if (late && gold > 60 && !plan.slowroll && !(planId === 'fast9' && level < 9)) {
    add('spend', 65, '50 üstü altını kullan', `Faiz ${C.MAX_INTEREST}'te sınırlı; ${gold - 50} altın kullanılmıyor. Bu fazlayı seviye veya roll ile güce çevir.`);
  }

  // Her zaman gerçek alternatifler sun: karar oyuncunundur.
  if (level < 9 && level >= target && gold >= goldToLevel && hp > 30) {
    add('level', 38, `Plandan önce seviye ${level + 1}`,
      `${goldToLevel} altınla bir birim alanı daha açılır; board gücünü artırıp seri kazanmak veya can korumak istiyorsan mantıklı. Karşılığında ekonomin yavaşlar (kalan altın ${gold - goldToLevel}).`);
  }
  if (gold >= 20 && hp > 30 && !state.boardStable && stage.stage >= 3) {
    const spend = Math.min(gold - 10, Math.max(10, gold - 50));
    add('rolldown', 36, `Küçük roll (${spend} altın)`,
      `Board'unda eksik 2★ veya trait varsa ${spend} altınla (${Math.floor(spend / C.ROLL_COST)} yenileme) güçlendirebilirsin. Board'un yeterliyse biriktirmek daha iyi.`);
  }

  add('save', 40, 'Faiz için biriktir', interest < C.MAX_INTEREST
    ? `${(interest + 1) * 10 - gold} altın daha biriktirirsen faiz ${interest + 1}'e çıkar.`
    : 'Faiz zaten en yüksek seviyede; zorunlu olmadıkça 50 altının altına inme.');

  options.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const ranked = options.filter((o) => (seen.has(o.action) ? false : seen.add(o.action)));

  return {
    plan: { id: planId, name: plan.name },
    primary: ranked[0],
    alternatives: ranked.slice(1, 4),
    facts: {
      stage: stage.text, level, gold, hp, streak, interest, income,
      xpNeed, goldToLevel, targetLevel: target,
      nextInterestAt: interest < C.MAX_INTEREST ? (interest + 1) * 10 : null,
    },
    odds: { level, current: C.SHOP_ODDS[level], next: level < 10 ? C.SHOP_ODDS[level + 1] : null },
    patch: C.PATCH,
  };
}

module.exports = { advise, PLANS, planFromLevelling };
