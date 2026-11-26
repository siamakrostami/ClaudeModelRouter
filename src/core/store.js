import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROLES, MODELS, EFFORTS, DEFAULT_SETUP, DEFAULT_RULES } from './defaults.js';

const DAY_MS = 24 * 3600 * 1000;

export function home() {
  return process.env.CLAUDE_MODEL_ROUTER_HOME || path.join(os.homedir(), '.claude', 'claude-model-router');
}

function file(name) {
  return path.join(home(), name);
}

function writeJson(name, data) {
  fs.mkdirSync(home(), { recursive: true });
  const target = file(name);
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, target);
}

/** Read JSON; on a missing file create it from fallback(); on corrupt JSON back it up first. */
function readJson(name, fallback, valid = () => true) {
  const target = file(name);
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch {
    const d = fallback();
    writeJson(name, d);
    return d;
  }
  try {
    const d = JSON.parse(raw);
    if (valid(d)) return d;
  } catch { /* fall through */ }
  fs.copyFileSync(target, `${target}.bak`);
  const d = fallback();
  writeJson(name, d);
  return d;
}

const defaultSetups = () => ({ active: 'default', enabled: true, setups: { default: structuredClone(DEFAULT_SETUP) } });
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export function loadSetups() {
  const d = readJson('setups.json', defaultSetups, v => isObj(v) && isObj(v.setups));
  if (!d.setups[d.active]) d.active = Object.keys(d.setups)[0] || 'default';
  if (!d.setups[d.active]) d.setups[d.active] = structuredClone(DEFAULT_SETUP);
  if (typeof d.enabled !== 'boolean') d.enabled = true;
  if (!MODELS.includes(d.main_model)) d.main_model = 'fable';
  return d;
}

/** The model the main chat is configured to run on. CLAUDE_MODEL_ROUTER_MAIN_MODEL overrides setups.json. */
export function mainModel() {
  const env = process.env.CLAUDE_MODEL_ROUTER_MAIN_MODEL;
  return MODELS.includes(env) ? env : loadSetups().main_model;
}

export function saveSetups(d) {
  writeJson('setups.json', d);
}

function filled(setup) {
  const out = {};
  for (const r of ROLES) {
    const s = isObj(setup?.[r]) ? setup[r] : {};
    out[r] = {
      model: MODELS.includes(s.model) ? s.model : DEFAULT_SETUP[r].model,
      effort: EFFORTS.includes(s.effort) ? s.effort : DEFAULT_SETUP[r].effort,
    };
  }
  return out;
}

export function activeSetup() {
  const d = loadSetups();
  return filled(d.setups[d.active]);
}

export function activeName() {
  return loadSetups().active;
}

export function setRole(role, model, effort) {
  if (!ROLES.includes(role)) throw new Error(`unknown role "${role}" (roles: ${ROLES.join(', ')})`);
  if (!MODELS.includes(model)) throw new Error(`unknown model "${model}" (models: ${MODELS.join(', ')})`);
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error(`unknown effort "${effort}" (efforts: ${EFFORTS.join(', ')})`);
  const d = loadSetups();
  const s = filled(d.setups[d.active]);
  s[role] = { model, effort: effort ?? s[role].effort };
  d.setups[d.active] = s;
  saveSetups(d);
}

const NAME_RE = /^[\w.-]{1,40}$/;

export function saveAs(name) {
  if (!NAME_RE.test(name)) throw new Error(`invalid setup name "${name}" (letters, digits, - _ . ; max 40)`);
  const d = loadSetups();
  d.setups[name] = filled(d.setups[d.active]);
  d.active = name;
  saveSetups(d);
}

export function use(name) {
  const d = loadSetups();
  if (!Object.hasOwn(d.setups, name)) throw new Error(`no setup named "${name}" (have: ${Object.keys(d.setups).join(', ')})`);
  d.active = name;
  saveSetups(d);
}

