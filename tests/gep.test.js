const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  TFT_GAME_ID, LOL_GAME_ID, emptyState, applyInfo, applySnapshot, toLive, toLivePatch, isUsable,
} = require('../src/services/gep/tftState');
const { createGepClient } = require('../src/services/gep/client');

const champions = [
  { apiName: 'DA_18_Ahri', name: 'Ahri', baseName: 'Ahri', cost: 4, traits: [] },
  { apiName: 'DA_18_Sett', name: 'Sett', baseName: 'Sett', cost: 4, traits: [] },
  { apiName: 'DA_Krug18', name: 'Kayacıl', baseName: 'Kayacıl', cost: 3, traits: [] },
  { apiName: 'DA_18_Yorick', name: 'Yorick', baseName: 'Yorick', cost: 1, traits: [] },
  { apiName: 'DA_18_Varus', name: 'Varus', baseName: 'Varus', cost: 1, traits: [] },
];
const items = {
  DA_Component_BFSword: { apiName: 'DA_Component_BFSword', name: 'TEK Kılıcı', from: [] },
  DA_Component_RecurveBow: { apiName: 'DA_Component_RecurveBow', name: 'Nişancı Yayı', from: [] },
  DA_Deathblade: { apiName: 'DA_Deathblade', name: 'Ölüm Kılıcı', from: ['DA_Component_BFSword', 'DA_Component_BFSword'] },
};
const S = {
  setNumber: 18,
  champions,
  champById: Object.fromEntries(champions.map((c) => [c.apiName, c])),
  items,
  recipes: { 'DA_Component_BFSword|DA_Component_BFSword': 'DA_Deathblade' },
  traits: [],
  traitsById: {},
};

const info = (category, key, value, gameId = TFT_GAME_ID) => ({ category, key, value, gameId });
const boardValue = { cell_3: { name: 'DA_18_Ahri', level: 2, item_1: 'DA_Deathblade' } };

test('JSON metni ve nesne biçimindeki güncellemeler aynı duruma dönüşür', () => {
  const asObject = applyInfo(emptyState(), info('board', 'board_pieces', boardValue), S);
  const asString = applyInfo(emptyState(), info('board', 'board_pieces', JSON.stringify(boardValue)), S);
  assert.deepEqual(toLive(asString, S).units, toLive(asObject, S).units);
  assert.deepEqual(toLive(asObject, S).units, [{ id: 'DA_18_Ahri', star: 2, items: ['DA_Deathblade'], cell: 3 }]);
});

test('boş tahta tahtayı temizler, eksik alan tahtayı korur', () => {
  const withBoard = applyInfo(emptyState(), info('board', 'board_pieces', boardValue), S);
  assert.equal(applyInfo(withBoard, info('board', 'board_pieces', {}), S).board.length, 0);
  // Yalnızca altın güncellemesi geldiğinde tahta silinmez
  const goldOnly = applyInfo(withBoard, info('me', 'gold', 42), S);
  assert.equal(goldOnly.board.length, 1);
  assert.equal(goldOnly.gold, 42);
});

test('satılan birim ve yıldız birleşmesi yansır, yedekler tahtaya karışmaz', () => {
  let state = applyInfo(emptyState(), info('board', 'board_pieces', { cell_1: { name: 'Ahri', level: 1 }, cell_2: { name: 'Sett', level: 1 } }), S);
  state = applyInfo(state, info('bench', 'bench_pieces', { cell_0: { name: 'Kayacıl', level: 1 } }), S);
  state = applyInfo(state, info('board', 'board_pieces', { cell_1: { name: 'Ahri', level: 2 } }), S);
  const live = toLive(state, S);
  assert.deepEqual(live.units.map((u) => [u.id, u.star]), [['DA_18_Ahri', 2]]);
  assert.deepEqual(live.bench.map((u) => u.id), ['DA_Krug18']);
});

test('dükkanda satılan/boş yuva null olur ve sıra korunur', () => {
  const state = applyInfo(emptyState(), info('store', 'shop_pieces', {
    slot_0: { name: 'Ahri' }, slot_1: { name: 'Sold' }, slot_3: { name: 'Yorick' },
  }), S);
  assert.deepEqual(toLive(state, S).shop, ['DA_18_Ahri', null, null, 'DA_18_Yorick', null]);
});

test('takılı eşya boştaki eşya sayılmaz', () => {
  let state = applyInfo(emptyState(), info('me', 'summoner_name', 'Oyuncu'), S);
  state = applyInfo(state, info('board', 'board_pieces', boardValue), S);
  state = applyInfo(state, info('bench', 'item_bench', [
    { summoner: 'Oyuncu', tag_line: 'TR1', bench_items: [{ name: 'DA_Component_BFSword', count: 2 }] },
  ]), S);
  const live = toLive(state, S);
  assert.deepEqual(live.components, ['DA_Component_BFSword', 'DA_Component_BFSword']);
  assert.deepEqual(live.completed, []);
  assert.deepEqual(live.equippedItems, ['DA_Deathblade']);
});

