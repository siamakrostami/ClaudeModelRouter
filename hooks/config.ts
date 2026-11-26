import { DEFAULT_RULES, DEFAULT_SETUP, EFFORTS, MODELS, ROLES } from '../src/core/defaults.js'

import type { Config, Setup } from '../types'

export const MODEL_COLOR: Record<string, string> = {
  fable: '#C084FC',
  opus: '#F59E0B',
  sonnet: '#22D3EE',
  haiku: '#4ADE80',
}
export const MODEL_NAME: Record<string, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }
export const ROLE_LIST: readonly string[] = ROLES
export const MODEL_LIST: readonly string[] = MODELS
export const EFFORT_LIST: readonly string[] = EFFORTS

export function family(model: string | undefined) {
  return /(fable|opus|sonnet|haiku)/i.exec(model ?? '')?.[1]?.toLowerCase() ?? ''
}

export function meter(effort: string) {
  const level = Math.max(0, EFFORT_LIST.indexOf(effort)) + 1
  return { on: '●'.repeat(level), off: '○'.repeat(EFFORT_LIST.length - level) }
}

function fill(setup: any): Setup {
  const out: Setup = {}
  for (const r of ROLE_LIST) {
    const s = setup && typeof setup[r] === 'object' ? setup[r] : {}
    out[r] = {
      model: MODEL_LIST.includes(s.model) ? s.model : (DEFAULT_SETUP as any)[r].model,
      effort: EFFORT_LIST.includes(s.effort) ? s.effort : (DEFAULT_SETUP as any)[r].effort,
    }
  }
  return out
}

export async function home($: any) {
  const custom = await $.env.get('SWITCHBOARD_HOME')
  return custom || `${await $.env.get('HOME')}/.claude/switchboard`
}

export async function readJson($: any, path: string) {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

/** Read setups.json and rules.json (same files the switchboard CLI edits), filling defaults. */
export async function loadConfig($: any): Promise<Config> {
  const dir = await home($)
  const raw = (await readJson($, `${dir}/setups.json`)) || {}
  const setups: Record<string, Setup> = {}
  for (const [name, s] of Object.entries<any>(raw.setups || {})) setups[name] = fill(s)
  if (!Object.keys(setups).length) setups.default = fill(null)
  const active = typeof raw.active === 'string' && setups[raw.active] ? raw.active : Object.keys(setups)[0]
  const rulesRaw = (await readJson($, `${dir}/rules.json`)) || {}
  const rules: Record<string, string[]> = {}
  for (const r of ROLE_LIST) {
    const v = rulesRaw[r]
    rules[r] = Array.isArray(v) && v.every((x: unknown) => typeof x === 'string') ? v : (DEFAULT_RULES as any)[r]
  }
  return {
    active,
    enabled: raw.enabled !== false,
    mainModel: MODEL_LIST.includes(raw.main_model) ? raw.main_model : 'fable',
    setups,
    rules,
  }
}

/** Write setups.json back in the CLI's format, keeping keys the mod does not know. */
export async function saveConfig($: any, cfg: Config) {
  const dir = await home($)
  const raw = (await readJson($, `${dir}/setups.json`)) || {}
  const out = { ...raw, active: cfg.active, enabled: cfg.enabled, main_model: cfg.mainModel, setups: cfg.setups }
  await $.fs.write(`${dir}/setups.json`, JSON.stringify(out, null, 2) + '\n')
}
