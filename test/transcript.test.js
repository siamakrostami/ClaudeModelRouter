import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectMainModel } from '../src/core/transcript.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tr-'));
let n = 0;
function write(...lines) {
  const f = path.join(dir, `t${n++}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
const assistant = m => JSON.stringify({ type: 'assistant', message: { model: m, role: 'assistant' } });
const cmd = text => JSON.stringify({ type: 'user', message: { content: `<local-command-stdout>${text}</local-command-stdout>` } });

test('assistant model only', () => {
  assert.equal(detectMainModel(write(assistant('claude-opus-5-5'))), 'opus');
});

test('later /model result wins over earlier assistant line', () => {
  const f = write(assistant('claude-fable-5-2'), cmd('Set model to `Sonnet 5.5` and saved as your default'));
  assert.equal(detectMainModel(f), 'sonnet');
});

test('later assistant line wins over earlier /model result', () => {
  const f = write(cmd('Set model to `Opus 5.5` and saved as your default'), assistant('claude-fable-5-2'));
  assert.equal(detectMainModel(f), 'fable');
});

test('"Kept model as" is recognised', () => {
  assert.equal(detectMainModel(write(cmd('Kept model as `Haiku 5.5`'))), 'haiku');
});

test('no signal, missing file, bad path', () => {
  assert.equal(detectMainModel(write('{"type":"user"}')), null);
  assert.equal(detectMainModel(path.join(dir, 'nope.jsonl')), null);
  assert.equal(detectMainModel(undefined), null);
  assert.equal(detectMainModel(dir), null);
});

test('large file: only the tail is read, and fast', () => {
  const f = path.join(dir, 'big.jsonl');
  const filler = JSON.stringify({ type: 'user', text: 'x'.repeat(1000) }) + '\n';
  // an old signal far outside the tail window must be ignored
  const head = assistant('claude-haiku-5-5') + '\n';
  fs.writeFileSync(f, head + filler.repeat(1000) + assistant('claude-opus-5-5') + '\n');
  assert.ok(fs.statSync(f).size > 1_000_000);
  const t = process.hrtime.bigint();
  assert.equal(detectMainModel(f), 'opus');
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 50);
  fs.writeFileSync(f, head + filler.repeat(1000));
  assert.equal(detectMainModel(f), null);
});