test('item bench yalnızca kendi oyuncunun eşyalarını alır, belirsizse atlar', () => {
  const base = applyInfo(emptyState(), info('me', 'summoner_name', 'Oyuncu'), S);
  const other = applyInfo(base, info('bench', 'item_bench', [
    { summoner: 'Rakip', bench_items: [{ name: 'DA_Component_BFSword' }] },
  ]), S);
  assert.deepEqual(other.freeItems, []);
  // İsim bilinmiyorsa hiç işlenmez
  const noName = applyInfo(emptyState(), info('bench', 'item_bench', [
    { summoner: 'Oyuncu', bench_items: [{ name: 'DA_Component_BFSword' }] },
  ]), S);
  assert.deepEqual(noName.freeItems, []);
});

test('rakip verisi hiçbir değişiklik üretmez', () => {
  const state = applyInfo(emptyState(), info('board', 'board_pieces', boardValue), S);
  const after = applyInfo(state, info('board', 'opponent_board_pieces', { cell_0: { name: 'Sett' } }), S);
  assert.equal(after, state);
});

test('maç sonu ve yeni maç eski veriyi temizler', () => {
  let state = applyInfo(emptyState(), info('me', 'summoner_name', 'Oyuncu'), S);
  state = applyInfo(state, info('match_info', 'pseudo_match_id', 'match-1'), S);
  state = applyInfo(state, info('board', 'board_pieces', boardValue), S);
  const newMatch = applyInfo(state, info('match_info', 'pseudo_match_id', 'match-2'), S);
  assert.equal(newMatch.board.length, 0);
  assert.equal(newMatch.matchId, 'match-2');
  assert.equal(newMatch.summonerName, 'Oyuncu');
  const ended = applyInfo(state, info('match_info', 'match_state', { in_progress: false }), S);
  assert.equal(ended.board.length, 0);
  assert.equal(ended.matchInProgress, false);
});

test('LoL olayları TFT durumuna işlenmez', () => {
  const state = applyInfo(emptyState(), info('me', 'gold', 50, LOL_GAME_ID), S);
  assert.equal(state.gold, null);
});

test('bilinmeyen şampiyon zorla eşleşmez, ayrıca işaretlenir', () => {
  const state = applyInfo(emptyState(), info('board', 'board_pieces', { cell_0: { name: 'DA_18_Bilinmeyen' }, cell_1: { name: 'Ahri' } }), S);
  assert.deepEqual(state.board.map((u) => u.id), ['DA_18_Ahri']);
  assert.deepEqual(state.unknownNames, ['DA_18_Bilinmeyen']);
});

test('anlık görüntü iki farklı biçimde de aynı sonucu verir', () => {
  const flat = applySnapshot(emptyState(), { me: { gold: 30 }, board: { board_pieces: boardValue } }, S);
  const wrapped = applySnapshot(emptyState(), { info: { me: { gold: 30 }, board: { board_pieces: boardValue } } }, S);
  assert.equal(flat.gold, 30);
  assert.deepEqual(toLive(wrapped, S).units, toLive(flat, S).units);
  assert.equal(isUsable(flat), false); // seviye gelmeden öneri verilmez
  const withLevel = applyInfo(flat, info('me', 'xp', { level: 6, current_xp: 4, xp_max: 36 }), S);
  assert.equal(isUsable(withLevel), true);
  assert.equal(withLevel.level, 6);
});

function fakeOverwolf() {
  const gep = new EventEmitter();
  gep.getFeatures = async () => ['me', 'match_info', 'board', 'bench', 'store'];
  gep.setRequiredFeatures = async () => { gep.featuresSet = (gep.featuresSet || 0) + 1; };
  gep.getInfo = async () => ({ me: { gold: 20 } });
  const packages = new EventEmitter();
  packages.gep = gep;
  return { packages, gep };
}

test('tekrarlanan ready/detected olayları çift dinleyici veya çift kayıt üretmez', async () => {
  const { packages, gep } = fakeOverwolf();
  const client = createGepClient({ overwolf: { packages }, getStatic: () => S, logger: { warn() {} } });
  client.start();
  packages.emit('ready', {}, 'gep');
  packages.emit('ready', {}, 'gep');
  assert.equal(gep.listenerCount('new-info-update'), 1);
  const enable = { enable: () => {} };
  gep.emit('game-detected', enable, TFT_GAME_ID, 'TFT');
  gep.emit('game-detected', enable, TFT_GAME_ID, 'TFT');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gep.featuresSet, 1);
  client.stop();
  assert.equal(gep.listenerCount('new-info-update'), 0);
});

