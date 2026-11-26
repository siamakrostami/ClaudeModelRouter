import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

test('corrupt file backed up to setups.json.bak-<epoch ms>', () => {
  fs.writeFileSync(path.join(home, 'setups.json'), '{bad');
  const d = store.loadSetups();
  const baks = fs.readdirSync(home).filter(f => /^setups\.json\.bak-\d+$/.test(f));
  assert.equal(baks.length, 1);
  assert.equal(fs.readFileSync(path.join(home, baks[0]), 'utf8'), '{bad');
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

// ---- L2: backups never follow a symlink and never overwrite an older backup ----

function atTime(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}

test('L2: a symlinked backup target is not followed', () => {
  const victim = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-victim-')), 'victim.txt');
  fs.writeFileSync(victim, 'keep me');
  fs.symlinkSync(victim, path.join(home, 'setups.json.bak-1234'));
  fs.writeFileSync(path.join(home, 'setups.json'), '{bad');
  const d = atTime(1234, () => store.loadSetups());
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me');
  assert.ok(fs.lstatSync(path.join(home, 'setups.json.bak-1234')).isSymbolicLink());
  assert.deepEqual(d.setups[d.active], DEFAULT_SETUP); // the load itself still recovers
});

test('L2: a dangling symlink at the backup name is not followed either', () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-victim-')), 'new.txt');
  fs.symlinkSync(target, path.join(home, 'setups.json.bak-77'));
  fs.writeFileSync(path.join(home, 'setups.json'), '{bad');
  atTime(77, () => store.loadSetups());
  assert.equal(fs.existsSync(target), false);
});

test('L2: a second corrupt file gets its own backup', () => {
  fs.writeFileSync(path.join(home, 'setups.json'), '{one');
  atTime(1000, () => store.loadSetups());
  fs.writeFileSync(path.join(home, 'setups.json'), '{two');
  atTime(2000, () => store.loadSetups());
  assert.equal(fs.readFileSync(path.join(home, 'setups.json.bak-1000'), 'utf8'), '{one');
  assert.equal(fs.readFileSync(path.join(home, 'setups.json.bak-2000'), 'utf8'), '{two');
});

// ---- L3: setup names are validated and looked up as own keys only ----

function writeSetups(obj) {
  fs.writeFileSync(path.join(home, 'setups.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
}

test('L3: prototype names are refused by save', () => {
  for (const n of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => store.saveAs(n), /invalid setup name/, n);
  }
  assert.deepEqual(store.listSetups().names, ['default']);
});

test('L3: save, use and delete need a name', () => {
  assert.throws(() => store.saveAs(undefined), /name/);
  assert.throws(() => store.use(undefined), /name/);
  assert.throws(() => store.remove(undefined), /name/);
  assert.ok(!('undefined' in store.loadSetups().setups));
});

test('L3: an active name that is not an own key falls back to the first setup', () => {
  writeSetups({ active: 'toString', setups: { fast: { code: { model: 'opus', effort: 'high' } }, default: {} } });
  assert.equal(store.activeName(), 'fast');
  assert.equal(store.activeSetup().code.model, 'opus');
});

test('L3: __proto__, constructor and badly named setups in the file are dropped', () => {
  writeSetups('{"active":"__proto__","setups":{"__proto__":{"code":{"model":"opus"}},"constructor":{},"bad name":{},"ok":{}}}');
  const d = store.loadSetups();
  assert.deepEqual(Object.keys(d.setups), ['ok']);
  assert.equal(d.active, 'ok');
  assert.equal(Object.getPrototypeOf(d.setups.ok), Object.prototype);
  assert.equal({}.code, undefined); // nothing leaked onto Object.prototype
});

test('L3: with no valid setup left, default is created', () => {
  writeSetups({ active: 'constructor', setups: { constructor: {} } });
  const d = store.loadSetups();
  assert.deepEqual(Object.keys(d.setups), ['default']);
  assert.equal(d.active, 'default');
});

test('L3: a role key in a setup must be its own', () => {
  writeSetups('{"active":"x","setups":{"x":{"__proto__":{"code":{"model":"opus","effort":"max"}}}}}');
  assert.deepEqual(store.activeSetup().code, DEFAULT_SETUP.code);
});

// ---- I3: the data folder is private to the person ----

test('I3: the data folder is created 0700 and files are written 0600', () => {
  const sub = path.join(home, 'nested', 'data');
  process.env.CLAUDE_MODEL_ROUTER_HOME = sub;
  store.setRole('code', 'opus');
  store.writeDefaultRules();
  assert.equal(fs.statSync(sub).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(sub, 'setups.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(sub, 'rules.json')).mode & 0o777, 0o600);
});

test('I3: a backup is written 0600', () => {
  fs.writeFileSync(path.join(home, 'setups.json'), '{bad', { mode: 0o644 });
  atTime(5, () => store.loadSetups());
  assert.equal(fs.statSync(path.join(home, 'setups.json.bak-5')).mode & 0o777, 0o600);
});
