import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROLES, MODELS, EFFORTS, DEFAULT_SETUP, DEFAULT_RULES } from './defaults.js';

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
  return d;
}

export function saveSetups(d) {
  const { main_model: _unused, ...rest } = d; // main_model belonged to the old helper design
  writeJson('setups.json', rest);
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

/** Write the default rules to rules.json unless it exists. Returns its path and whether it was created. */
export function writeDefaultRules() {
  const target = file('rules.json');
  if (fs.existsSync(target)) return { path: target, created: false };
  writeJson('rules.json', DEFAULT_RULES);
  return { path: target, created: true };
}

/** Turn routing on or off everywhere. /router off in a session pauses that session only. */
export function setEnabled(on) {
  const d = loadSetups();
  d.enabled = on;
  saveSetups(d);
}
