import { ROLES, DEFAULT_SETUP } from './defaults.js';

const MAX_SCAN = 4000; // only the start of a prompt is scanned, keeps huge pastes fast

// A tag or mention ends at a space or punctuation, never inside a longer word: #code-owners is not #code.
const END = '(?![\\w-])';
const SELF_RE = new RegExp(`(?:^|\\s)#self${END}|\\b(do it yourself|do this yourself)\\b`, 'i');
const TAG_RE = new RegExp(`(?:^|\\s)#(plan|review|hard|code|write|chores)${END}`, 'i');
const AT_RE = new RegExp(`(?:^|\\s)@(fable|opus|sonnet|haiku)${END}`, 'i');
// Only an explicit request switches model: "use opus for this", "use haiku to ...", "with opus please".
// A model named in passing ("we run the batch job on haiku", "via haiku endpoint") does not.
const PLAIN_MODEL_RE = /\buse (?:the )?(fable|opus|sonnet|haiku)(?: model)? (?:for (?:this|that|it)\b|to\b)|\b(?:with|using|on) (?:the )?(fable|opus|sonnet|haiku)(?: model)?,? please\b/i;

// Chores (Haiku, low effort) only take short, clearly mechanical prompts.
const CHORES_MAX_WORDS = 12;
const CHORES_START_RE = /^\W*(?:please |can you |could you )?(?:rename|bump|move|format|lint|run (?:the )?(?:linter|formatter|prettier|eslint|swiftlint|swiftformat)|write (?:a |the )?commit message)\b/i;

const compiled = new WeakMap();
function compile(rules) {
  let c = compiled.get(rules);
  if (c) return c;
  c = {};
  for (const role of ROLES) {
    c[role] = [];
    for (const src of rules[role] || []) {
      try { c[role].push(new RegExp(src, 'i')); } catch { /* bad user regex: skip */ }
    }
  }
  compiled.set(rules, c);
  return c;
}

function route(role, setup, forced, modelOverride, why = '') {
  const s = setup[role] || DEFAULT_SETUP[role];
  return { role, model: modelOverride || s.model, effort: s.effort, forced, why };
}

/** Chores may win only when the prompt is short or opens with a mechanical verb. */
function choresAllowed(text) {
  return text.trim().split(/\s+/).length <= CHORES_MAX_WORDS || CHORES_START_RE.test(text);
}

/**
 * Decide which role a prompt belongs to.
 * Overrides: #self or "do it yourself" (no routing), #<role>, @<model> or "use <model> for this".
 * Otherwise keyword scoring: any other role's match beats chores, chores needs a short or
 * mechanical prompt, and ties go to ROLES order (most capable first).
 * Returns {role, model, effort, forced, why} or null for "no routing".
 */
export function classify(prompt, rules, setup) {
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const text = prompt.slice(0, MAX_SCAN);

  if (SELF_RE.test(text)) return null;

  const tag = TAG_RE.exec(text);
  if (tag) return route(tag[1].toLowerCase(), setup, true, undefined, tag[0].trim());

  const at = AT_RE.exec(text) || PLAIN_MODEL_RE.exec(text);
  if (at) {
    const model = (at[1] || at[2]).toLowerCase();
    const byActive = ROLES.find(r => setup[r]?.model === model);
    const why = at[0].trim();
    if (byActive) return route(byActive, setup, true, undefined, why);
    const byDefault = ROLES.find(r => DEFAULT_SETUP[r].model === model) || 'code';
    return route(byDefault, setup, true, model, why);
  }

  const res = compile(rules);
  let best = null;
  let bestScore = 0;
  let bestWhy = '';
  for (const role of ROLES) {
    if (role === 'chores' && (best || !choresAllowed(text))) continue;
    let score = 0;
    let why = '';
    for (const re of res[role]) {
      const m = re.exec(text);
      if (m) { score += 1; if (!why) why = m[0].trim(); }
    }
    if (score > bestScore) { best = role; bestScore = score; bestWhy = why; }
  }
  return best ? route(best, setup, false, undefined, bestWhy) : null;
}
