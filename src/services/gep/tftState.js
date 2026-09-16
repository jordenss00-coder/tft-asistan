const { makeResolver } = require('../traits');

// Overwolf Game Events Provider (GEP) verisini uygulamanın canlı durumuna çevirir.
// Buradaki her şey saf fonksiyondur: Electron, ağ veya zamanlayıcı kullanmaz, test edilebilir.

const TFT_GAME_ID = 21570;
const LOL_GAME_ID = 5426;
const REQUIRED_FEATURES = ['me', 'match_info', 'board', 'bench', 'store'];
const SHOP_SLOTS = 5;

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]/g, '');

function emptyState() {
  return {
    matchId: null,
    board: [],
    bench: [],
    shop: [],
    freeItems: [],
    gold: null,
    level: null,
    xp: null,
    xpMax: null,
    hp: null,
    stage: null,
    roundType: null,
    battleInProgress: null,
    matchInProgress: null,
    summonerName: null,
    tagLine: null,
    updatedAt: null,
    unknownNames: [],
    seen: {},
  };
}

/** GEP değerleri kimi zaman nesne, kimi zaman JSON metni olarak gelir. */
function parseValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (text[0] === '{' || text[0] === '[') {
    try { return JSON.parse(text); } catch { return value; }
  }
  return value;
}

const resolverCache = new WeakMap();

function resolvers(S) {
  let r = resolverCache.get(S);
  if (!r) {
    const byName = new Map();
    for (const c of S.champions || []) {
      byName.set(norm(c.name), c.apiName);
      if (c.baseName) byName.set(norm(c.baseName), c.apiName);
    }
    const itemByName = new Map();
    for (const it of Object.values(S.items || {})) itemByName.set(norm(it.name), it.apiName);
    r = { unit: makeResolver(S.champById || {}), item: makeResolver(S.items || {}), byName, itemByName };
    resolverCache.set(S, r);
  }
  return r;
}

/** Bilinmeyen adı zorla bir şampiyona eşlemez; null döner. */
function resolveUnitId(name, S) {
  if (!name) return null;
  if (S.champById?.[name]) return name;
  const r = resolvers(S);
  const hit = r.unit(name);
  if (hit?.apiName) return hit.apiName;
  return r.byName.get(norm(name)) || null;
}

function resolveItemId(name, S) {
  if (!name) return null;
  if (S.items?.[name]) return name;
  const r = resolvers(S);
  const hit = r.item(name);
  if (hit?.apiName) return hit.apiName;
  return r.itemByName.get(norm(name)) || null;
}

function parsePiece(raw, S) {
  const v = parseValue(raw);
  if (!v || typeof v !== 'object') return null;
  const name = v.name ?? v.champion ?? v.id;
  if (!name || /^(sold|empty|none)$/i.test(String(name))) return null;
  const id = resolveUnitId(name, S);
  const starRaw = Number(v.level ?? v.star ?? v.stars);
  const star = [1, 2, 3].includes(starRaw) ? starRaw : 1;
  const items = [v.item_1, v.item_2, v.item_3, ...(Array.isArray(v.items) ? v.items : [])]
    .map((n) => resolveItemId(typeof n === 'object' ? n?.name : n, S))
    .filter(Boolean)
    .slice(0, 3);
  return { id, star, items, raw: String(name), unknown: !id };
}

/** `{cell_3: {...}}` veya JSON metni → sıralı parça listesi. */
function parsePieces(value, S) {
  const v = parseValue(value);
  if (!v || typeof v !== 'object') return null;
  const entries = Array.isArray(v)
    ? v.map((piece, i) => [`cell_${i}`, piece])
    : Object.entries(v);
  const out = [];
  for (const [key, raw] of entries) {
    const piece = parsePiece(raw, S);
    if (!piece) continue;
    const cell = Number(String(key).match(/(\d+)/)?.[1]);
    out.push({ ...piece, cell: Number.isFinite(cell) ? cell : null });
  }
  return out;
}

function parseShop(value, S) {
  const v = parseValue(value);
  if (!v || typeof v !== 'object') return null;
  const slots = new Array(SHOP_SLOTS).fill(null);
  for (const [key, raw] of Object.entries(v)) {
    const index = Number(String(key).match(/(\d+)/)?.[1]);
    const piece = parsePiece(raw, S);
    const slot = Number.isFinite(index) ? index : -1;
    if (slot < 0 || slot >= SHOP_SLOTS) continue;
    slots[slot] = piece?.id ? { id: piece.id, cost: piece.cost ?? null } : null;
  }
  return slots;
}

