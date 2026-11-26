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

/** Effort as dots; an unknown or empty effort shows an empty meter. */
export function meter(effort: string) {
  const level = EFFORT_LIST.indexOf(effort) + 1
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

/** The data folder the CLI shares, or null when no home folder is known (then nothing is read or written). */
export async function home($: any): Promise<string | null> {
  const custom = await $.env.get('CLAUDE_MODEL_ROUTER_HOME').catch(() => undefined)
  if (custom) return custom
  const user = (await $.env.get('HOME').catch(() => undefined)) || (await $.env.get('USERPROFILE').catch(() => undefined))
  return user ? `${user}/.claude/claude-model-router` : null
}

export async function readJson($: any, path: string) {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

/** Read setups.json and rules.json (same files the claude-model-router CLI edits), filling defaults. */
export async function loadConfig($: any): Promise<Config> {
  const dir = await home($)
  const parsed = dir ? await readJson($, `${dir}/setups.json`) : null
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  const setups: Record<string, Setup> = {}
  for (const [name, s] of Object.entries<any>(raw.setups || {})) setups[name] = fill(s)
  if (!Object.keys(setups).length) setups.default = fill(null)
  const active = typeof raw.active === 'string' && setups[raw.active] ? raw.active : Object.keys(setups)[0]
  const rulesRaw = (dir ? await readJson($, `${dir}/rules.json`) : null) || {}
  const rules: Record<string, string[]> = {}
  for (const r of ROLE_LIST) {
    const v = rulesRaw[r]
    rules[r] = Array.isArray(v) && v.every((x: unknown) => typeof x === 'string') ? v : (DEFAULT_RULES as any)[r]
  }
  return {
    active,
    enabled: raw.enabled !== false,
    setups,
    rules,
  }
}

/**
 * Write setups.json back in the CLI's format, keeping keys the mod does not know.
 *
 * A file that exists but does not parse is copied to setups.json.bak first, as the CLI does.
 * `$.fs.write` has no rename, so this write is not atomic: a crash mid-write can leave a
 * truncated file, which the next load treats as corrupt (backed up, defaults used).
 */
export async function saveConfig($: any, cfg: Config) {
  const dir = await home($)
  if (!dir) return
  const file = `${dir}/setups.json`
  let text: string | null = null
  try {
    text = await $.fs.read(file)
  } catch {
    text = null // no file yet
  }
  let raw: Record<string, unknown> = {}
  if (text != null) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
    else await $.fs.write(`${file}.bak`, text)
  }
  const { main_model: _old, ...kept } = raw // main_model belonged to the old helper design
  const out = { ...kept, active: cfg.active, enabled: cfg.enabled, setups: cfg.setups }
  await $.fs.write(file, JSON.stringify(out, null, 2) + '\n')
}
