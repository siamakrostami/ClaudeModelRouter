import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshHome } from './helpers.js';
import { DEFAULT_RULES, DEFAULT_SETUP } from '../src/core/defaults.js';
import * as store from '../src/core/store.js';
import { main } from '../src/cli.js';

let home;
beforeEach(() => { home = freshHome(); });

async function run(...argv) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, isTTY: false });
  return { code, out, err };
}

test('show prints seven aligned rows, general last (0.4.0: was six)', async () => {
  const { code, out } = await run('show');
  assert.equal(code, 0);
  const rows = out.split('\n').filter(l => /^(plan|review|hard|code|write|chores|general)\s/.test(l));
  assert.equal(rows.length, 7);
  assert.match(rows[0], /^plan\s+fable\s+xhigh/);
  assert.match(rows[6], /^general\s+sonnet\s+medium\s+Everything else/);
});

test('show says nothing about subagent model variables', async () => {
  process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku';
  try { assert.doesNotMatch((await run('show')).out, /SUBAGENT|helper/i); } finally { delete process.env.CLAUDE_CODE_SUBAGENT_MODEL; }
});

test('no args without a TTY behaves like show', async () => {
  assert.match((await run()).out, /^plan\s+fable/m);
});

test('set updates the active setup', async () => {
  assert.equal((await run('set', 'code', 'opus', 'high')).code, 0);
  assert.deepEqual(store.activeSetup().code, { model: 'opus', effort: 'high' });
});

test('set with a bad model exits 2', async () => {
  const r = await run('set', 'code', 'gpt');
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown model/);
});

test('save, list, use', async () => {
  await run('save', 'fast');
  assert.match((await run('list')).out, /\* fast/);
  await run('use', 'default');
  assert.match((await run('list')).out, /\* default/);
  assert.equal((await run('use', 'nope')).code, 2);
});

test('delete', async () => {
  await run('save', 'tmp');
  await run('use', 'default');
  assert.equal((await run('delete', 'tmp')).code, 0);
  assert.doesNotMatch((await run('list')).out, /tmp/);
});

test('off/on are global', async () => {
  assert.equal((await run('off')).out, 'Routing OFF.\n');
  assert.equal(store.loadSetups().enabled, false);
  assert.match((await run('show')).out, /routing OFF\)/);
  await run('on');
  assert.equal(store.loadSetups().enabled, true);
});

test('--session is no longer an option', async () => {
  const r = await run('off', '--session', 's1');
  assert.equal(r.code, 2);
  assert.equal(store.loadSetups().enabled, true);
});

test('rules writes the default rules once and never overwrites', async () => {
  const file = path.join(home, 'rules.json');
  const first = await run('rules');
  assert.equal(first.code, 0);
  assert.ok(first.out.includes(file));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), DEFAULT_RULES);
  fs.writeFileSync(file, '{"code":["mine"]}');
  const again = await run('rules');
  assert.equal(again.code, 0);
  assert.ok(again.out.includes(file));
  assert.match(again.out, /already/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"code":["mine"]}');
});

test('unknown command exits 2 with help', async () => {
  const r = await run('frobnicate');
  assert.equal(r.code, 2);
  assert.match(r.err, /usage/i);
});


test('M1: a relative CLAUDE_MODEL_ROUTER_HOME is refused', async () => {
  process.env.CLAUDE_MODEL_ROUTER_HOME = 'relative/dir';
  const r = await run('show');
  assert.equal(r.code, 2);
  assert.match(r.err, /absolute/);
  assert.throws(() => store.home(), /absolute/);
  assert.equal(fs.existsSync('relative'), false);
});

test('M1: any absolute CLAUDE_MODEL_ROUTER_HOME is accepted by the CLI', async () => {
  assert.equal(store.home(), home);
  assert.equal((await run('show')).code, 0);
});

// ---- L3: save / use / delete without a name print usage ----

for (const cmd of ['save', 'use', 'delete']) {
  test(`L3: ${cmd} with no name prints usage and exits 2`, async () => {
    const r = await run(cmd);
    assert.equal(r.code, 2);
    assert.match(r.err, new RegExp(`usage: claude-model-router ${cmd} <`, 'i'));
    assert.deepEqual(store.listSetups().names, ['default']);
  });
}

test('L3: save __proto__ is refused', async () => {
  const r = await run('save', '__proto__');
  assert.equal(r.code, 2);
  assert.deepEqual(store.listSetups().names, ['default']);
});

// ---- L4: names from the file never reach the terminal with control bytes ----

test('L4: list, show and errors print no escape sequences from setups.json', async () => {
  const evil = '\u001b]0;pwned\u0007\u001b[2J';
  fs.writeFileSync(path.join(home, 'setups.json'), JSON.stringify({ active: evil, setups: { [evil]: {}, ok: {} } }));
  for (const args of [['list'], ['show'], ['use', 'nope']]) {
    const r = await run(...args);
    assert.doesNotMatch(r.out + r.err, /[\x00-\x08\x0b-\x1f\x7f]/, args.join(' '));
  }
});

test('L4: a typed name with escape bytes is not echoed raw', async () => {
  const r = await run('use', 'x\u001b[31my');
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.err, /\u001b/);
});

// ---- L6: the picker falls back to show when ink cannot be loaded ----

test('L6: no picker module: show is printed with a one-line note', async () => {
  let out = '', err = '';
  const code = await main([], {
    stdout: { write: s => { out += s; } },
    stderr: { write: s => { err += s; } },
    isTTY: true,
    loadPicker: () => Promise.reject(new Error("Cannot find package 'ink'")),
  });
  assert.equal(code, 0);
  assert.match(out, /^plan\s+fable/m);
  assert.equal(err.trim().split('\n').length, 1);
  assert.match(err, /picker/i);
});

