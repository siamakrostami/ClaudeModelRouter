import { test, beforeEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshHome } from './helpers.js';
import * as store from '../src/core/store.js';
import { handlePrompt, handleAgentPre, handleAgentPost, handleSessionStart } from '../src/core/hooks.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sid = 'sess-1';
beforeEach(() => { freshHome(); });

const pre = (subagent_type, id = 'tu1', extra = {}) =>
  handleAgentPre({ session_id: sid, tool_use_id: id, tool_name: 'Agent',
    tool_input: { description: 'x', prompt: 'do it', ...(subagent_type && { subagent_type }), ...extra } });

test('handlePrompt routes code work and records it', () => {
  const out = handlePrompt({ session_id: sid, prompt: 'Implement the trips endpoint' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /switchboard:router-code/);
  assert.equal(store.readState(sid).last_route, 'code');
});

test('handlePrompt: no match → null', () => {
  assert.equal(handlePrompt({ session_id: sid, prompt: 'hello' }), null);
});

test('handlePrompt: disabled session → null', () => {
  store.setEnabled(false, sid);
  assert.equal(handlePrompt({ session_id: sid, prompt: 'Implement the trips endpoint' }), null);
});

for (const name of ['switchboard:router-code', 'router-code']) {
  test(`handleAgentPre enforces setup for ${name}`, () => {
    const out = pre(name, 'tu1', { model: 'opus', run_in_background: false });
    const h = out.hookSpecificOutput;
    assert.equal(h.hookEventName, 'PreToolUse');
    assert.equal(h.permissionDecision, 'allow');
    assert.equal(h.updatedInput.model, 'sonnet');
    assert.equal(h.updatedInput.effort, 'medium');
    assert.equal(h.updatedInput.prompt, 'do it');
    assert.equal(h.updatedInput.run_in_background, false);
    assert.equal(store.readState(sid).running.tu1, 'code→sonnet');
  });
}

test('handleAgentPre follows setup changes', () => {
  store.setRole('code', 'opus', 'high');
  const h = pre('switchboard:router-code').hookSpecificOutput;
  assert.equal(h.updatedInput.model, 'opus');
  assert.equal(h.updatedInput.effort, 'high');
});

test('handleAgentPre leaves other agents alone', () => {
  assert.equal(pre('Explore'), null);
  assert.equal(pre(undefined), null);
  assert.deepEqual(store.readState(sid), {});
});

test('@model override with no matching role is honoured once', () => {
  store.setRole('hard', 'sonnet');
  handlePrompt({ session_id: sid, prompt: '@opus fix this' });
  assert.equal(pre('switchboard:router-hard', 'a').hookSpecificOutput.updatedInput.model, 'opus');
  assert.equal(pre('switchboard:router-hard', 'b').hookSpecificOutput.updatedInput.model, 'sonnet');
});

test('parallel helper starts in one session are all recorded', async () => {
  const { spawn } = await import('node:child_process');
  const runs = Array.from({ length: 6 }, (_, i) => new Promise(res => {
    const p = spawn('node', [path.join(root, 'hooks/on-agent-pre.js')], { env: process.env });
    p.on('close', res);
    p.stdin.end(JSON.stringify({ session_id: sid, tool_use_id: `p${i}`,
      tool_input: { subagent_type: 'switchboard:router-code', prompt: 'x' } }));
  }));
  await Promise.all(runs);
  assert.equal(Object.keys(store.readState(sid).running).length, 6);
});

test('handleAgentPost ignores non-router agents', () => {
  handleAgentPost({ session_id: sid, tool_use_id: 'z', tool_input: { subagent_type: 'Explore' } });
  assert.deepEqual(store.readState(sid), {});
});

test('handleAgentPost clears the running entry', () => {
  pre('switchboard:router-code', 'tu1');
  pre('switchboard:router-write', 'tu2');
  handleAgentPost({ session_id: sid, tool_use_id: 'tu1', tool_input: { subagent_type: 'switchboard:router-code' } });
  assert.deepEqual(store.readState(sid).running, { tu2: 'write→sonnet' });
});

test('handleSessionStart injects the standing rule unless disabled', () => {
  assert.match(handleSessionStart({ session_id: sid }).hookSpecificOutput.additionalContext, /standing instruction/);
  store.setEnabled(false);
  assert.equal(handleSessionStart({ session_id: sid }), null);
});

for (const w of ['on-session-start.js', 'on-prompt.js', 'on-agent-pre.js', 'on-agent-post.js']) {
  test(`${w} survives invalid stdin`, () => {
    const r = spawnSync('node', [path.join(root, 'hooks', w)], { input: '{not json', encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
}

test('on-prompt.js end to end', () => {
  const r = spawnSync('node', [path.join(root, 'hooks/on-prompt.js')], {
    input: JSON.stringify({ session_id: sid, prompt: 'rename foo to bar' }), encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /router-chores/);
});

function transcript(...lines) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tr-')), 't.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
const asst = m => JSON.stringify({ type: 'assistant', message: { model: m } });

test('manual /model switch: Switchboard steps aside, then resumes on switching back', () => {
  const prompt = 'Implement the trips endpoint';
  const opus = transcript(asst('claude-opus-5-5'));
  assert.equal(handlePrompt({ session_id: sid, prompt, transcript_path: opus }), null);
  assert.equal(store.readState(sid).manual, 'opus');
  assert.equal(store.readState(sid).last_route, null);
  assert.equal(pre('switchboard:router-code'), null);
  assert.equal(store.readState(sid).running, undefined);

  const fable = transcript(asst('claude-opus-5-5'), asst('claude-fable-5-2'));
  const out = handlePrompt({ session_id: sid, prompt, transcript_path: fable });
  assert.match(out.hookSpecificOutput.additionalContext, /router-code/);
  assert.equal(store.readState(sid).manual, null);
  assert.ok(pre('switchboard:router-code'));
});

test('main_model setting changes what counts as manual', () => {
  const d = store.loadSetups();
  d.main_model = 'opus';
  store.saveSetups(d);
  const opus = transcript(asst('claude-opus-5-5'));
  assert.ok(handlePrompt({ session_id: sid, prompt: 'Implement the trips endpoint', transcript_path: opus }));
  assert.equal(store.readState(sid).manual, null);
});

test('handleSessionStart still returns the rule when the transcript shows another model', () => {
  const opus = transcript(asst('claude-opus-5-5'));
  assert.match(handleSessionStart({ session_id: sid, transcript_path: opus }).hookSpecificOutput.additionalContext, /standing instruction/);
});