test('sahte GEP: olaylar canlı duruma ve öneri motoruna ulaşır', async () => {
  const { packages, gep } = fakeOverwolf();
  const seen = [];
  const client = createGepClient({ overwolf: { packages }, getStatic: () => S, onLive: (live) => seen.push(live), logger: { warn() {} } });
  client.start();
  packages.emit('ready', {}, 'gep');
  gep.emit('game-detected', { enable: () => {} }, TFT_GAME_ID, 'TFT');
  await new Promise((r) => setTimeout(r, 10));
  gep.emit('new-info-update', {}, TFT_GAME_ID, {
    category: 'board',
    key: 'board_pieces',
    value: {
      cell_3: { name: 'DA_18_Ahri', level: 2, item_1: 'DA_Deathblade' },
      cell_5: { name: 'Sett', level: 1 },
      cell_9: { name: 'Yorick', level: 2 },
    },
  });
  gep.emit('new-info-update', {}, TFT_GAME_ID, { category: 'me', key: 'gold', value: 30 });
  gep.emit('new-info-update', {}, TFT_GAME_ID, { category: 'me', key: 'xp', value: { level: 7, current_xp: 0, xp_max: 56 } });
  const live = client.getLive();
  assert.deepEqual(live.units.map((u) => u.id), ['DA_18_Ahri', 'DA_18_Sett', 'DA_18_Yorick']);
  assert.equal(live.gold, 30);
  assert.equal(live.level, 7);
  assert.equal(client.isUsable(), true);
  assert.equal(client.getStatus().mode, 'live');
  assert.ok(seen.length >= 3);

  const { coachNow } = require('../src/services/engine');
  const comps = [{
    id: 'c1',
    name: 'Test',
    units: ['DA_18_Ahri', 'DA_18_Sett', 'DA_18_Yorick', 'DA_Krug18', 'DA_18_Varus'],
    levelling: 'Fast 8',
    stars: [], carries: [{ unit: 'DA_18_Ahri', items: ['DA_Deathblade'] }], traits: [], sources: [], augments: [], tier: 'A',
  }];
  const advice = coachNow({ S, metaComps: comps, state: { ...live, stage: '3-2' } });
  assert.equal(advice.detectedComp?.id, 'c1'); // tahtadaki gerçek birimlerden eşleşti
  assert.equal(advice.chosenCompId, 'c1');
  assert.ok(advice.econ.primary.title.length > 0);
  assert.deepEqual(advice.missing, []);

  // GEP'ten tur bilgisi gelmeden ekonomi önerisi üretilmez, hata da fırlatılmaz.
  const withoutStage = coachNow({ S, metaComps: comps, state: live });
  assert.equal(withoutStage.econ, null);
  assert.equal(withoutStage.board, null);
  assert.ok(withoutStage.missing.includes('stage'));
  assert.ok(Array.isArray(withoutStage.round));
  assert.equal(withoutStage.chosenCompId, 'c1'); // comp eşleştirme tur bilgisi olmadan da çalışır

  gep.emit('game-exit', {}, TFT_GAME_ID, 'TFT', 1234, '', '', '');
  assert.equal(client.getState().board.length, 0);
  assert.equal(client.getStatus().mode, 'waitingGame');
  client.stop();
});

test('canlı yama yalnızca gelen alanları içerir, elle girilen değerleri ezmez', () => {
  let state = applyInfo(emptyState(), info('me', 'gold', 30), S);
  let patch = toLivePatch(state, S);
  assert.deepEqual(Object.keys(patch).sort(), ['gold']);
  assert.equal(patch.units, undefined); // tahta verisi gelmediyse birimler silinmez

  state = applyInfo(state, info('board', 'board_pieces', boardValue), S);
  patch = toLivePatch(state, S);
  assert.deepEqual(patch.units.map((u) => u.id), ['DA_18_Ahri']);
  assert.equal(patch.shop, undefined);

  // Boş tahta bilgisi geldiyse birimler bilerek temizlenir
  state = applyInfo(state, info('board', 'board_pieces', {}), S);
  assert.deepEqual(toLivePatch(state, S).units, []);
});

test('Overwolf çalışma zamanı yoksa istemci sessizce devre dışı kalır', () => {
  const client = createGepClient({ overwolf: undefined, getStatic: () => S });
  const status = client.start();
  assert.equal(status.mode, 'unavailable');
  assert.equal(client.isUsable(), false);
});

test('yetki ve hata durumları duruma yansır', async () => {
  const { packages, gep } = fakeOverwolf();
  const statuses = [];
  const client = createGepClient({ overwolf: { packages }, getStatic: () => S, onStatus: (s) => statuses.push(s.mode), logger: { warn() {} } });
  client.start();
  packages.emit('ready', {}, 'gep');
  gep.emit('elevated-privileges-required', {}, TFT_GAME_ID, 'TFT', 1);
  assert.equal(client.getStatus().mode, 'needsElevation');
  gep.emit('error', {}, TFT_GAME_ID, 'bağlantı koptu');
  assert.equal(client.getStatus().mode, 'error');
  assert.equal(client.getStatus().error, 'bağlantı koptu');
  assert.ok(statuses.includes('waitingPackage'));
  client.stop();
});
