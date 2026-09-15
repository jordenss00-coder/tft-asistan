const cache = require('./cache');
const teamCode = require('./teamCode');
const { computeTraits, normId } = require('./traits');
const { tierScore } = require('./sources/util');

const SOURCES = [
  require('./sources/metatft'),
  require('./sources/tacticstools'),
  require('./sources/tftacademy'),
  require('./sources/lolchess'),
  require('./sources/tftflow'),
  require('./sources/bunnymuffins'),
];

const MEMO_AGE = 30 * 60 * 1000;
let memo = null;

function sourceInfo() {
  return SOURCES.map((s) => ({ id: s.id, name: s.name, kind: s.kind, url: s.url }));
}

async function loadSource(src, S, force) {
  const key = `source_${src.id}_set${S.setNumber}`;
  const cached = cache.read(key, src.maxAge);
  if (!force && cached?.fresh) return { ...cached.data, stale: false };
  try {
    const entries = await src.fetch(S);
    if (!entries.length) throw new Error('Kaynak boş veri döndürdü.');
    const data = { entries, fetchedAt: Date.now() };
    cache.write(key, data);
    return { ...data, stale: false };
  } catch (e) {
    if (cached?.data) return { ...cached.data, stale: true, error: e.message };
    throw e;
  }
}

const baseSet = (units, S) => new Set(units.map((u) => S.champById[u]?.baseName || u));

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

function finalize(members, S) {
  const statsMembers = members.filter((m) => m.kind === 'stats');
  const primaryStats = members.find((m) => m.sourceId === 'metatft') || statsMembers[0] || null;
  const guide = members.find((m) => m.sourceId === 'tftacademy') || null;
  const unitsSrc = primaryStats || guide || members.find((m) => m.units?.length >= 5) || null;
  const units = unitsSrc?.units || [];
  const carriesSrc = statsMembers.find((m) => m.carries?.length) || members.find((m) => m.carries?.length);
  const scores = members.map((m) => tierScore(m.tier)).filter((v) => v != null);
  const sum = scores.reduce((a, b) => a + b, 0);
  const score = scores.length ? sum / scores.length : null;
  let tier = score == null ? '?' : score >= 3.6 ? 'S' : score >= 2.75 ? 'A' : score >= 1.9 ? 'B' : 'C';
  // Tek bir kaynağın görüşü S tier için yeterli sayılmaz.
  if (tier === 'S' && scores.length < 2) tier = 'A';
  // Sıralamada az kaynaklı comp'lar ortalamaya (2,5) doğru çekilir; çok kaynaklı olanlar küçük bir bonus alır.
  const rankScore = scores.length ? (sum + 5) / (scores.length + 2) + 0.05 * members.length : null;
  const name = (primaryStats?.sourceId === 'metatft' && primaryStats.name) || guide?.name || members[0].name;

  return {
    id: members[0].id,
    name,
    altNames: [...new Set(members.map((m) => m.name).filter((n) => n && n !== name))],
    tier,
    tierScore: score,
    rankScore,
    units,
    stars: [...new Set(members.flatMap((m) => m.stars || []))].filter((u) => units.includes(u)),
    carries: carriesSrc?.carries || [],
    levelling: guide?.levelling || primaryStats?.levelling || members.find((m) => m.levelling)?.levelling || '',
    avg: primaryStats?.avg ?? null,
    top4: primaryStats?.top4 ?? null,
    win: primaryStats?.win ?? null,
    count: primaryStats?.count ?? 0,
    pick: primaryStats?.pick ?? null,
    places: primaryStats?.places || null,
    stats: statsMembers.map((m) => ({ source: m.sourceName, avg: m.avg, top4: m.top4, win: m.win, count: m.count })),
    sources: members.map((m) => ({ id: m.sourceId, name: m.sourceName, kind: m.kind, tier: m.tier || null, tag: m.tag || null, url: m.url, title: m.name })),
    augments: (guide?.augments?.length ? guide.augments : members.find((m) => m.augments?.length)?.augments) || [],
    guide: guide
      ? { early: guide.early, tips: guide.tips, carousel: guide.carousel, difficulty: guide.difficulty, augmentsTip: guide.augmentsTip, url: guide.url }
      : null,
    teamCode: units.length ? teamCode.encode(units, S) : members.find((m) => m.teamCode)?.teamCode || null,
    traits: computeTraits(units, S),
    mainChampion: carriesSrc?.carries?.[0]?.unit || members.find((m) => m.mainChampion)?.mainChampion || null,
  };
}

