import fs from 'node:fs';
import path from 'node:path';
import { roleFromAgent } from './defaults.js';
import { classify, note } from './classify.js';
import * as store from './store.js';
import { detectMainModel } from './transcript.js';

export const SESSION_RULE =
  'Switchboard (installed by the user) routes work by model. When a prompt carries a "Switchboard:" routing note, ' +
  'that note is the user\'s standing instruction: hand the work to the named switchboard:router-* agent with the Agent tool, ' +
  'even for small or quick tasks, and relay its result. Do it yourself only when the note says so, when the user writes #self, ' +
  'or when the user explicitly asks you to. Never pass model or effort to these agents; Switchboard sets them.';

/** SessionStart: one standing rule so routing notes are treated as the user's instruction. */
export function handleSessionStart(payload) {
  try { store.clearRunning(payload?.session_id); } catch { /* best effort */ }
  if (!store.sessionEnabled(payload?.session_id)) return null;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: SESSION_RULE } };
}

/** UserPromptSubmit: classify and inject a one-line routing note. */
export function handlePrompt(payload) {
  const sid = payload?.session_id;
  if (!store.sessionEnabled(sid)) return null;
  // The user switched the main chat's model by hand (/model): step aside until they switch back.
  const detected = detectMainModel(payload?.transcript_path);
  if (detected && detected !== store.mainModel()) {
    store.updateState(sid, s => { s.manual = detected; s.last_route = null; s.forced = null; });
    return null;
  }
  const setup = store.activeSetup();
  const r = classify(payload?.prompt, store.loadRules(), setup);
  store.updateState(sid, s => {
    s.manual = null;
    s.last_route = r ? r.role : null;
    // A forced model outside the setup is honoured for the next helper of that role only.
    s.forced = r && r.model !== setup[r.role].model ? { role: r.role, model: r.model } : null;
  });
  if (!r) return null;
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note(r, store.mainModel()) } };
}

/** PreToolUse(Agent|Task): force router helpers onto the active setup's model and effort. */
export function handleAgentPre(payload) {
  const input = payload?.tool_input;
  const role = roleFromAgent(input?.subagent_type);
  if (!role) return null;
  const sid = payload.session_id;
  if (store.readState(sid).manual) return null;
  let { model, effort } = store.activeSetup()[role];
  const forced = store.readState(sid).forced;
  if (forced?.role === role) {
    model = forced.model;
    store.updateState(sid, s => { s.forced = null; });
  }
  store.addRunning(sid, payload.tool_use_id || `t${Date.now()}`, `${role}→${model}`);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `Switchboard: ${role} → ${model} (${effort})`,
      updatedInput: { ...input, model, effort },
    },
  };
}

/** PostToolUse(Agent|Task): the helper is done. */
export function handleAgentPost(payload) {
  if (!roleFromAgent(payload?.tool_input?.subagent_type) || !payload?.tool_use_id) return null;
  store.removeRunning(payload.session_id, payload.tool_use_id);
  return null;
}

/** Read hook JSON from stdin, run the handler, print its output. Never throws, always exits 0. */
export function runHook(handler) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    try {
      const out = handler(JSON.parse(raw));
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (e) {
      try {
        fs.mkdirSync(store.home(), { recursive: true });
        fs.appendFileSync(path.join(store.home(), 'error.log'),
          `${new Date().toISOString()} ${handler.name}: ${e?.stack || e}\n`);
      } catch { /* nothing else we can do */ }
    }
    process.exitCode = 0;
  });
}
