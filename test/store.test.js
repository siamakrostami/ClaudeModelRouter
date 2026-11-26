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

test('corrupt rules backed up and defaults used', () => {
  fs.writeFileSync(path.join(home, 'rules.json'), 'nope');
  const r = store.loadRules();
  assert.ok(fs.existsSync(path.join(home, 'rules.json.bak')));
  assert.ok(Array.isArray(r.chores));
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

test('state per session and pruned', () => {
  store.updateState('a', s => { s.last_route = 'code'; });
  store.updateState('b', s => { s.last_route = 'write'; });
  assert.equal(store.readState('a').last_route, 'code');
  assert.equal(store.readState('b').last_route, 'write');
  const old = (Date.now() - 25 * 3600 * 1000) / 1000;
  fs.utimesSync(path.join(home, 'sessions', 'a'), old, old);
  store.updateState('b', s => { s.last_route = 'code'; });
  assert.deepEqual(store.readState('a'), {});
});

test('running entries: add, remove, expire', () => {
  store.addRunning('s', 'tu1', 'code→sonnet');
  store.addRunning('s', 'tu2', 'write→sonnet');
  store.removeRunning('s', 'tu1');
  assert.deepEqual(store.readState('s').running, { tu2: 'write→sonnet' });
  const f = path.join(home, 'sessions', 's', 'running', 'tu2.json');
  const old = (Date.now() - 31 * 60 * 1000) / 1000;
  fs.utimesSync(f, old, old);
  assert.equal(store.readState('s').running, undefined);
});

test('session ids and tool ids are made filename-safe', () => {
  store.addRunning('../../evil', '../x', 'code→sonnet');
  assert.ok(!fs.existsSync(path.join(home, '..', 'evil')));
  assert.deepEqual(store.readState('../../evil').running, { '../x': 'code→sonnet' });
});

test('rules.json with an extra non-array key is kept', () => {
  fs.writeFileSync(path.join(home, 'rules.json'), JSON.stringify({ _comment: 'mine', code: ['zebra'] }));
  const r = store.loadRules();
  assert.deepEqual(r.code, ['zebra']);
  assert.ok(!fs.existsSync(path.join(home, 'rules.json.bak')));
});

test('use() ignores prototype names', () => {
  assert.throws(() => store.use('constructor'));
});

test('enabled: global and per session', () => {
  assert.equal(store.sessionEnabled('s1'), true);
  store.setEnabled(false);
  assert.equal(store.sessionEnabled('s1'), false);
  store.setEnabled(true);
  store.setEnabled(false, 's1');
  assert.equal(store.sessionEnabled('s1'), false);
  assert.equal(store.sessionEnabled('s2'), true);
});

test('no .tmp left after write', () => {
  store.setRole('code', 'opus');
  store.updateState('a', s => { s.x = 1; });
  store.addRunning('a', 't', 'x');
  const all = fs.readdirSync(home, { recursive: true });
  assert.deepEqual(all.filter(f => String(f).includes('.tmp')), []);
});

test('main_model defaults to fable, falls back on invalid, env overrides', () => {
  delete process.env.CLAUDE_MODEL_ROUTER_MAIN_MODEL;
  assert.equal(store.loadSetups().main_model, 'fable');
  assert.equal(store.mainModel(), 'fable');
  const d = store.loadSetups();
  d.main_model = 'gpt';
  store.saveSetups(d);
  assert.equal(store.loadSetups().main_model, 'fable');
  d.main_model = 'opus';
  store.saveSetups(d);
  assert.equal(store.mainModel(), 'opus');
  process.env.CLAUDE_MODEL_ROUTER_MAIN_MODEL = 'sonnet';
  try { assert.equal(store.mainModel(), 'sonnet'); } finally { delete process.env.CLAUDE_MODEL_ROUTER_MAIN_MODEL; }
});
