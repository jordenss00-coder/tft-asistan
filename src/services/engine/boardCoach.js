const { parseStage } = require('./constants');
const { boardPower } = require('./stats');

// Motor verisi yokken kullanılan kaba eşikler (stage → elenen board'ların tipik gücü)
const FALLBACK_DANGER = { 2: 8, 3: 16, 4: 28, 5: 42, 6: 55, 7: 60 };

function dangerFor(stats, st) {
  const table = stats?.danger || {};
  for (let d = 0; d <= 3; d++) {
    for (const r of [st.index - d, st.index + d]) {
      if (table[r] != null) return { value: table[r], source: 'engine' };
    }
  }
  return { value: FALLBACK_DANGER[Math.min(st.stage, 7)] || 20, source: 'fallback' };
}

/**
 * Board gücünü, bu turlarda elenen yüksek elo oyuncularının medyan board gücüyle karşılaştırır
 * ve güçlendirme önceliklerini listeler.
 */
function checkBoard({ S, stats = null, state, comp = null }) {
  const st = parseStage(state.stage);
  if (!st) throw new Error('Stage "3-2" biçiminde olmalı.');
  const units = (state.units || [])
    .filter((u) => S.champById[u.id])
    .map((u) => ({ id: u.id, star: u.star || 1, items: u.items || [] }));
  const power = boardPower(units, S);
  const danger = dangerFor(stats, st);
  const ratio = danger.value ? power / danger.value : 1;
  const verdict = ratio < 0.9 ? 'weak' : ratio < 1.25 ? 'ok' : 'strong';

  const tips = [];
  const level = Number(state.level) || units.length;
  if (units.length < level) tips.push(`Board'da ${level - units.length} boş slot var; yedekten birim koy.`);

  const oneStarHighCost = units.filter((u) => u.star === 1 && (S.champById[u.id]?.cost || 0) >= 4);
  if (oneStarHighCost.length && st.stage >= 5) {
    tips.push(`${oneStarHighCost.map((u) => S.champById[u.id].name).join(', ')} hâlâ 1★; stage 5'te bunları 2★ yapmak en büyük güç artışı.`);
  }

  if (comp) {
    const onBoard = new Set(units.map((u) => u.id));
    const counts = {};
    const seen = new Set();
    for (const u of units) {
      const c = S.champById[u.id];
      if (seen.has(c.baseName)) continue;
      seen.add(c.baseName);
      for (const t of c.traits) counts[t] = (counts[t] || 0) + 1;
    }
    for (const id of comp.units) {
      if (onBoard.has(id)) continue;
      const c = S.champById[id];
      const opens = c?.traits.filter((t) => {
        const td = S.traitsById[t];
        return td && !td.unique && td.breakpoints.includes((counts[t] || 0) + 1);
      }) || [];
      if (opens.length) {
        tips.push(`${c.name} eklersen ${opens.map((t) => `${(counts[t] || 0) + 1} ${S.traitsById[t].name}`).join(', ')} açılır.`);
      }
    }
  }

  const text = {
    weak: `Board gücün (${power}) bu turlarda elenen oyuncuların tipik board gücünün (${Math.round(danger.value)}) altında. Can kaybını azaltmak için güçlendirme zamanı.`,
    ok: `Board gücün (${power}) bu aşama için yeterli seviyede (elenenlerin tipik gücü ${Math.round(danger.value)}).`,
    strong: `Board'un güçlü (${power}, elenenlerin tipik gücü ${Math.round(danger.value)}). Ekonomiye ve seviyeye odaklanabilirsin.`,
  }[verdict];

  return { power, danger: Math.round(danger.value * 10) / 10, dangerSource: danger.source, ratio: Math.round(ratio * 100) / 100, verdict, text, tips: tips.slice(0, 5) };
}

module.exports = { checkBoard };