/**
 * Farklı sitelerden gelen comp'ları birim benzerliğine göre kümeler.
 * Birim listesi olmayan tier listeleri isim ve ana şampiyona göre en yakın kümeye bağlanır.
 */
function merge(entries, S) {
  const clusters = [];
  const kindOrder = { stats: 0, guide: 1 };
  const withUnits = entries.filter((e) => e.units?.length >= 5).sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
  const unitless = entries.filter((e) => !(e.units?.length >= 5));

  for (const e of withUnits) {
    const set = baseSet(e.units, S);
    const carries = new Set((e.carries || []).map((c) => c.unit));
    let best = null;
    let bestSim = 0;
    for (const c of clusters) {
      if (c.members.some((m) => m.sourceId === e.sourceId)) continue;
      const sim = jaccard(set, c.baseSet);
      const carryOk = !carries.size || !c.carrySet.size || [...carries].some((u) => c.carrySet.has(u));
      if (sim >= (carryOk ? 0.5 : 0.75) && sim > bestSim) { best = c; bestSim = sim; }
    }
    if (best) {
      best.members.push(e);
      for (const u of carries) best.carrySet.add(u);
    } else {
      clusters.push({ members: [e], baseSet: set, carrySet: new Set(carries), units: e.units });
    }
  }

  const champNorms = S.champions.map((c) => ({ id: c.apiName, n: normId(c.apiName) }));
  const traitNorms = S.traits.map((t) => ({ id: t.apiName, n: normId(t.apiName) }));
  for (const c of clusters) c.active = computeTraits(c.units, S).filter((t) => t.tierIndex > 0).map((t) => t.apiName);

  for (const e of unitless) {
    const tokens = String(e.name || '').toLowerCase().replace(/'/g, '').split(/[^a-z]+/).filter((t) => t.length >= 3);
    const match = (list) => list
      .filter((x) => tokens.some((t) => x.n === t || (t.length >= 4 && (x.n.startsWith(t) || t.startsWith(x.n)))))
      .map((x) => x.id);
    const nameUnits = new Set([...match(champNorms), ...(e.mainChampion ? [e.mainChampion] : [])]);
    const nameTraits = match(traitNorms);
    let best = null;
    let bestScore = 0;
    for (const c of clusters) {
      if (!c.units.length || c.members.some((m) => m.sourceId === e.sourceId)) continue;
      let score = 0;
      for (const u of nameUnits) if (c.units.includes(u)) score += c.carrySet.has(u) ? 3 : 1.5;
      for (const t of nameTraits) if (c.active.includes(t)) score += 1.5;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= 3) best.members.push(e);
    else clusters.push({ members: [e], baseSet: new Set(), carrySet: new Set(), units: [], active: [] });
  }

  return clusters
    .map((c) => finalize(c.members, S))
    .sort((a, b) =>
      (b.units.length > 0) - (a.units.length > 0) ||
      (b.rankScore ?? -1) - (a.rankScore ?? -1) ||
      b.sources.length - a.sources.length ||
      (a.avg ?? 9) - (b.avg ?? 9));
}

async function getComps(S, force = false, disabled = []) {
  const key = [...disabled].sort().join(',');
  if (!force && memo && memo.key === key && memo.setNumber === S.setNumber && Date.now() - memo.builtAt < MEMO_AGE) return memo.data;

  const active = SOURCES.filter((s) => !disabled.includes(s.id));
  const results = await Promise.allSettled(active.map((s) => loadSource(s, S, force)));
  const sources = [];
  const entries = [];
  results.forEach((r, i) => {
    const s = active[i];
    const info = { id: s.id, name: s.name, kind: s.kind, url: s.url };
    if (r.status === 'fulfilled') {
      entries.push(...r.value.entries.map((e) => ({ ...e, kind: s.kind, sourceId: s.id, sourceName: s.name, url: e.url || s.url })));
      sources.push({ ...info, ok: true, count: r.value.entries.length, stale: r.value.stale, error: r.value.error || null, fetchedAt: r.value.fetchedAt });
    } else {
      sources.push({ ...info, ok: false, count: 0, error: r.reason?.message || String(r.reason) });
    }
  });
  if (!entries.length) {
    throw new Error(`Hiçbir meta kaynağına ulaşılamadı. ${sources.map((s) => `${s.name}: ${s.error}`).join(' · ')}`);
  }
  const data = { fetchedAt: Date.now(), setNumber: S.setNumber, sources, comps: merge(entries, S) };
  memo = { key, setNumber: S.setNumber, builtAt: Date.now(), data };
  return data;
}

module.exports = { getComps, sourceInfo };
