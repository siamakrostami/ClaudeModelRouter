import { ROLES, DEFAULT_SETUP, DEFAULT_RULES } from './defaults.js';
import { clean } from './safe.js';

const WHY_MAX = 40;

const MAX_SCAN = 4000; // only the start of a prompt is scanned, keeps huge pastes fast
const MAX_USER_SCAN = 1000; // patterns from rules.json see less of the prompt
const MAX_USER_PATTERNS = 50; // per role
const MAX_USER_PATTERN = 200; // characters

// A pattern identical to a built-in rule (as `claude-model-router rules` writes them) is trusted.
const BUILT_IN = new Set(Object.values(DEFAULT_RULES).flat());

// A tag or mention ends at a space or punctuation, never inside a longer word: #code-owners is not #code.
// It counts only at the very start of the prompt or at the very end (before trailing spaces and
// punctuation), so a pasted log line that mentions @haiku cannot steer the turn.
const END = '(?![\\w-])';
const TAIL = '[\\s\\p{P}]*$';
const at = body => ({
  start: new RegExp(`^\\s*${body}${END}`, 'iu'),
  end: new RegExp(`(?:^|\\s)${body}${END}${TAIL}`, 'iu'),
});
const SELF_TAG = at('#self');
const TAG = at('#(plan|review|hard|code|write|chores)');
const AT = at('@(fable|opus|sonnet|haiku)');
const TAIL_SCAN = 200; // the end of the prompt is looked at this far back
// Plain-language overrides count only in the first PLAIN_SCAN characters.
const PLAIN_SCAN = 200;
const SELF_PLAIN_RE = /\b(do it yourself|do this yourself)\b/i;
// Only an explicit request switches model: "use opus for this", "use haiku to ...", "with opus please".
// A model named in passing ("we run the batch job on haiku", "via haiku endpoint") does not.
const PLAIN_MODEL_RE = /\buse (?:the )?(fable|opus|sonnet|haiku)(?: model)? (?:for (?:this|that|it)\b|to\b)|\b(?:with|using|on) (?:the )?(fable|opus|sonnet|haiku)(?: model)?,? please\b/i;

/** An override at the start of the prompt, else at its end. */
function edge(o, prompt) {
  return o.start.exec(prompt.slice(0, TAIL_SCAN)) || o.end.exec(prompt.slice(-TAIL_SCAN));
}

// Chores (Haiku, low effort) only take short, clearly mechanical prompts.
const CHORES_MAX_WORDS = 12;
const CHORES_START_RE = /^\W*(?:please |can you |could you )?(?:rename|bump|move|format|lint|run (?:the )?(?:linter|formatter|prettier|eslint|swiftlint|swiftformat)|write (?:a |the )?commit message)\b/i;

/**
 * A rules.json entry that is not a built-in rule is the person's own word or phrase, never a
 * regex: every metacharacter is escaped, runs of whitespace match any whitespace, and a word
 * boundary is required where the phrase starts or ends with a word character. The result has no
 * repeats except \s+ between literal words, so it runs in linear time on any prompt.
 */
export function phraseSource(phrase) {
  const words = phrase.trim().split(/\s+/).map(w => w.replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&'));
  const body = words.join('\\s+');
  const start = /^\w/.test(phrase.trim()) ? '\\b' : '';
  const end = /\w$/.test(phrase.trim()) ? '\\b' : '';
  return `${start}${body}${end}`;
}

const compiled = new WeakMap();
/**
 * Compile each role's rules once per rules object. An entry identical to a built-in rule keeps
 * its regex; any other entry is a plain phrase (see phraseSource). At most MAX_USER_PATTERNS
 * phrases of up to MAX_USER_PATTERN characters are kept per role, and they scan MAX_USER_SCAN.
 */
function compile(rules) {
  let c = compiled.get(rules);
  if (c) return c;
  c = {};
  for (const role of ROLES) {
    c[role] = [];
    let own = 0;
    const list = Object.hasOwn(rules, role) && Array.isArray(rules[role]) ? rules[role] : [];
    for (const src of list) {
      if (typeof src !== 'string') continue;
      if (BUILT_IN.has(src)) {
        c[role].push({ re: new RegExp(src, 'i'), user: false });
        continue;
      }
      if (own >= MAX_USER_PATTERNS || src.length > MAX_USER_PATTERN || !src.trim()) continue;
      c[role].push({ re: new RegExp(phraseSource(src), 'i'), user: true });
      own += 1;
    }
  }
  compiled.set(rules, c);
  return c;
}

function route(role, setup, forced, modelOverride, why = '') {
  const s = (setup && Object.hasOwn(setup, role) && setup[role]) || DEFAULT_SETUP[role];
  return { role, model: modelOverride || s.model, effort: s.effort, forced, why: clean(why, WHY_MAX) };
}

/** Chores may win only when the prompt is short or opens with a mechanical verb. */
function choresAllowed(text) {
  return text.trim().split(/\s+/).length <= CHORES_MAX_WORDS || CHORES_START_RE.test(text);
}

/**
 * Decide which role a prompt belongs to.
 * Overrides: #self or "do it yourself" (no routing), #<role>, @<model> or "use <model> for this".
 * Tags count only at the start or end of the prompt; the plain-language forms only in its first
 * 200 characters.
 * Otherwise keyword scoring: any other role's match beats chores, chores needs a short or
 * mechanical prompt, and ties go to ROLES order (most capable first).
 * Returns {role, model, effort, forced, why} or null for "no routing".
 */
export function classify(prompt, rules, setup) {
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const text = prompt.slice(0, MAX_SCAN);

  const head = prompt.slice(0, PLAIN_SCAN);

  if (edge(SELF_TAG, prompt) || SELF_PLAIN_RE.test(head)) return null;

  const tag = edge(TAG, prompt);
  if (tag) return route(tag[1].toLowerCase(), setup, true, undefined, `#${tag[1].toLowerCase()}`);

  const at = edge(AT, prompt) || PLAIN_MODEL_RE.exec(head);
  if (at) {
    const model = (at[1] || at[2]).toLowerCase();
    const byActive = ROLES.find(r => setup[r]?.model === model);
    const why = at[0].trim().replace(/[\s\p{P}]+$/u, '');
    if (byActive) return route(byActive, setup, true, undefined, why);
    const byDefault = ROLES.find(r => DEFAULT_SETUP[r].model === model) || 'code';
    return route(byDefault, setup, true, model, why);
  }

  const res = compile(rules);
  const userText = text.slice(0, MAX_USER_SCAN);
  let best = null;
  let bestScore = 0;
  let bestWhy = '';
  for (const role of ROLES) {
    if (role === 'chores' && (best || !choresAllowed(text))) continue;
    let score = 0;
    let why = '';
    for (const { re, user } of res[role]) {
      const m = re.exec(user ? userText : text);
      if (m) { score += 1; if (!why) why = m[0].trim(); }
    }
    if (score > bestScore) { best = role; bestScore = score; bestWhy = why; }
  }
  return best ? route(best, setup, false, undefined, bestWhy) : null;
}
