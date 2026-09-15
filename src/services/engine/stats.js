const fs = require('fs');
const { makeResolver } = require('../traits');

const BASELINE = 4.5;
const SMOOTH_K = 20;
const MIN_LATEST_PATCH_MATCHES = 300;
const MIN_COMP_GAMES = 20;
const MIN_UNIT_ITEM_GAMES = 15;

const smooth = (sum, n) => (sum + BASELINE * SMOOTH_K) / (n + SMOOTH_K);

function acc(map, key) {
  let e = map.get(key);
  if (!e) { e = { n: 0, sum: 0, top4: 0, win: 0 }; map.set(key, e); }
  return e;
}

function addPlace(e, p) {
  e.n++;
  e.sum += p;
  if (p <= 4) e.top4++;
  if (p === 1) e.win++;
}

function finish(e) {
  return {
    n: e.n,
    avg: e.n ? e.sum / e.n : null,
    smoothed: smooth(e.sum, e.n),
    top4: e.n ? e.top4 / e.n : null,
    win: e.n ? e.win / e.n : null,
  };
}

function comparePatch(a, b) {
  const pa = String(a || '0.0').split('.').map(Number);
  const pb = String(b || '0.0').split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1];
}

/** Board gücü: birim maliyeti × yıldız çarpanı (1/3/9) + tamamlanmış eşya katkısı. */
function boardPower(units, S) {
  let power = 0;
  for (const u of units) {
    const cost = S.champById[u.id]?.cost || 1;
    power += cost * 3 ** ((u.star || 1) - 1) + u.items.filter((i) => !/Component/i.test(i)).length * 1.5;
  }
  return Math.round(power * 10) / 10;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function readMatches(file) {
  const out = [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* yarım kalmış satır */ }
  }
  return out;
}

/**
 * Yüksek elo maçlarından istatistik üretir: birim, yıldız, eşya (birim üzerinde), güçlendirme, trait,
 * kendi comp gruplaması, site comp'larının yüksek elo sonuçları ve tura göre "tehlike" board gücü.
 */
