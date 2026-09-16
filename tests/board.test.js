const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateBoard } = require('../src/services/ocr/boardVision');
const { matchBoard } = require('../src/services/engine/boardMatch');
const S = { champById: { a: {}, b: {}, c: {} }, items: {} };
const valid = { phase: 'planning', ownBoard: true, complete: true, units: [{ id: 'a', star: 2, confidence: 0.95 }] };
test('reject combat and scouting without returning a board', () => {
  assert.throws(() => validateBoard({ ...valid, phase: 'combat' }, S));
  assert.throws(() => validateBoard({ ...valid, ownBoard: false }, S));
});
test('unknown or low-confidence units mark result partial', () => {
  const result = validateBoard({ ...valid, units: [...valid.units, { id: 'fake', confidence: 1 }, { id: 'b', confidence: 0.3 }] }, S);
  assert.equal(result.partial, true);
  assert.deepEqual(result.units.map(u => u.id), ['a']);
  assert.throws(() => validateBoard({ ...valid, units: [] }, S));
});
test('validated board keeps stars', () => {
  assert.equal(validateBoard(valid, S).units[0].star, 2);
  assert.equal(validateBoard(valid, S).partial, false);
});
test('match follows actual board instead of unrelated top meta', () => {
  const comps = [{ id: 'meta', units: ['x','y','z'] }, { id: 'mine', name: 'Mine', units: ['a','b','c','d'] }];
  const result = matchBoard(['a','b','c'].map(id => ({ id })), comps);
  assert.equal(result.id, 'mine');
  assert.deepEqual(result.missing, ['d']);
  assert.equal(matchBoard([{ id: 'a' }, { id: 'a' }, { id: 'a' }], comps), null);
  assert.equal(matchBoard(['x','a','b'].map(id => ({ id })), comps), null);
});
test('coach uses board match and preserves explicit target override', () => {
  const { coachNow } = require('../src/services/engine');
  const champions = 'abcdefghij'.split('').map(id => ({ apiName: id, name: id, baseName: id, traits: [], cost: 1 }));
  const data = { champions, champById: Object.fromEntries(champions.map(c => [c.apiName, c])), traits: [], traitsById: {}, items: {}, recipes: {} };
  const comps = [{ id: 'meta', units: ['f','g','h','i','j'], levelling: 'Fast 9' }, { id: 'mine', units: ['a','b','c','d','e'], levelling: 'Fast 8' }]
    .map(c => ({ ...c, name: c.id, stars: [], carries: [], traits: [], sources: [], augments: [] }));
  const state = { stage: '3-2', level: 6, gold: 30, hp: 70, units: ['a','b','c','d'].map(id => ({ id, star: 2, items: [] })) };
  assert.equal(coachNow({ S: data, metaComps: comps, state }).chosenCompId, 'mine');
  assert.equal(coachNow({ S: data, metaComps: comps, state: { ...state, compId: 'meta' } }).chosenCompId, 'meta');
});
