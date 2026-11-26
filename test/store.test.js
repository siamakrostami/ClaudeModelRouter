import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshHome } from './helpers.js';
import { DEFAULT_SETUP } from '../src/core/defaults.js';
import * as store from '../src/core/store.js';

let home;
beforeEach(() => { home = freshHome(); });

test('missing file creates default', () => {
  assert.deepEqual(store.activeSetup(), DEFAULT_SETUP);
  assert.ok(fs.existsSync(path.join(home, 'setups.json')));
});

test('corrupt file backed up', () => {
  fs.writeFileSync(path.join(home, 'setups.json'), '{bad');
  const d = store.loadSetups();
  assert.ok(fs.existsSync(path.join(home, 'setups.json.bak')));
  assert.deepEqual(d.setups[d.active], DEFAULT_SETUP);
});

test('missing role filled', () => {
  const partial = structuredClone(DEFAULT_SETUP);
  delete partial.chores;
  fs.writeFileSync(path.join(home, 'setups.json'),
    JSON.stringify({ active: 'default', enabled: true, setups: { default: partial } }));
  assert.deepEqual(store.activeSetup().chores, { model: 'haiku', effort: 'low' });
});

test('save/use/remove', () => {
  store.saveAs('fast');
  store.setRole('code', 'opus');
  store.use('default');
  assert.equal(store.activeSetup().code.model, 'sonnet');
  store.use('fast');
  assert.equal(store.activeSetup().code.model, 'opus');
  assert.throws(() => store.remove('fast'));
  store.use('default');
  store.remove('fast');
  assert.ok(!('fast' in store.loadSetups().setups));
  assert.throws(() => store.use('nope'));
});

test('setRole rejects bad model, effort and role', () => {
  assert.throws(() => store.setRole('code', 'gpt'));
  assert.throws(() => store.setRole('code', 'opus', 'huge'));
  assert.throws(() => store.setRole('cook', 'opus'));
});

test('use() ignores prototype names', () => {
  assert.throws(() => store.use('constructor'));
});

test('no .tmp left after write', () => {
  store.setRole('code', 'opus');
  store.setEnabled(false);
  const all = fs.readdirSync(home, { recursive: true });
  assert.deepEqual(all.filter(f => String(f).includes('.tmp')), []);
});

test('enabled is one global switch', () => {
  assert.equal(store.loadSetups().enabled, true);
  store.setEnabled(false);
  assert.equal(store.loadSetups().enabled, false);
  store.setEnabled(true);
  assert.equal(store.loadSetups().enabled, true);
});

test('main_model is not written any more', () => {
  store.setRole('code', 'opus');
  assert.ok(!('main_model' in JSON.parse(fs.readFileSync(path.join(home, 'setups.json'), 'utf8'))));
});

test('session state helpers are gone', () => {
  for (const name of ['readState', 'updateState', 'addRunning', 'removeRunning', 'clearRunning', 'sessionEnabled', 'mainModel', 'loadRules']) {
    assert.equal(store[name], undefined, name);
  }
});