export function remove(name) {
  const d = loadSetups();
  if (!Object.hasOwn(d.setups, name)) throw new Error(`no setup named "${name}"`);
  if (d.active === name) throw new Error(`"${name}" is the active setup; switch to another one first`);
  delete d.setups[name];
  saveSetups(d);
}

export function listSetups() {
  const d = loadSetups();
  return { active: d.active, names: Object.keys(d.setups) };
}

export function loadRules() {
  const d = readJson('rules.json', () => structuredClone(DEFAULT_RULES),
    v => isObj(v) && ROLES.every(r => v[r] === undefined || (Array.isArray(v[r]) && v[r].every(x => typeof x === 'string'))));
  const out = {};
  for (const r of ROLES) out[r] = d[r] || DEFAULT_RULES[r];
  return out;
}

// ---- per-session state ----
// sessions/<sid>/session.json holds enabled / last_route / forced.
// sessions/<sid>/running/<tool_use_id>.json is one file per running helper, so parallel hooks never clobber each other.

const RUNNING_TTL_MS = 30 * 60 * 1000;

function safe(id) {
  return encodeURIComponent(String(id)).replace(/\./g, '%2E').slice(0, 200);
}

function sessionDir(sessionId) {
  return path.join(home(), 'sessions', safe(sessionId));
}

function pruneSessions() {
  const root = path.join(home(), 'sessions');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return; }
  const now = Date.now();
  for (const n of names) {
    const dir = path.join(root, n);
    try {
      if (now - fs.statSync(dir).mtimeMs > DAY_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* another process got there first */ }
  }
}

function readRunning(sessionId) {
  const dir = path.join(sessionDir(sessionId), 'running');
  const out = {};
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return out; }
  const now = Date.now();
  const entries = [];
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs > RUNNING_TTL_MS) { fs.rmSync(full, { force: true }); continue; }
      const d = JSON.parse(fs.readFileSync(full, 'utf8'));
      entries.push([st.mtimeMs, d.id, d.label]);
    } catch { /* half-written or just removed */ }
  }
  entries.sort((a, b) => a[0] - b[0]);
  for (const [, id, label] of entries) out[id] = label;
  return out;
}

export function readState(sessionId) {
  if (!sessionId) return {};
  let s = {};
  try {
    const d = JSON.parse(fs.readFileSync(path.join(sessionDir(sessionId), 'session.json'), 'utf8'));
    if (isObj(d)) s = d;
  } catch { /* none yet */ }
  const running = readRunning(sessionId);
  if (Object.keys(running).length) s.running = running;
  return s;
}

export function updateState(sessionId, fn) {
  if (!sessionId) return;
  pruneSessions();
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'session.json');
  let s = {};
  try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (isObj(d)) s = d; } catch { /* new */ }
  fn(s);
  delete s.running;
  s.ts = Date.now();
  const tmp = `${f}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, f);
  const now = new Date();
  fs.utimesSync(dir, now, now);
}

export function addRunning(sessionId, toolUseId, label) {
  if (!sessionId) return;
  const dir = path.join(sessionDir(sessionId), 'running');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${safe(toolUseId)}.json`);
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ id: toolUseId, label }));
  fs.renameSync(tmp, f);
}

export function removeRunning(sessionId, toolUseId) {
  if (!sessionId) return;
  fs.rmSync(path.join(sessionDir(sessionId), 'running', `${safe(toolUseId)}.json`), { force: true });
}

export function clearRunning(sessionId) {
  if (!sessionId) return;
  fs.rmSync(path.join(sessionDir(sessionId), 'running'), { recursive: true, force: true });
}

export function sessionEnabled(sessionId) {
  const s = readState(sessionId);
  if (typeof s.enabled === 'boolean') return s.enabled;
  return loadSetups().enabled;
}

export function setEnabled(on, sessionId) {
  if (sessionId) {
    updateState(sessionId, s => { s.enabled = on; });
    return;
  }
  const d = loadSetups();
  d.enabled = on;
  saveSetups(d);
}