function buildStats({ file, S, metaComps = [] }) {
  const all = readMatches(file);
  const patches = [...new Set(all.map((m) => m.patch).filter(Boolean))].sort(comparePatch);
  const latest = patches[patches.length - 1] || null;
  let matches = all.filter((m) => m.patch === latest);
  let usedPatches = latest ? [latest] : [];
  if (matches.length < MIN_LATEST_PATCH_MATCHES && patches.length > 1) {
    const prev = patches[patches.length - 2];
    matches = all.filter((m) => m.patch === latest || m.patch === prev);
    usedPatches = [prev, latest];
  }
  if (!latest) matches = all;

  const res = { unit: makeResolver(S.champById), item: makeResolver(S.items), trait: makeResolver(S.traitsById) };
  const units = new Map();
  const unitStars = new Map();
  const unitItems = new Map();
  const items = new Map();
  const augments = new Map();
  const traits = new Map();
  const comps = new Map();
  const metaStats = new Map();
  const eliminatedPower = new Map();

  const compUnitIndex = new Map();
  for (const c of metaComps) {
    for (const u of c.units || []) {
      if (!compUnitIndex.has(u)) compUnitIndex.set(u, []);
      compUnitIndex.get(u).push(c);
    }
  }

  let rowsCount = 0;
  for (const m of matches) {
    for (const row of m.rows) {
      rowsCount++;
      const p = row.p;
      const board = row.u.map(([cid, star, itemNames]) => ({
        id: res.unit(cid)?.apiName || cid,
        star,
        items: itemNames.map((i) => res.item(i)?.apiName || i),
      }));

      const seenUnits = new Set();
      for (const u of board) {
        if (!seenUnits.has(u.id)) { addPlace(acc(units, u.id), p); seenUnits.add(u.id); }
        addPlace(acc(unitStars, `${u.id}|${u.star}`), p);
        for (const it of new Set(u.items)) {
          addPlace(acc(unitItems, `${u.id}|${it}`), p);
          addPlace(acc(items, it), p);
        }
      }
      for (const a of row.a) addPlace(acc(augments, res.item(a)?.apiName || a), p);

      const active = row.t.map(([tid, num, tier, total]) => {
        const td = res.trait(tid);
        return { id: td?.apiName || tid, num, tier, total, unique: !!td?.unique };
      });
      for (const t of active) addPlace(acc(traits, `${t.id}|${t.tier}`), p);

      // Kendi comp gruplaması: ana trait + ana carry
      const carry = [...board].sort((a, b) =>
        b.items.length - a.items.length || (S.champById[b.id]?.cost || 0) - (S.champById[a.id]?.cost || 0) || b.star - a.star)[0];
      const main = active.filter((t) => !t.unique).sort((a, b) => b.num - a.num || b.tier - a.tier)[0];
      if (carry && main) {
        const key = `${main.id}|${carry.id}`;
        let c = comps.get(key);
        if (!c) {
          c = { key, trait: main.id, carry: carry.id, place: { n: 0, sum: 0, top4: 0, win: 0 }, units: new Map(), carryItems: new Map(), augments: new Map(), levelSum: 0 };
          comps.set(key, c);
        }
        addPlace(c.place, p);
        c.levelSum += row.l;
        for (const id of seenUnits) c.units.set(id, (c.units.get(id) || 0) + 1);
        for (const it of carry.items) c.carryItems.set(it, (c.carryItems.get(it) || 0) + 1);
        for (const a of row.a) addPlace(acc(c.augments, res.item(a)?.apiName || a), p);
      }

      // Site comp'ları ile eşleştirme (birimlerin en az %60'ı)
      const hits = new Map();
      for (const id of seenUnits) for (const c of compUnitIndex.get(id) || []) hits.set(c, (hits.get(c) || 0) + 1);
      let best = null;
      for (const [c, h] of hits) {
        const cover = h / c.units.length;
        if (cover >= 0.6 && (!best || cover > best.cover)) best = { c, cover };
      }
      if (best) addPlace(acc(metaStats, best.c.id), p);

      if (p >= 5 && row.r) {
        if (!eliminatedPower.has(row.r)) eliminatedPower.set(row.r, []);
        eliminatedPower.get(row.r).push(boardPower(board, S));
      }
    }
  }

  const unitOut = {};
  for (const [id, e] of units) {
    unitOut[id] = { ...finish(e), byStar: {} };
    for (const star of [1, 2, 3]) {
      const s = unitStars.get(`${id}|${star}`);
      if (s) unitOut[id].byStar[star] = finish(s);
    }
  }

  const unitItemsOut = {};
  for (const [key, e] of unitItems) {
    if (e.n < MIN_UNIT_ITEM_GAMES) continue;
    const [unit, item] = key.split('|');
    (unitItemsOut[unit] ||= []).push({ item, ...finish(e) });
  }
  for (const list of Object.values(unitItemsOut)) list.sort((a, b) => a.smoothed - b.smoothed);

  const mapOut = (map) => Object.fromEntries([...map].map(([k, e]) => [k, finish(e)]));

  const traitsOut = {};
  for (const [key, e] of traits) {
    const [id, tier] = key.split('|');
    (traitsOut[id] ||= {})[tier] = finish(e);
  }

  const compsOut = [...comps.values()]
    .filter((c) => c.place.n >= MIN_COMP_GAMES)
    .map((c) => {
      const n = c.place.n;
      return {
        key: c.key,
        name: `${S.traitsById[c.trait]?.name || c.trait} ${S.champById[c.carry]?.name || c.carry}`,
        trait: c.trait,
        carry: c.carry,
        ...finish(c.place),
        avgLevel: c.levelSum / n,
        core: [...c.units].filter(([, k]) => k / n >= 0.5).sort((a, b) => b[1] - a[1]).map(([id]) => id),
        carryItems: [...c.carryItems].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([item, k]) => ({ item, share: k / n })),
        augments: [...c.augments].filter(([, e]) => e.n >= 5).map(([id, e]) => ({ id, ...finish(e) })).sort((a, b) => a.smoothed - b.smoothed).slice(0, 10),
      };
    })
    .sort((a, b) => a.smoothed - b.smoothed);

  const danger = {};
  for (const [round, powers] of [...eliminatedPower].sort((a, b) => a[0] - b[0])) {
    if (powers.length >= 10) danger[round] = median(powers);
  }

  return {
    builtAt: Date.now(),
    setNumber: S.setNumber,
    patches: usedPatches,
    matches: matches.length,
    rows: rowsCount,
    units: unitOut,
    unitItems: unitItemsOut,
    items: mapOut(items),
    augments: mapOut(augments),
    traits: traitsOut,
    comps: compsOut,
    metaComps: mapOut(metaStats),
    danger,
  };
}

module.exports = { buildStats, boardPower, BASELINE };
