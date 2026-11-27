import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK, availableFrom, resolveModel } from '../src/core/models.js';

const ALL = ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan'];
const row = options => ({ key: 'model', label: 'Model', kind: 'choice', value: 'default', options, provider: { kind: 'engine' }, isLocked: false });

test('availableFrom: every family the model row offers', () => {
  assert.deepEqual(availableFrom([row(ALL)]), ['fable', 'opus', 'sonnet', 'haiku']);
});

test('availableFrom: an account without Fable', () => {
  assert.deepEqual(availableFrom([{ key: 'theme', options: ['dark'] }, row(ALL.filter(o => !o.includes('fable')))]), ['opus', 'sonnet', 'haiku']);
});

test('availableFrom: a family counts when any option contains its name', () => {
  assert.deepEqual(availableFrom([row(['default', 'claude-opus-5[1m]', 'Sonnet'])]), ['opus', 'sonnet']);
});

test('availableFrom: unknown (null) when the row is missing, odd or names no family', () => {
  assert.equal(availableFrom([]), null);
  assert.equal(availableFrom([{ key: 'theme', options: ['dark'] }]), null);
  assert.equal(availableFrom([row(undefined)]), null);
  assert.equal(availableFrom([row(['default', 'best'])]), null);
  assert.equal(availableFrom([row([1, null, {}])]), null);
  assert.equal(availableFrom(null), null);
  assert.equal(availableFrom('rows'), null);
});

const table = [
  // model, available, expected
  ['fable', ['opus', 'sonnet', 'haiku'], 'opus'],
  ['fable', ['sonnet', 'haiku'], 'sonnet'],
  ['fable', ['haiku'], 'haiku'],
  ['opus', ['fable', 'sonnet', 'haiku'], 'sonnet'],
  ['opus', ['fable', 'haiku'], 'haiku'],
  ['opus', ['fable'], 'fable'],
  ['sonnet', ['fable', 'opus', 'haiku'], 'haiku'],
  ['sonnet', ['fable', 'opus'], 'opus'],
  ['sonnet', ['fable'], 'fable'],
  ['haiku', ['fable', 'opus', 'sonnet'], 'sonnet'],
  ['haiku', ['fable', 'opus'], 'opus'],
  ['haiku', ['fable'], 'fable'],
  ['fable', ['fable', 'opus'], 'fable'],
  ['haiku', ['haiku'], 'haiku'],
];
for (const [model, available, expected] of table) {
  test(`resolveModel(${model}, [${available}]) → ${expected}`, () => assert.equal(resolveModel(model, available), expected));
}

test('resolveModel: unknown availability or an unknown model changes nothing', () => {
  assert.equal(resolveModel('fable', null), 'fable');
  assert.equal(resolveModel('fable', undefined), 'fable');
  assert.equal(resolveModel('fable', []), 'fable');
  assert.equal(resolveModel('gpt', ['opus']), 'gpt');
});

test('FALLBACK lists every other family once per model', () => {
  for (const [m, order] of Object.entries(FALLBACK)) {
    assert.equal(new Set([m, ...order]).size, 4, m);
  }
});
