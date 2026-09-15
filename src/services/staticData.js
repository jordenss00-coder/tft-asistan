const { fetchJson } = require('./http');
const cache = require('./cache');

const CDRAGON = 'https://raw.communitydragon.org/latest';
const DATA_URL = `${CDRAGON}/cdragon/tft/tr_tr.json`;
const TEAM_PLANNER_URL = `${CDRAGON}/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json`;
const MAX_AGE = 12 * 60 * 60 * 1000;
const CACHE_VERSION = 4;

const COMPONENT_ORDER = [
  'BFSword', 'RecurveBow', 'NeedlesslyLargeRod', 'TearOfTheGoddess', 'ChainVest',
  'NegatronCloak', 'GiantsBelt', 'SparringGloves', 'Spatula', 'FryingPan',
];
const TEAM_SIZE_RE = /takım (boyutu|kapasitesi|büyüklüğü)|team size|\+\s*1\s*(azami\s*)?(birim|şampiyon)\s*(sınırı|limiti)/i;

let loaded = null;
let loading = null;

function iconUrl(p) {
  if (!p) return null;
  return `${CDRAGON}/game/${p.toLowerCase().replace(/\.(tex|dds)$/, '.png')}`;
}

function cleanText(t) {
  return String(t || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/%i:[^%]+%/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '?';
  return String(Math.round(v * 100) / 100);
}

/** CommunityDragon bazı değişkenleri adı yerine FNV-1a karmasıyla ({a9a813e7}) verir. */
function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function lookupVar(vars, key) {
  if (!vars) return undefined;
  if (key in vars) return vars[key];
  const k = Object.keys(vars).find((x) => x.toLowerCase() === key.toLowerCase());
  if (k !== undefined) return vars[k];
  const hashed = `{${fnv1a(key.toLowerCase())}}`;
  return hashed in vars ? vars[hashed] : undefined;
}

function fillVars(text, resolve) {
  // Çözülemeyen değişkenlerde baştaki "%" de düşürülür ki metinde "%?" gibi kırık ifade kalmasın.
  return String(text || '').replace(/(%?)@([^@]+)@/g, (_, pct, expr) => {
    const [key, mult] = expr.split('*');
    const v = resolve(key.trim());
    const m = mult ? Number(mult) || 1 : 1;
    if (Array.isArray(v)) return pct + v.map((x) => formatNum(x * m)).join('/');
    if (typeof v !== 'number') return '?';
    return pct + formatNum(v * m);
  });
}

function buildTrait(t) {
  const effects = t.effects || [];
  const [header, ...rowParts] = String(t.desc || '').split(/<row>/i);
  const tiers = effects.map((e, i) => {
    const row = rowParts[i] ? rowParts[i].replace(/<\/row>[\s\S]*/i, '') : '';
    const text = cleanText(fillVars(row, (k) => (k === 'MinUnits' ? e.minUnits : lookupVar(e.variables, k))));
    return { minUnits: e.minUnits, text };
  });
  const breakpoints = [...new Set(tiers.map((x) => x.minUnits))].sort((a, b) => a - b);
  return {
    apiName: t.apiName,
    name: t.name,
    icon: iconUrl(t.icon),
    summary: cleanText(fillVars(header, (k) => lookupVar(effects[0]?.variables, k))),
    tiers,
    breakpoints,
    unique: false,
    emblem: null,
    augments: [],
  };
}

function buildChampion(c, traitByName) {
  const vars = {};
  for (const v of c.ability?.variables || []) vars[v.name] = v.value;
  const abilityDesc = cleanText(fillVars(c.ability?.desc, (k) => {
    const v = lookupVar(vars, k);
    return Array.isArray(v) ? v.slice(1, 4) : v;
  }));
  return {
    apiName: c.apiName,
    name: c.name,
    baseName: c.name.replace(/\s*\(.*\)\s*$/, ''),
    cost: c.cost,
    traits: (c.traits || []).map((n) => traitByName.get(n)?.apiName).filter(Boolean),
    traitNames: c.traits || [],
    icon: iconUrl(c.tileIcon || c.squareIcon || c.icon),
    ability: c.ability ? { name: c.ability.name, desc: abilityDesc } : null,
    stats: c.stats ? {
      hp: c.stats.hp, ad: c.stats.damage, as: c.stats.attackSpeed, armor: c.stats.armor,
      mr: c.stats.magicResist, mana: c.stats.mana, initialMana: c.stats.initialMana, range: c.stats.range,
    } : null,
  };
}

function build(json, teamPlanner) {
  const standard = (json.setData || [])
    .filter((s) => /^TFTSet\d+$/.test(s.mutator || ''))
    .sort((a, b) => b.number - a.number)[0];
  if (!standard) throw new Error('Güncel set verisi bulunamadı.');

  const teamPlannerCodes = {};
  const codeToUnit = {};
  for (const e of teamPlanner?.[standard.mutator] || []) {
    if (!e.character_id || !e.team_planner_code) continue;
    teamPlannerCodes[e.character_id] = e.team_planner_code;
    codeToUnit[e.team_planner_code] = e.character_id;
  }

  const traits = standard.traits.map(buildTrait);
  const traitsById = Object.fromEntries(traits.map((t) => [t.apiName, t]));
  const traitByName = new Map(traits.map((t) => [t.name, t]));

  const champions = standard.champions
    .filter((c) => c.cost >= 1 && c.cost <= 5 && (c.traits || []).length > 0)
    .map((c) => buildChampion(c, traitByName))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'tr'));
  const champById = Object.fromEntries(champions.map((c) => [c.apiName, c]));

  // Tek bir şampiyona ait trait'ler "unique" sayılır.
  for (const t of traits) {
    const bases = new Set(champions.filter((c) => c.traits.includes(t.apiName)).map((c) => c.baseName));
    t.unique = bases.size <= 1;
  }

  const setItemIds = new Set(standard.items || []);
  const setAugIds = new Set(standard.augments || []);
  const items = {};
  for (const it of json.items || []) {
    const isSetAug = setAugIds.has(it.apiName);
    const keep = setItemIds.has(it.apiName) || isSetAug || (/^DA_/.test(it.apiName) && !it.isAugment);
    if (!keep) continue;
    items[it.apiName] = {
      apiName: it.apiName,
      name: it.name,
      icon: iconUrl(it.icon),
      desc: cleanText(fillVars(it.desc, (k) => lookupVar(it.effects, k))),
      from: it.composition || [],
      isAugment: !!it.isAugment || isSetAug,
      traits: it.associatedTraits || [],
    };
  }

  const components = COMPONENT_ORDER.map((n) => `DA_Component_${n}`).filter((id) => items[id]);
  const componentSet = new Set(components);
  const recipes = {};
  for (const it of Object.values(items)) {
    if (it.isAugment || it.from.length !== 2 || !it.from.every((f) => componentSet.has(f))) continue;
    const key = [...it.from].sort().join('|');
    if (!recipes[key]) recipes[key] = it.apiName;
  }

  // Amblemler: "Çiçek Amblemi" -> Çiçek trait'i. Craft edilebilir olan tercih edilir.
  for (const it of Object.values(items)) {
    if (it.isAugment || !/Emblem/i.test(it.apiName)) continue;
    const trait = traits.find((t) => it.name.startsWith(`${t.name} `));
    if (!trait) continue;
    const craftable = it.from.length === 2;
    if (!trait.emblem || (craftable && !trait.emblem.craftable)) {
      trait.emblem = { apiName: it.apiName, name: it.name, icon: it.icon, from: it.from, craftable };
    }
  }

  const augments = [...setAugIds].filter((id) => items[id]);
  for (const t of traits) {
    t.augments = augments.filter((id) => {
      const a = items[id];
      return a.traits.includes(t.apiName) || a.name.includes(t.name);
    });
  }
  const teamSizeAugments = augments.filter((id) => TEAM_SIZE_RE.test(items[id].desc));

  return {
    cacheVersion: CACHE_VERSION,
    setNumber: standard.number,
    setName: standard.name,
    mutator: standard.mutator,
    loadedAt: Date.now(),
    traits: traits.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    traitsById,
    champions,
    champById,
    items,
    components,
    recipes,
    augments,
    teamSizeAugments,
    teamPlannerCodes,
    codeToUnit,
  };
}

async function load(force = false) {
  if (loaded && !force) return loaded;
  if (loading) return loading;
  loading = (async () => {
    const cached = cache.read('static_tr', MAX_AGE);
    const usable = cached?.data?.cacheVersion === CACHE_VERSION;
    if (!force && usable && cached.fresh) return cached.data;
    try {
      const [json, teamPlanner] = await Promise.all([
        fetchJson(DATA_URL, { timeoutMs: 120000 }),
        fetchJson(TEAM_PLANNER_URL, { timeoutMs: 60000 }).catch(() => null),
      ]);
      const data = build(json, teamPlanner);
      cache.write('static_tr', data);
      return data;
    } catch (e) {
      if (usable) return cached.data;
      throw new Error(`Set verisi indirilemedi: ${e.message}`);
    }
  })();
  try {
    loaded = await loading;
    return loaded;
  } finally {
    loading = null;
  }
}

module.exports = { load };
