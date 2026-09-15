const { BASELINE } = require('./stats');
const { parseStage } = require('./constants');

const fmt = (v) => v.toFixed(2).replace('.', ',');

/** Bir amblemin, comp'ta bir trait'i bir sonraki kademeye taşıyıp taşımadığına göre değeri. */
function emblemValue(item, comp, S) {
  const trait = S.traits.find((t) => t.emblem?.apiName === item);
  if (!trait || !comp) return null;
  const active = comp.traits?.find((t) => t.apiName === trait.apiName);
  if (!active) return null;
  if (active.next && active.next === active.count + 1) {
    return { value: 0.55, holder: null, detail: `${trait.name} ${active.count} → ${active.next} kademesini açar` };
  }
  return { value: 0.15, holder: null, detail: `${trait.name} sayısını artırır` };
}

/**
 * Bir eşyanın comp içindeki en iyi taşıyıcısı ve değeri.
 * Değer, yüksek elo verisinde o birim + eşya ikilisinin ortalamaya (4,5) göre sıralama kazancıdır;
 * rehberin önerdiği eşyalar ek puan alır.
 */
function itemValue(item, holders, { S, stats, comp, unitStats }) {
  const emblem = emblemValue(item, comp, S);
  if (emblem) return emblem;

  let best = { value: 0, holder: null, detail: null };
  holders.forEach((unit, idx) => {
    const weight = idx === 0 ? 1 : idx < 3 ? 0.85 : 0.6;
    const st = stats?.unitItems?.[unit]?.find((x) => x.item === item);
    const guide = comp?.carries?.find((c) => c.unit === unit)?.items?.includes(item)
      || comp?.itemsByUnit?.find((x) => x.unit === unit)?.items?.includes(item);
    // Site verisi: birimin genel "en iyi eşyaları" listesi (sıraya göre ağırlıklı)
    const siteRank = unitStats?.units?.[unit]?.topItems?.indexOf(item) ?? -1;
    if (!st && !guide && siteRank < 0) return;
    let value = 0;
    const parts = [];
    if (st) {
      value += (BASELINE - st.smoothed) * weight;
      parts.push(`yüksek elo'da bu birimde ort. sıra ${fmt(st.avg)} (${st.n} oyun)`);
    }
    if (guide) {
      value += 0.35 * weight;
      parts.push('rehberlerin önerdiği eşya');
    }
    if (siteRank >= 0) {
      value += (0.32 - siteRank * 0.04) * weight;
      parts.push(`bu birimin en çok işe yarayan eşyalarından (${siteRank + 1}. sırada)`);
    }
    if (value > best.value) best = { value, holder: unit, detail: parts.join(', ') };
  });

  if (!best.holder && stats?.items?.[item]) {
    const gain = BASELINE - stats.items[item].smoothed;
    if (gain > 0) best = { value: gain * 0.4, holder: null, detail: `genel olarak güçlü eşya (ort. sıra ${fmt(stats.items[item].avg)})` };
  }
  return best;
}

function holdersFor(comp, S) {
  if (!comp) return [];
  const carries = comp.carries.map((c) => c.unit);
  const rest = comp.units
    .filter((u) => !carries.includes(u))
    .sort((a, b) => (S.champById[b]?.cost || 0) - (S.champById[a]?.cost || 0));
  return [...carries, ...rest];
}

/**
 * Bileşenlerden hangi eşyaların yapılacağını (en yüksek toplam değerli eşleştirme), hangi bileşenlerin
 * bekletileceğini ve tamamlanmış eşyaların kime verileceğini önerir.
 */
function adviseItems({ S, stats = null, unitStats = null, comp = null, components = [], completed = [], stage = null }) {
  const holders = holdersFor(comp, S);
  const st = parseStage(stage);
  // Erken oyunda eşyayı hemen yapmak can ve seri kazandırır; bekletmenin maliyeti yüksektir.
  const tempo = !st ? 0 : st.index <= 11 ? 0.25 : st.stage === 3 ? 0.12 : 0;
  const ctx = { S, stats, comp, unitStats };
  const memo = new Map();

  const solve = (list) => {
    if (list.length < 2) return { value: 0, crafts: [], hold: [...list] };
    const key = [...list].sort().join(',');
    if (memo.has(key)) return memo.get(key);
    const [first, ...rest] = list;
    const skip = solve(rest);
    let best = { value: skip.value, crafts: skip.crafts, hold: [first, ...skip.hold] };
    const tried = new Set();
    for (let i = 0; i < rest.length; i++) {
      if (tried.has(rest[i])) continue;
      tried.add(rest[i]);
      const item = S.recipes[[first, rest[i]].sort().join('|')];
      if (!item) continue;
      const iv = itemValue(item, holders, ctx);
      const value = iv.value + tempo;
      if (value <= 0) continue;
      const sub = solve(rest.filter((_, j) => j !== i));
      if (value + sub.value > best.value) {
        best = {
          value: value + sub.value,
          crafts: [{ item, from: [first, rest[i]], holder: iv.holder, value, detail: iv.detail }, ...sub.crafts],
          hold: sub.hold,
        };
      }
    }
    memo.set(key, best);
    return best;
  };

  const plan = solve(components.filter((c) => S.items[c]));
  const assignments = completed
    .filter((i) => S.items[i])
    .map((item) => ({ item, ...itemValue(item, holders, ctx) }));

  // Ana carry için önerilen ama elde olmayan eşyalar
  const have = new Set([...plan.crafts.map((c) => c.item), ...completed]);
  const missing = (comp?.carries || []).flatMap((c) => c.items.filter((i) => !have.has(i)).map((item) => ({ unit: c.unit, item, from: S.items[item]?.from || [] })));

  return {
    crafts: plan.crafts.sort((a, b) => b.value - a.value),
    hold: plan.hold,
    assignments,
    missing: missing.slice(0, 6),
  };
}

module.exports = { adviseItems, itemValue };
