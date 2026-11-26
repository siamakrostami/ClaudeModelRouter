import { ROLES, DEFAULT_SETUP, agentName } from './defaults.js';

const MAX_SCAN = 4000; // only the start of a prompt is scanned, keeps huge pastes fast

// Plain-language versions of #self and @model.
const SELF_RE = /\b(do it yourself|do this yourself|don'?t delegate|no helpers?|without (a )?helpers?)\b/i;
const PLAIN_MODEL_RE = /\b(?:use|using|with|on|switch to|via)\s+(?:the\s+)?(fable|opus|sonnet|haiku)\b/i;

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
  return { role, model: modelOverride || s.model, effort: s.effort, agent: agentName(role), forced, why };
}

/**
 * Decide which role a prompt belongs to.
 * Overrides: #self (no routing), #<role>, @<model>. Otherwise keyword scoring; ties go to ROLES order.
 * Returns {role, model, effort, agent, forced, why} or null for "no routing".
 */
export function classify(prompt, rules, setup) {
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const text = prompt.slice(0, MAX_SCAN);

  if (/(^|\s)#self\b/i.test(text) || SELF_RE.test(text)) return null;

  const tag = /(?:^|\s)#(plan|review|hard|code|write|chores)\b/i.exec(text);
  if (tag) return route(tag[1].toLowerCase(), setup, true, undefined, tag[0].trim());

  const at = /(?:^|\s)@(fable|opus|sonnet|haiku)\b/i.exec(text) || PLAIN_MODEL_RE.exec(text);
  if (at) {
    const model = at[1].toLowerCase();
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

/** One-line note injected into the main chat. */
export function note(r, mainModel = 'fable') {
  if (r.role === 'plan' && r.model === mainModel) {
    return `Switchboard: "plan" work → handle it yourself (${mainModel}).`;
  }
  return `Switchboard: "${r.role}" work → delegate to the ${r.agent} agent (${r.model}, ${r.effort}). Required: do this work through the Agent tool with subagent_type "${r.agent}" instead of doing it yourself; if the request mixes kinds of work, split it across router helpers.`;
}
