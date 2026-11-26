import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshHome } from './helpers.js';
import { DEFAULT_RULES } from '../src/core/defaults.js';
import * as store from '../src/core/store.js';
import { main } from '../src/cli.js';

let home;
beforeEach(() => { home = freshHome(); });

async function run(...argv) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, isTTY: false });
  return { code, out, err };
}

test('show prints six aligned rows', async () => {
  const { code, out } = await run('show');
  assert.equal(code, 0);
  const rows = out.split('\n').filter(l => /^(plan|review|hard|code|write|chores)\s/.test(l));
  assert.equal(rows.length, 6);
  assert.match(rows[0], /^plan\s+fable\s+xhigh/);
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