// ---- 0.4.0: general role, presets, sticky_tokens ----

test('set accepts the general role', async () => {
  assert.equal((await run('set', 'general', 'haiku', 'low')).code, 0);
  assert.deepEqual(store.activeSetup().general, { model: 'haiku', effort: 'low' });
});

test('an old setups.json without general gets the default general', async () => {
  fs.writeFileSync(path.join(home, 'setups.json'), JSON.stringify({ active: 'default', setups: { default: { code: { model: 'opus', effort: 'high' } } } }));
  assert.match((await run('show')).out, /^general\s+sonnet\s+medium/m);
});

const PRESETS = JSON.parse(fs.readFileSync(new URL('../presets/setups.json', import.meta.url), 'utf8'));

test('presets/setups.json holds default, economy and deep, complete and valid', () => {
  assert.equal(PRESETS.active, 'default');
  assert.deepEqual(Object.keys(PRESETS.setups), ['default', 'economy', 'deep']);
  for (const [name, setup] of Object.entries(PRESETS.setups)) {
    assert.deepEqual(Object.keys(setup), ['plan', 'review', 'hard', 'code', 'write', 'chores', 'general'], name);
    for (const s of Object.values(setup)) {
      assert.deepEqual(Object.keys(s), ['model', 'effort'], name);
      assert.ok(['fable', 'opus', 'sonnet', 'haiku'].includes(s.model), name);
      assert.ok(['low', 'medium', 'high', 'xhigh', 'max'].includes(s.effort), name);
    }
  }
  assert.deepEqual(PRESETS.setups.default, DEFAULT_SETUP);
  assert.ok(Object.values(PRESETS.setups.economy).every(s => s.model !== 'fable'));
  assert.deepEqual(PRESETS.setups.deep.plan, { model: 'fable', effort: 'max' });
  assert.deepEqual(PRESETS.setups.economy.general, { model: 'sonnet', effort: 'low' });
  assert.deepEqual(PRESETS.setups.deep.general, { model: 'opus', effort: 'medium' });
});

test('presets adds the shipped setups, keeps the active one, and says how to switch', async () => {
  await run('save', 'mine');
  const r = await run('presets');
  assert.equal(r.code, 0);
  const d = store.loadSetups();
  assert.deepEqual(Object.keys(d.setups).sort(), ['deep', 'default', 'economy', 'mine']);
  assert.equal(d.active, 'mine');
  assert.deepEqual(d.setups.economy, PRESETS.setups.economy);
  assert.match(r.out, /economy/);
  assert.match(r.out, /deep/);
  assert.match(r.out, /claude-model-router use economy/);
  assert.match(r.out, /Models tab/);
});

test('presets never overwrites a setup of the same name', async () => {
  store.setRole('code', 'haiku', 'low');
  const r = await run('presets');
  assert.equal(r.code, 0);
  assert.deepEqual(store.loadSetups().setups.default.code, { model: 'haiku', effort: 'low' });
  assert.match(r.out, /default.*(kept|already)/i);
  const again = await run('presets');
  assert.equal(again.code, 0);
  assert.match(again.out, /nothing (new )?to add|already/i);
});

test('presets refuses a file of an unknown shape and changes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(home, 'p-'));
  for (const body of ['[1,2]', '{"setups":[]}', '{"nope":1}', '{bad']) {
    const f = path.join(dir, 'setups.json');
    fs.writeFileSync(f, body);
    let out = '', err = '';
    const code = await main(['presets'], { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, isTTY: false, presetsFile: f });
    assert.equal(code, 2, body);
    assert.match(err, /preset/i, body);
  }
  assert.deepEqual(store.listSetups().names, ['default']);
});

test('presets skips badly named or prototype setups in the file', () => {
  const r = store.addPresets(JSON.parse('{"setups":{"__proto__":{},"bad name":{},"ok":{"code":{"model":"opus","effort":"high"}}}}'));
  assert.deepEqual(r.added, ['ok']);
  assert.deepEqual(store.loadSetups().setups.ok.code, { model: 'opus', effort: 'high' });
  assert.equal({}.code, undefined);
});

test('usage lists presets and says subagents are left alone', async () => {
  const { out } = await run('help');
  assert.match(out, /presets/);
  assert.match(out, /subagent/i);
});

test('sticky_tokens defaults to 60000, is kept on save, and an invalid value falls back', async () => {
  assert.equal(store.stickyTokens(), 60000);
  fs.writeFileSync(path.join(home, 'setups.json'), JSON.stringify({ active: 'default', sticky_tokens: 0, setups: { default: {} } }));
  assert.equal(store.stickyTokens(), 0);
  await run('set', 'code', 'opus');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'setups.json'), 'utf8')).sticky_tokens, 0);
  await run('presets');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'setups.json'), 'utf8')).sticky_tokens, 0);
  for (const bad of [-1, 1.5, '9000', null, true]) {
    fs.writeFileSync(path.join(home, 'setups.json'), JSON.stringify({ active: 'default', sticky_tokens: bad, setups: { default: {} } }));
    assert.equal(store.stickyTokens(), 60000, String(bad));
  }
  fs.writeFileSync(path.join(home, 'setups.json'), JSON.stringify({ active: 'default', sticky_tokens: 120000, setups: { default: {} } }));
  assert.equal(store.stickyTokens(), 120000);
});
