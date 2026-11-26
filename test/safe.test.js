import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, fingerprint, isSetupName } from '../src/core/safe.js';

test('L4: clean strips control bytes, ESC and OSC sequences included', () => {
  const out = clean('\x1b]0;pwned\x07my\x1b[2Jname\r\n\ttail\x7f\x9b', 80);
  assert.doesNotMatch(out, /[\x00-\x1f\x7f-\x9f]/);
  assert.equal(out, ']0;pwned my [2Jname tail');
});

test('L4: clean collapses whitespace and cuts to max with an ellipsis', () => {
  assert.equal(clean('  a   b  ', 10), 'a b');
  assert.equal(clean('x'.repeat(50), 10), `${'x'.repeat(9)}…`);
  assert.equal(clean('x'.repeat(50), 10).length, 10);
  assert.equal(clean(undefined, 10), '');
  assert.equal(clean(42, 10), '42');
});

test('L5: fingerprint is a short FNV-1a hash plus length, never the text', () => {
  const t = 'secret token sk-123 in a pasted prompt';
  const f = fingerprint(t);
  assert.match(f, /^[0-9a-f]{8}:\d+$/);
  assert.ok(!f.includes('secret'));
  assert.equal(f, fingerprint(t));
  assert.notEqual(f, fingerprint(`${t}.`));
  assert.equal(fingerprint(''), '811c9dc5:0'); // FNV-1a offset basis
  assert.equal(fingerprint('a'), 'e40c292c:1'); // published FNV-1a 32 test vector
});

test('L3: setup names must match NAME_RE and not be prototype keys', () => {
  for (const ok of ['default', 'fast', 'my-setup_2.0']) assert.equal(isSetupName(ok), true, ok);
  for (const bad of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', '', 'a b', 'x'.repeat(41), '\x1b[31m', undefined, 5]) {
    assert.equal(isSetupName(bad), false, String(bad));
  }
});
