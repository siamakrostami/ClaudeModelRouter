// Small helpers shared by the CLI (src/) and the mod (hooks/) for text that came from a file,
// a prompt, a folder or a branch.

// C0 controls, DEL and C1 controls (some terminals read \x9b as CSI).
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Text safe to print or draw: control bytes (ESC, BEL, CR, ...) become spaces, runs of
 * whitespace collapse to one, and the result is cut to `max` characters, ending in … when cut.
 */
export function clean(text, max) {
  const s = String(text ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** FNV-1a (32-bit) of the text's UTF-8 bytes, as 8 hex digits, then ":" and the text's length. */
export function fingerprint(text) {
  const s = String(text ?? '');
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}:${s.length}`;
}

export const NAME_RE = /^[\w.-]{1,40}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);

/** A setup name the CLI and the mod accept: letters, digits, - _ . (1-40), not a prototype key. */
export function isSetupName(name) {
  return typeof name === 'string' && NAME_RE.test(name) && !RESERVED.has(name);
}