/** Yalnızca yerel oyuncunun boştaki eşyaları; oyuncu kesin ayırt edilemiyorsa null döner. */
function parseItemBench(value, state, S) {
  const v = parseValue(value);
  if (!Array.isArray(v)) return null;
  const me = norm(state.summonerName);
  if (!me) return null;
  const mine = v.filter((entry) => {
    const name = norm(entry?.summoner ?? entry?.summoner_name ?? entry?.name);
    if (!name || name !== me) return false;
    if (state.tagLine && entry?.tag_line && norm(entry.tag_line) !== norm(state.tagLine)) return false;
    return true;
  });
  if (mine.length !== 1) return null;
  const out = [];
  for (const item of mine[0].bench_items || mine[0].items || []) {
    const id = resolveItemId(typeof item === 'object' ? item?.name : item, S);
    if (!id) continue;
    const count = Math.max(1, Number(item?.count) || 1);
    for (let i = 0; i < count; i++) out.push(id);
  }
  return out;
}

function parseStage(value) {
  const v = parseValue(value);
  const text = typeof v === 'object' ? (v?.stage ?? v?.name ?? '') : v;
  const m = String(text ?? '').match(/(\d{1,2})\s*-\s*(\d)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

const asNumber = (value) => {
  const n = Number(parseValue(value));
  return Number.isFinite(n) ? n : null;
};

const asBool = (value) => {
  const v = parseValue(value);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object' && v) return asBool(v.in_progress ?? v.state ?? null);
  if (v == null) return null;
  return /^(true|1|yes)$/i.test(String(v));
};

/**
 * Tek bir GEP güncellemesini duruma işler. Yeni durum nesnesi döner; girdi değiştirilmez.
 * Tanınmayan alanlar ve rakip verileri yok sayılır.
 */
function applyInfo(state, update, S) {
  if (!update) return state;
  if (update.gameId != null && Number(update.gameId) !== TFT_GAME_ID) return state;
  const category = String(update.category || update.feature || '').toLowerCase();
  const key = String(update.key || '').toLowerCase();
  if (!key) return state;
  if (/opponent|enemy|roster/.test(`${category}.${key}`)) return state;

  const at = update.at || Date.now();
  const next = { ...state, seen: { ...state.seen, [`${category}.${key}`]: at } };
  const touch = () => { next.updatedAt = at; return next; };

  if (category === 'board' && key === 'board_pieces') {
    const pieces = parsePieces(update.value, S);
    if (!pieces) return state;
    next.board = pieces.filter((p) => p.id);
    next.unknownNames = [...new Set(pieces.filter((p) => p.unknown).map((p) => p.raw))];
    return touch();
  }
  if (category === 'bench' && key === 'bench_pieces') {
    const pieces = parsePieces(update.value, S);
    if (!pieces) return state;
    next.bench = pieces.filter((p) => p.id);
    return touch();
  }
  if (category === 'bench' && key === 'item_bench') {
    const items = parseItemBench(update.value, state, S);
    if (items == null) return state;
    next.freeItems = items;
    return touch();
  }
  if (category === 'store' && (key === 'shop_pieces' || key === 'store_pieces')) {
    const shop = parseShop(update.value, S);
    if (!shop) return state;
    next.shop = shop;
    return touch();
  }
  if (category === 'me') {
    if (key === 'gold') { const n = asNumber(update.value); if (n == null) return state; next.gold = n; return touch(); }
    if (key === 'health' || key === 'hp') { const n = asNumber(update.value); if (n == null) return state; next.hp = n; return touch(); }
    if (key === 'xp' || key === 'level') {
      const v = parseValue(update.value);
      if (v && typeof v === 'object') {
        const level = asNumber(v.level);
        if (level != null) next.level = level;
        const xp = asNumber(v.current_xp ?? v.xp);
        if (xp != null) next.xp = xp;
        const xpMax = asNumber(v.xp_max ?? v.max_xp);
        if (xpMax != null) next.xpMax = xpMax;
      } else {
        const n = asNumber(v);
        if (n == null) return state;
        if (key === 'level') next.level = n; else next.xp = n;
      }
      return touch();
    }
    if (key === 'summoner_name' || key === 'name') {
      const v = parseValue(update.value);
      const name = typeof v === 'object' ? v?.summoner ?? v?.name : v;
      if (!name) return state;
      next.summonerName = String(name);
      if (typeof v === 'object' && v?.tag_line) next.tagLine = String(v.tag_line);
      return touch();
    }
    return state;
  }
  if (category === 'match_info') {
    if (key === 'pseudo_match_id' || key === 'match_id') {
      const id = String(parseValue(update.value) ?? '');
      if (!id) return state;
      if (state.matchId && state.matchId !== id) {
        // Yeni maç: eski tahta/dükkan/eşya verisi taşınmaz.
        const fresh = emptyState();
        fresh.summonerName = state.summonerName;
        fresh.tagLine = state.tagLine;
        fresh.matchId = id;
        fresh.updatedAt = at;
        return fresh;
      }
      next.matchId = id;
      return touch();
    }
    if (key === 'round_type' || key === 'round' || key === 'stage') {
      const stage = parseStage(update.value);
      const v = parseValue(update.value);
      if (typeof v === 'object' && v) next.roundType = v.type ?? v.name ?? null;
      if (stage) next.stage = stage;
      return stage || next.roundType ? touch() : state;
    }
    if (key === 'battle_state') { const b = asBool(update.value); if (b == null) return state; next.battleInProgress = b; return touch(); }
    if (key === 'match_state') {
      const b = asBool(update.value);
      if (b == null) return state;
      next.matchInProgress = b;
      if (b === false) {
        const fresh = emptyState();
        fresh.summonerName = state.summonerName;
        fresh.tagLine = state.tagLine;
        fresh.matchId = state.matchId;
        fresh.matchInProgress = false;
        fresh.updatedAt = at;
        return fresh;
      }
      return touch();
    }
    return state;
  }
  return state;
}

/** `getInfo` anlık görüntüsü: {category: {key: value}} veya düz liste. */
function applySnapshot(state, info, S) {
  const data = parseValue(info);
  if (!data || typeof data !== 'object') return state;
  const source = data.info && typeof data.info === 'object' ? data.info : data;
  let next = state;
  for (const [category, values] of Object.entries(source)) {
    if (!values || typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values)) {
      next = applyInfo(next, { category, key, value, gameId: TFT_GAME_ID }, S);
    }
  }
  return next;
}

/** Tahtadaki takılı eşyalar boştaki eşyalardan ayrı tutulur. */
function splitFreeItems(state, S) {
  const components = [];
  const completed = [];
  for (const id of state.freeItems || []) {
    const def = S.items?.[id];
    if (!def) continue;
    if (/^DA_Component_/.test(id) || (def.from?.length === 0 && /component/i.test(id))) components.push(id);
    else completed.push(id);
  }
  return { components, completed };
}

/** Canlı koç durumuna çevirir. Tahta ve yedek ayrı kalır; takılı eşyalar yeniden üretilecek gibi görünmez. */
function toLive(state, S) {
  const { components, completed } = splitFreeItems(state, S);
  return {
    units: (state.board || []).map((u) => ({ id: u.id, star: u.star, items: u.items, cell: u.cell })),
    bench: (state.bench || []).map((u) => ({ id: u.id, star: u.star, items: u.items })),
    shop: (state.shop || []).map((s) => s?.id || null),
    equippedItems: (state.board || []).flatMap((u) => u.items),
    components,
    completed,
    gold: state.gold,
    level: state.level,
    xp: state.xp,
    hp: state.hp,
    stage: state.stage,
    battleInProgress: state.battleInProgress,
    matchId: state.matchId,
    updatedAt: state.updatedAt,
    unknownNames: state.unknownNames || [],
  };
}

/**
 * Canlı duruma uygulanacak yama: yalnızca gerçekten gelmiş alanları içerir.
 * Böylece GEP verisi, kullanıcının elle girdiği değerleri boş değerle ezmez.
 */
function toLivePatch(state, S) {
  const live = toLive(state, S);
  const patch = {};
  for (const key of ['gold', 'level', 'xp', 'hp', 'stage']) {
    if (live[key] != null) patch[key] = live[key];
  }
  if (state.seen['board.board_pieces']) patch.units = live.units;
  if (state.seen['bench.bench_pieces']) patch.bench = live.bench;
  if (state.seen['store.shop_pieces'] || state.seen['store.store_pieces']) patch.shop = live.shop;
  if (state.seen['bench.item_bench']) {
    patch.components = live.components;
    patch.completed = live.completed;
  }
  return patch;
}

/** Öneri vermeye yetecek kadar canlı veri geldi mi? */
function isUsable(state) {
  return state.gold != null && state.level != null && (state.board?.length > 0 || state.stage != null);
}

module.exports = {
  TFT_GAME_ID, LOL_GAME_ID, REQUIRED_FEATURES, SHOP_SLOTS,
  emptyState, applyInfo, applySnapshot, toLive, toLivePatch, isUsable, splitFreeItems,
  parseValue, parsePieces, parseShop, parseItemBench, resolveUnitId, resolveItemId,
};
