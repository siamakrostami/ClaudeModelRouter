import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROLES, MODELS, EFFORTS, DEFAULT_SETUP, DEFAULT_RULES, DEFAULT_STICKY_TOKENS, stickyOf } from './defaults.js';
import { clean, isSetupName } from './safe.js';

/**
 * The data folder. CLAUDE_MODEL_ROUTER_HOME may name any absolute folder (the person runs the CLI
 * themselves; tests use temp folders), but a relative one is refused. The mod never reads it
 * (hooks/config.ts): it always uses <HOME or USERPROFILE>/.claude/claude-model-router.
 */
export function home() {
  const custom = process.env.CLAUDE_MODEL_ROUTER_HOME;
  if (!custom) return path.join(os.homedir(), '.claude', 'claude-model-router');
  if (!path.isAbsolute(custom)) throw new Error('CLAUDE_MODEL_ROUTER_HOME must be an absolute path');
  return custom;
}

function file(name) {
  return path.join(home(), name);
}

// The folder is the person's alone (0700), and so is every file in it (0600).
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function writeJson(name, data) {
  fs.mkdirSync(home(), { recursive: true, mode: DIR_MODE });
  const target = file(name);
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: FILE_MODE, flag: 'wx' });
  fs.renameSync(tmp, target);
}

/**
 * Copy a corrupt file to <file>.bak-<epoch ms> before it is replaced. Never follows a symlink
 * at that name and never overwrites an older backup: either case skips the backup.
 */
function backup(target) {
  const bak = `${target}.bak-${Date.now()}`;
  let existing = null;
  try { existing = fs.lstatSync(bak); } catch { /* not there: good */ }
  if (existing) return; // a symlink, or an older backup from the same millisecond
  try {
    fs.copyFileSync(target, bak, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(bak, FILE_MODE);
  } catch { /* best effort: the load still recovers */ }
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
  backup(target);
  const d = fallback();
  writeJson(name, d);
  return d;
}

const defaultSetups = () => ({ active: 'default', enabled: true, setups: { default: structuredClone(DEFAULT_SETUP) } });
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Load setups.json. Only setups with a valid own name (isSetupName) are kept; prototype keys
 * such as __proto__ and names with odd characters are dropped. An active name that is not one
 * of them falls back to the first setup, or a fresh default.
 */
export function loadSetups() {
  const d = readJson('setups.json', defaultSetups, v => isObj(v) && isObj(v.setups));
  const setups = {};
  for (const name of Object.keys(d.setups)) {
    if (isSetupName(name) && isObj(d.setups[name])) setups[name] = d.setups[name];
  }
  d.setups = setups;
  if (typeof d.active !== 'string' || !Object.hasOwn(setups, d.active)) d.active = Object.keys(setups)[0] || 'default';
  if (!Object.hasOwn(setups, d.active)) setups[d.active] = structuredClone(DEFAULT_SETUP);
  if (typeof d.enabled !== 'boolean') d.enabled = true;
  return d;
}

export function saveSetups(d) {
  const { main_model: _unused, ...rest } = d; // main_model belonged to the old helper design
  writeJson('setups.json', rest);
}

function filled(setup) {
  const out = {};
  for (const r of ROLES) {
    const s = isObj(setup) && Object.hasOwn(setup, r) && isObj(setup[r]) ? setup[r] : {};
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
  if (!ROLES.includes(role)) throw new Error(`unknown role "${clean(role, 40)}" (roles: ${ROLES.join(', ')})`);
  if (!MODELS.includes(model)) throw new Error(`unknown model "${clean(model, 40)}" (models: ${MODELS.join(', ')})`);
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error(`unknown effort "${clean(effort, 40)}" (efforts: ${EFFORTS.join(', ')})`);
  const d = loadSetups();
  const s = filled(d.setups[d.active]);
  s[role] = { model, effort: effort ?? s[role].effort };
  d.setups[d.active] = s;
  saveSetups(d);
}

function needName(name) {
  if (name === undefined || name === '') throw new Error('a setup name is required');
}

export function saveAs(name) {
  needName(name);
  if (!isSetupName(name)) throw new Error(`invalid setup name "${clean(name, 40)}" (letters, digits, - _ . ; max 40)`);
  const d = loadSetups();
  d.setups[name] = filled(d.setups[d.active]);
  d.active = name;
  saveSetups(d);
}

const names = d => Object.keys(d.setups).map(n => clean(n, 40)).join(', ');

export function use(name) {
  needName(name);
  const d = loadSetups();
  if (!Object.hasOwn(d.setups, name)) throw new Error(`no setup named "${clean(name, 40)}" (have: ${names(d)})`);
  d.active = name;
  saveSetups(d);
}

export function remove(name) {
  needName(name);
  const d = loadSetups();
  if (!Object.hasOwn(d.setups, name)) throw new Error(`no setup named "${clean(name, 40)}"`);
  if (d.active === name) throw new Error(`"${clean(name, 40)}" is the active setup; switch to another one first`);
  delete d.setups[name];
  saveSetups(d);
}

export function listSetups() {
  const d = loadSetups();
  return { active: d.active, names: Object.keys(d.setups) };
}

/** Write the default rules to rules.json unless it exists. Returns its path and whether it was created. */
export function writeDefaultRules() {
  const target = file('rules.json');
  if (fs.existsSync(target)) return { path: target, created: false };
  writeJson('rules.json', DEFAULT_RULES);
  return { path: target, created: true };
}

/**
 * Add the setups of a presets file (parsed) whose names are not taken yet. Never overwrites a
 * setup and never changes the active one. Throws on a file that is not {setups: {...}}.
 * Returns the names added and the names kept as they were.
 */
export function addPresets(presets) {
  if (!isObj(presets) || !isObj(presets.setups)) throw new Error('the presets file does not hold {"setups": {...}}');
  const d = loadSetups();
  const added = [];
  const kept = [];
  for (const name of Object.keys(presets.setups)) {
    if (!isSetupName(name) || !isObj(presets.setups[name])) continue;
    if (Object.hasOwn(d.setups, name)) { kept.push(name); continue; }
    d.setups[name] = filled(presets.setups[name]);
    added.push(name);
  }
  if (added.length) saveSetups(d);
  return { added, kept };
}

export { DEFAULT_STICKY_TOKENS };

/**
 * sticky_tokens from setups.json (a non-negative integer, else the default): from this context
 * size an automatic route keeps the previous model; 0 turns it off. Saves keep the key as is.
 */
export function stickyTokens() {
  return stickyOf(loadSetups().sticky_tokens);
}

/** Turn routing on or off everywhere. /router off in a session pauses that session only. */
export function setEnabled(on) {
  const d = loadSetups();
  d.enabled = on;
  saveSetups(d);
}
