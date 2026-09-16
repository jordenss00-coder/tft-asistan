function matchBoard(units, comps) {
  const owned = new Set((units || []).map(u => u.id));
  if (owned.size < 3) return null;
  const matches = comps.filter(c => c.units?.length).map(c => {
    const ids = new Set(c.units);
    const shared = [...owned].filter(id => ids.has(id));
    const score = 2 * shared.length / (owned.size + ids.size);
    return { id: c.id, name: c.name, shared, missing: [...ids].filter(id => !owned.has(id)), score };
  }).sort((a, b) => b.score - a.score);
  const best = matches[0];
  return best && best.shared.length >= 3 && best.score >= 0.5 ? best : null;
}
module.exports = { matchBoard };
