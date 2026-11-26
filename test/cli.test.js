import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';
import * as store from '../src/core/store.js';
import { statusSegment } from '../src/core/status.js';
import { main } from '../src/cli.js';

beforeEach(() => { freshHome(); delete process.env.CLAUDE_CODE_SUBAGENT_MODEL; });

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

test('show warns when CLAUDE_CODE_SUBAGENT_MODEL is set', async () => {
  process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku';
  assert.match((await run('show')).out, /CLAUDE_CODE_SUBAGENT_MODEL/);
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

test('off/on globally and per session', async () => {
  await run('off');
  assert.equal(store.sessionEnabled('x'), false);
  await run('on');
  await run('off', '--session', 's1');
  assert.equal(store.sessionEnabled('s1'), false);
  assert.equal(store.sessionEnabled('s2'), true);
});

test('empty --session value is treated as global', async () => {
  assert.equal((await run('show', '--session')).code, 0);
  assert.equal((await run('show', '--session', '')).code, 0);
});

test('on/off with an empty --session refuses instead of going global', async () => {
  const r = await run('off', '--session');
  assert.equal(r.code, 2);
  assert.match(r.err, /session/);
  assert.equal(store.sessionEnabled('x'), true);
  assert.equal((await run('off', '--session', '')).code, 2);
});

test('show reflects a session-level off', async () => {
  await run('off', '--session', 's1');
  assert.match((await run('show', '--session', 's1')).out, /OFF/);
});

test('/router command runs the bundled CLI, not PATH', async () => {
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../commands/router.md', import.meta.url), 'utf8');
  assert.match(md, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/switchboard\.js"/);
});

test('unknown command exits 2 with help', async () => {
  const r = await run('frobnicate');
  assert.equal(r.code, 2);
  assert.match(r.err, /usage/i);
});

test('status-segment prints the segment', async () => {
  assert.equal((await run('status-segment', 's1')).out, '⇢ default');
});

test('statusSegment states', () => {
  assert.equal(statusSegment('s1'), '⇢ default');
  assert.equal(statusSegment(null), '⇢ default');
  store.addRunning('s1', 'a', 'code→sonnet');
  assert.equal(statusSegment('s1'), '⇢ default · code→sonnet');
  store.addRunning('s1', 'b', 'write→sonnet');
  assert.equal(statusSegment('s1'), '⇢ default · code→sonnet, write→sonnet');
  store.setEnabled(false, 's1');
  assert.equal(statusSegment('s1'), '⇢ off');
});

test('statusSegment shows manual model switch', () => {
  store.updateState('s1', s => { s.manual = 'opus'; });
  assert.equal(statusSegment('s1'), '⇢ manual (opus)');
  store.setEnabled(false, 's1');
  assert.equal(statusSegment('s1'), '⇢ off');
});
