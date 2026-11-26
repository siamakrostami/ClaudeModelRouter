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

