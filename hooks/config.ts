import { DEFAULT_RULES, DEFAULT_SETUP, EFFORTS, MODELS, ROLES } from '../src/core/defaults.js'
import { isSetupName } from '../src/core/safe.js'

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

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

function fill(setup: any): Setup {
  const out: Setup = {}
  for (const r of ROLE_LIST) {
    const s = isObj(setup) && Object.hasOwn(setup, r) && isObj(setup[r]) ? setup[r] : {}
    out[r] = {
      model: MODEL_LIST.includes(s.model) ? s.model : (DEFAULT_SETUP as any)[r].model,
      effort: EFFORT_LIST.includes(s.effort) ? s.effort : (DEFAULT_SETUP as any)[r].effort,
    }
  }
  return out
}

/** A POSIX absolute path (/home/me) or a Windows drive path (C:\Users\me). */
function isAbsolute(p: unknown): p is string {
  return typeof p === 'string' && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))
}

/**
 * The data folder the CLI shares: always <HOME or USERPROFILE>/.claude/claude-model-router, from
 * the first of the two that is an absolute path. CLAUDE_MODEL_ROUTER_HOME is never read here: a
 * project's .claude/settings.json can set the session's env, so honouring it would let a repo
 * point the mod at files it controls (the CLI still honours it). With no absolute home folder
 * this returns null, and nothing is read or written.
 */
export async function home($: any): Promise<string | null> {
  // $.env.get takes a literal name, so the variables the mod reads can be listed.
  const homeVar = await $.env.get('HOME').catch(() => undefined)
  const user = isAbsolute(homeVar) ? homeVar : await $.env.get('USERPROFILE').catch(() => undefined)
  if (!isAbsolute(user)) return null
  return `${user.replace(/[\\/]+$/, '')}/.claude/claude-model-router`
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
  const raw = isObj(parsed) ? parsed : {}
  // Only own keys with a valid name (no __proto__, constructor, ...): the same rule as the CLI.
  const setups: Record<string, Setup> = {}
  for (const [name, s] of Object.entries<any>(isObj(raw.setups) ? raw.setups : {})) {
    if (isSetupName(name) && isObj(s)) setups[name] = fill(s)
  }
  if (!Object.keys(setups).length) setups.default = fill(null)
  const active = typeof raw.active === 'string' && Object.hasOwn(setups, raw.active) ? raw.active : (Object.keys(setups)[0] as string)
  const parsedRules = dir ? await readJson($, `${dir}/rules.json`) : null
  const rulesRaw = isObj(parsedRules) ? parsedRules : {}
  const rules: Record<string, string[]> = {}
  for (const r of ROLE_LIST) {
    const v = Object.hasOwn(rulesRaw, r) ? rulesRaw[r] : undefined
    rules[r] = Array.isArray(v) && v.every((x: unknown) => typeof x === 'string') ? v : (DEFAULT_RULES as any)[r]
  }
  return {
    active,
    enabled: raw.enabled !== false,
    setups,
    rules,
  }
}

/** Copy unparsable text to <file>.bak-<epoch ms>, unless that name exists (or is a link). */
async function backup($: any, file: string, text: string) {
  const bak = `${file}.bak-${Date.now()}`
  const there = await $.fs.stat(bak).catch(() => null)
  if (there) return // isLink, or an older backup: never follow or overwrite it
  await $.fs.write(bak, text)
}

/**
 * Write setups.json back in the CLI's format, keeping keys the mod does not know.
 *
 * A file that exists but does not parse is copied to setups.json.bak-<epoch ms> first, as the
 * CLI does; the copy is skipped when something is already at that name (a symlink included), so
 * it never writes through a link or over an older backup. `$.fs.write` has no mode option, so
 * the mod cannot make the files 0600 the way the CLI does.
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
    else await backup($, file, text)
  }
  const { main_model: _old, ...kept } = raw // main_model belonged to the old helper design
  const out = { ...kept, active: cfg.active, enabled: cfg.enabled, setups: cfg.setups }
  await $.fs.write(file, JSON.stringify(out, null, 2) + '\n')
}
