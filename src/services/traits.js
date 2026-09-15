/** Farklı kaynaklardaki ID biçimlerini (DA_18_Ahri, TFT18_Ahri, ...) karşılaştırılabilir hale getirir. */
function normId(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/^(tft\d*|da)_/, '')
    .replace(/\d+/g, '')
    .replace(/[^a-z]/g, '');
}

/** Sözlükte birebir, büyük/küçük harf duyarsız ve normalize edilmiş ID ile arama yapan çözümleyici. */
function makeResolver(dict) {
  const byLower = new Map();
  const byNorm = new Map();
  for (const key of Object.keys(dict)) {
    byLower.set(key.toLowerCase(), key);
    const n = normId(key);
    if (n && !byNorm.has(n)) byNorm.set(n, key);
  }
  const memo = new Map();
  return (id) => {
    if (id == null) return null;
    if (dict[id]) return dict[id];
    if (memo.has(id)) return memo.get(id);
    let key = byLower.get(String(id).toLowerCase());
    if (!key) {
      const n = normId(id);
      key = byNorm.get(n);
      if (!key && n.length >= 4) {
        for (const [k, v] of byNorm) {
          if (k.startsWith(n) || n.startsWith(k)) { key = v; break; }
        }
      }
    }
    const found = key ? dict[key] : null;
    memo.set(id, found);
    return found;
  };
}

/** Aynı şampiyonun kopyaları trait'e bir kez sayılır (oyundaki davranış). */
function countTraits(unitIds, S, emblemTraits = []) {
  const seen = new Set();
  const counts = {};
  for (const id of unitIds) {
    const c = S.champById[id];
    if (!c || seen.has(c.baseName)) continue;
    seen.add(c.baseName);
    for (const t of c.traits) counts[t] = (counts[t] || 0) + 1;
  }
  for (const t of emblemTraits) counts[t] = (counts[t] || 0) + 1;
  return counts;
}

function computeTraits(unitIds, S, emblemTraits = []) {
  const counts = countTraits(unitIds, S, emblemTraits);
  return Object.entries(counts)
    .map(([id, count]) => {
      const t = S.traitsById[id];
      if (!t) return null;
      const active = t.breakpoints.filter((b) => b <= count);
      return {
        apiName: id,
        name: t.name,
        icon: t.icon,
        count,
        tierIndex: active.length,
        maxTier: t.breakpoints.length,
        activeBreakpoint: active.length ? active[active.length - 1] : 0,
        next: t.breakpoints.find((b) => b > count) || null,
        unique: t.unique,
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      (b.tierIndex > 0) - (a.tierIndex > 0) ||
      a.unique - b.unique ||
      b.tierIndex / b.maxTier - a.tierIndex / a.maxTier ||
      b.count - a.count);
}

module.exports = { normId, makeResolver, countTraits, computeTraits };
