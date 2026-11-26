import { atom, read, update } from 'claude-code'
import type { PromptSubmitInput, Register } from 'claude-code'

import { classify } from '../src/core/classify.js'
import { clean, fingerprint } from '../src/core/safe.js'
import type { Config, Live, Place, Route, Setup } from '../types'
import {
  EFFORT_LIST,
  MODEL_COLOR,
  MODEL_LIST,
  MODEL_NAME,
  ROLE_LIST,
  family,
  loadConfig,
  meter,
  saveConfig,
} from './config'

const PANE = 'claude-model-router'

const config = atom({ plugin: 'model-router', key: 'config' } as const, null, { shape: 'config-2' })
/** The route `turn.step` applies, bound to one turn by id and cleared when that turn completes. */
const route = atom({ plugin: 'model-router', key: 'route' } as const, null, { shape: 'route-2' })
/** The route of the person's latest turn, for the band and the pane to show. Never applied. */
const last = atom({ plugin: 'model-router', key: 'last' } as const, null, { shape: 'last-1' })
/** Decided at an idle submit; `turn.start` binds it to the turn that follows. */
const pending = atom({ plugin: 'model-router', key: 'pending' } as const, null, { shape: 'pending-1' })
/**
 * A prompt typed while a turn ran: bound only to a later turn that starts with the same text.
 * Only a fingerprint of the text is kept (fingerprint: FNV-1a hash plus length), never the text.
 */
const queued = atom({ plugin: 'model-router', key: 'queued' } as const, null, { shape: 'queued-2' })
const live = atom({ plugin: 'model-router', key: 'live' } as const, null, { shape: 'live-1' })
const paused = atom({ plugin: 'model-router', key: 'paused' } as const, false)
const manual = atom({ plugin: 'model-router', key: 'manual' } as const, null)
const pin = atom({ plugin: 'model-router', key: 'pin' } as const, null)
const place = atom({ plugin: 'model-router', key: 'place' } as const, null)
const base = atom({ plugin: 'model-router', key: 'base' } as const, null)
const tab = atom({ plugin: 'model-router', key: 'tab' } as const, 'now')

/** The active setup; an own key only, so a name like toString never reaches Object.prototype. */
function activeOf(cfg: Config): Setup {
  return Object.hasOwn(cfg.setups, cfg.active) ? (cfg.setups[cfg.active] as Setup) : {}
}

/** One task's slot of a setup, an own key only. */
function slotIn(setup: Setup | undefined, role: string) {
  return setup && Object.hasOwn(setup, role) ? setup[role] : undefined
}

/** How long a name, folder or branch may be when drawn. */
const NAME_MAX = 40
const PLACE_MAX = 120

async function reload($: any) {
  const cfg = await loadConfig($)
  await update($, config, () => cfg)
  return cfg
}

/**
 * Change the config, save it to setups.json and keep the atom in step. Starts from the file
 * as it is now, so a change the CLI or another session made since is kept.
 */
async function edit($: any, fn: (cfg: Config) => Config) {
  const cfg = fn(structuredClone(await loadConfig($)))
  await saveConfig($, cfg)
  await update($, config, () => cfg)
}

/** Pinned to a model: the effort of the first task that runs on it, else high. */
function pinRoute(setup: Setup, pinned: string): Route {
  const role = ROLE_LIST.find(r => slotIn(setup, r)?.model === pinned) ?? 'code'
  const slot = slotIn(setup, role)
  const effort = slot?.model === pinned ? slot.effort : 'high'
  return { role, model: pinned, effort, why: '', source: 'pin' }
}

/**
 * Who a prompt is from. Only the person's own prompts are routed: typed (or queued) at the
 * terminal, sent from Remote Control or the SDK host, or a plugin's submit made as their words.
 * Notifications, schedules, peers and meta prompts run on the session's model. An absent origin
 * is the person's (as `PromptSubmitResult` reads it).
 */
function fromPerson(e: PromptSubmitInput) {
  if (e.isMeta) return false
  const o = e.origin
  if (!o) return true
  return o.kind === 'composer' || o.kind === 'bridge' || o.kind === 'sdk' || (o.kind === 'plugin' && o.asUser === true)
}

/**
 * Decide a turn's route from the prompt, a pin, or nothing (stay on the session's model).
 * A slash command or skill is never classified; a pin still applies to it.
 */
async function decide($: any, text: string, isCommand: boolean) {
  const cfg = await reload($)
  const sessionModel = family(String(await $.session.model()))
  // Manual only when the model was changed with /model after the session started.
  const started = await read($, base)
  if (!started && sessionModel) await update($, base, () => sessionModel)
  const isManual = sessionModel !== '' && !!started && sessionModel !== started
  await update($, manual, () => (isManual ? sessionModel : null))
  if (!cfg.enabled || isManual || (await read($, paused))) return null
  const setup = activeOf(cfg)
  const pinned = await read($, pin)
  if (pinned && MODEL_LIST.includes(pinned)) return pinRoute(setup, pinned)
  if (isCommand) return null
  const r = classify(text, cfg.rules, setup)
  if (!r) return null
  return { role: r.role, model: r.model, effort: r.effort, why: r.why, source: 'auto' } as Route
}

/** Turn routing on or off from the pane. On also clears a saved "enabled: false". */
async function power($: any, turnOn: boolean) {
  await update($, paused, () => !turnOn)
  if (turnOn && (await loadConfig($)).enabled === false) await edit($, c => ({ ...c, enabled: true }))
  else await reload($)
}

/** Set one task's model or effort in the active setup. */
async function setSlot($: any, role: string, field: 'model' | 'effort', value: string) {
  await edit($, c => {
    if (!Object.hasOwn(c.setups, c.active)) return c
    const setup = c.setups[c.active] as Setup
    const slot = slotIn(setup, role)
    if (!slot) return c
    return { ...c, setups: { ...c.setups, [c.active]: { ...setup, [role]: { ...slot, [field]: value } } } }
  })
}

type Mode = 'auto' | 'pinned' | 'main' | 'manual' | 'off'
type View = { cfg: Config; last: Route | null; live: Live | null; paused: boolean; manual: string | null; pin: string | null; base: string | null }

/**
 * What the band and the pane both show: the route of the person's latest turn, or the pin,
 * or what the last request went out with. Before any request: the model the session started
 * on, with no effort (it is not known yet).
 */
function status(v: View) {
  const { cfg, last: r, live: l, manual: man } = v
  const pinned = v.pin && MODEL_LIST.includes(v.pin) ? pinRoute(activeOf(cfg), v.pin) : null
  const mode: Mode = v.paused || !cfg.enabled ? 'off' : man ? 'manual' : pinned ? 'pinned' : r ? 'auto' : 'main'
  const idle = l ?? { model: v.base ?? '', effort: '' }
  const shown =
    mode === 'manual' ? { model: man as string, effort: l?.effort ?? '' } : mode === 'pinned' && pinned ? pinned : mode === 'auto' && r ? r : idle
  return {
    mode,
    model: shown.model,
    effort: shown.effort,
    role: mode === 'auto' && r ? r.role : mode === 'pinned' && pinned ? pinned.role : '',
    why: mode === 'auto' && r?.why ? clean(r.why, 40) : '',
  }
}

async function view($: any, cfg: Config): Promise<View> {
  return {
    cfg,
    last: await read($, last),
    live: await read($, live),
    paused: await read($, paused),
    manual: await read($, manual),
    pin: await read($, pin),
    base: await read($, base),
  }
}

/** Display form of a task, mode or effort word: Plan, Manual, High. */
const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max' }
const effortLabel = (w: string) => EFFORT_LABEL[w] ?? cap(w)

/** The one-line route: meter, model, effort, then the task or the mode. Never wraps. */
function routeLine(Text: any, s: ReturnType<typeof status>, showEffort = true) {
  const off = s.mode === 'off'
  const color = off ? undefined : MODEL_COLOR[s.model] ?? 'gray'
  const m = meter(s.effort)
  return (
    <Text wrap="truncate-end">
      <Text color={color} dimColor={off}>{m.on}</Text>
      <Text dimColor>{m.off}</Text>
      <Text color={color} dimColor={off} bold={!off}> {MODEL_NAME[s.model] ?? (s.model || 'Session model')}</Text>
      {s.effort && showEffort ? <Text dimColor> · {effortLabel(s.effort)}</Text> : null}
      {s.mode === 'pinned' ? <Text dimColor>{'  '}Pinned</Text> : null}
      {s.mode === 'manual' ? <Text color="warning">{'  '}Manual</Text> : null}
      {off ? <Text dimColor>{'  '}Off</Text> : null}
    </Text>
  )
}

/** Context use as a bar, coloured green → amber → red, always shown with its percentage. */
function gauge(pct: number, width: number) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  const color = pct >= 80 ? '#F87171' : pct >= 60 ? '#F59E0B' : '#4ADE80'
  return { on: '▰'.repeat(filled), off: '▱'.repeat(width - filled), color }
}

/** Context use as a circle that fills by quarters, coloured by level; always shown with its percentage. */
function ring(pct: number) {
  const glyph = pct < 13 ? '○' : pct < 38 ? '◔' : pct < 63 ? '◑' : pct < 88 ? '◕' : '●'
  return { glyph, color: gauge(pct, 1).color }
}

/** Columns the band keeps for the route, the context circle and the two buttons. */
const PLACE_RESERVED = 62
/** Below this many columns left over, repo | branch is not shown at all. */
const PLACE_MIN = 12
/** Cut a string to `width` columns, ending in … when cut. */
const clip = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

/** Open the pane on one of its tabs. */
async function openPane($: any, which: 'now' | 'routes') {
  await update($, tab, () => which)
  await $.ui.open({ id: PANE, title: 'Claude Model Router' })
}

/**
 * Pad a dropdown label so every dropdown in a column is the same width (Select has no width
 * prop). Terminal: plain spaces to the longest label. Desktop: figure spaces, tuned to the
 * app's proportional font.
 */
const DESKTOP_PAD: Record<string, number> = { Fable: 2, Opus: 2, Sonnet: 0, Haiku: 2, Low: 3, Medium: 0, High: 3, 'X-High': 0, Max: 3 }
function padLabel(label: string, all: readonly string[], surface: string) {
  if (surface === 'terminal') return label.padEnd(Math.max(...all.map(x => x.length)), ' ')
  return label + '\u2007'.repeat(DESKTOP_PAD[label] ?? 0)
}

/**
 * The repo this session works in. When the folder is a repo, that one; when it is a folder that
 * holds several repos, the child whose HEAD moved most recently: the one in use.
 */
const MAX_CHILDREN = 40 // a folder of repos is scanned this far at most, so a huge folder stays quick

async function repoOf($: any, dir: string) {
  const here = await $.vcs.detect({ path: dir }).catch(() => null)
  if (here) return { name: String(here.root).split('/').filter(Boolean).pop() ?? dir, branch: here.branch ?? null }
  const entries: any[] = await $.fs.list(dir).catch(() => [])
  const children = entries.filter(x => x.kind === 'directory' && !x.name.startsWith('.')).slice(0, MAX_CHILDREN)
  const heads = await Promise.all(
    children.map(async x => {
      const head = await $.fs.stat(`${dir}/${x.name}/.git/logs/HEAD`).catch(() => null)
      return head ? { path: `${dir}/${x.name}`, at: Number(head.mtimeMs) } : null
    }),
  )
  let best: { path: string; at: number } | null = null
  for (const h of heads) if (h && (!best || h.at > best.at)) best = h
  if (!best) return null
  const copy = await $.vcs.detect({ path: best.path }).catch(() => null)
  return { name: best.path.split('/').pop() ?? best.path, branch: copy?.branch ?? null }
}

/** Repo, branch and context percentage for the band. Each part is best effort. */
async function where($: any) {
  const dir = String(await $.session.cwd().catch(() => '')) || String(await $.session.root())
  const repo = await repoOf($, dir)
  const usage = await $.session.usage().catch(() => null)
  const pct = usage?.context?.percent
  // Folder and branch names come from disk: no control bytes reach the band.
  const value: Place = {
    project: clean(repo?.name ?? dir.split('/').filter(Boolean).pop() ?? dir, PLACE_MAX),
    branch: repo?.branch ? clean(repo.branch, PLACE_MAX) : null,
    ctx: typeof pct === 'number' ? pct : null,
  }
  await update($, place, () => value)
}

/** Decide and park the route of a submitted prompt (see the prompt.submit hook). */
async function routeSubmit($: any, e: PromptSubmitInput) {
  const person = fromPerson(e)
  if (e.turnId === undefined) {
    // Idle: this prompt starts the next turn. Decide its route now; turn.start binds it.
    // A new submit always replaces an older pending route.
    const r = person ? await decide($, e.text, !!e.command).catch(() => null) : null
    await update($, pending, () => ({ route: r }))
    if (person) await update($, last, () => r)
  } else if (person && !e.command) {
    // Typed while a turn runs: never touches that turn. Kept for a later turn with this text.
    const r = await decide($, e.text, false).catch(() => null)
    await update($, queued, () => (r ? { hash: fingerprint(e.text.trim()), route: r } : null))
  }
}

const USAGE = 'Use /router for the pane, /router off|on to pause or resume this session, /router fable|opus|sonnet|haiku to pin a model, /router auto to unpin.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'router', description: 'Claude Model Router pane (also: /router off|on, /router auto, /router fable|opus|sonnet|haiku)' })
    await update($, route, () => null)
    await update($, pending, () => null)
    await update($, queued, () => null)
    await reload($).catch(() => {})
    await where($).catch(() => {})
    const startModel = family(String(await $.session.model().catch(() => '')))
    await update($, base, () => startModel || null)
    await update($, manual, () => null)
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'pause') {
      await update($, paused, () => true)
      return { text: 'Claude Model Router paused for this session.' }
    }
    if (arg === 'on' || arg === 'resume') {
      await update($, paused, () => false)
      return { text: 'Claude Model Router routing on.' }
    }
    if (arg === 'auto') {
      await update($, pin, () => null)
      return { text: 'Claude Model Router: back to automatic routing.' }
    }
    if (MODEL_LIST.includes(arg)) {
      await update($, pin, () => arg)
      return { text: `Claude Model Router: every turn uses ${MODEL_NAME[arg]}. /router auto to undo.` }
    }
    if (arg) return { text: `Claude Model Router: unknown option "${arg}". ${USAGE}` }
    await reload($).catch(() => {})
    await $.ui.open({ id: PANE, title: 'Claude Model Router' })
    return { text: 'Claude Model Router pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    where($).catch(() => {}) // the band's repo and context: refreshed, never waited for
    await routeSubmit($, e).catch(() => {}) // best effort: on any failure the prompt goes through unrouted
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (err) {
      if (e.turnId === undefined) await update($, pending, () => null).catch(() => {})
      throw err
    }
    // The prompt did not enter (a hook or the engine dropped it): no turn will bind its route,
    // so it must not wait for an unrelated later turn.
    if (e.turnId === undefined && result && 'drop' in result && result.drop !== undefined) await update($, pending, () => null)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const p = await read($, pending)
    let r: Route | null = p ? p.route : null
    if (!p) {
      const q = await read($, queued)
      if (q && e.text.trim() && q.hash === fingerprint(e.text.trim())) {
        r = q.route
        await update($, queued, () => null)
        await update($, last, () => r)
      }
    }
    await update($, pending, () => null)
    await update($, route, () => (r ? { ...r, turnId: e.turnId } : null))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const r = await read($, route)
      if (r && r.turnId === e.turnId) await update($, route, () => null)
      await update($, pending, () => null) // a route decided for a turn that never started ends here

      await where($).catch(() => {})
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const r = await read($, route)
    if (!r || r.turnId !== e.turnId || (await read($, paused))) {
      const sent: Live = { model: family(e.model), effort: typeof e.effort === 'string' ? e.effort : '' }
      await update($, live, () => sent)
      return yield* next(e)
    }
    await update($, live, () => ({ model: r.model, effort: r.effort }))
    return yield* next({ ...e, model: r.model, effort: r.effort as any })
  })

  // ---- the band above the prompt: one row, route on the left, controls on the right ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const cfg = await read($, config)
    if (!cfg) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const seen = await view($, cfg)
    const s = status(seen)
    const pinned = seen.pin
    const cols = e.props.bodyColumns ?? 80
    const pl = await read($, place)
    // Repo | branch gets what is left after the route and the controls, and only if a useful
    // part of it fits; it is cut to that width, so a long branch never pushes the row over.
    const room = cols - PLACE_RESERVED
    const where = pl ? `${clean(pl.project, PLACE_MAX)}${pl.branch ? ` | ${clean(pl.branch, PLACE_MAX)}` : ''}` : ''
    const placeText = where && room >= PLACE_MIN ? clip(where, room) : ''

    const row = (
      <Box paddingX={1} justifyContent="space-between" gap={2}>
        <Box gap={2} flexShrink={1} overflow="hidden">
          <Box flexShrink={0}>{routeLine(Text, s, cols >= 48)}</Box>
        </Box>
        <Box gap={1} flexShrink={1} overflow="hidden" justifyContent="flex-end">
          {placeText ? (
            <Box flexShrink={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">{placeText}</Text>
            </Box>
          ) : null}
          <Box gap={1} flexShrink={0}>
            {pl?.ctx != null ? (
              <Text>
                <Text color={ring(pl.ctx).color}>{ring(pl.ctx).glyph}</Text>
                <Text dimColor={pl.ctx < 60} color={pl.ctx >= 60 ? ring(pl.ctx).color : undefined}> {pl.ctx}%</Text>
              </Text>
            ) : null}
            <Button key="pin" label={pinned ? `${MODEL_NAME[pinned] ?? cap(pinned)} ▾` : 'Auto ▾'} plain onPress={() => openPane($, 'now')} />
            <Button key="settings" label="⚙️" plain onPress={() => openPane($, 'routes')} />
          </Box>
        </Box>
      </Box>
    )
    return row
  })

  // ---- the /router pane: tabs and on/off on top, one aligned row per task below ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const cfg = await read($, config)
    if (!cfg) return <Text dimColor>Loading…</Text>
    const current = (await read($, tab)) === 'routes' ? 'routes' : 'now'
    const seen = await view($, cfg)
    const s = status(seen)
    const pinned = seen.pin
    const pl = await read($, place)
    const isOff = s.mode === 'off'
    const setup = activeOf(cfg)
    const slotOf = (role: string) => slotIn(setup, role) ?? { model: '', effort: '' }
    const startedOn = seen.base
    // The Models rows need ~49 columns side by side; a narrower dock stacks each row in two lines.
    const narrow = (e.props.bodyColumns ?? 60) < 50

    // Minimized on the desktop: the route alone.
    if (e.props.placement === 'widget') return routeLine(Text, s)

    // A small section header, like a grouped list's.
    const section = (title: string) => (
      <Box marginTop={1} marginBottom={e.surface === 'terminal' ? 0 : 1}>
        <Text dimColor size="caption" weight="semibold">{title.toUpperCase()}</Text>
      </Box>
    )
    const accent = isOff ? undefined : MODEL_COLOR[s.model] ?? 'gray'
    const m = meter(s.effort)

    const header = (
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1}>
          <Button key="tab-now" label="Overview" variant={current === 'now' ? 'primary' : 'secondary'} onPress={() => update($, tab, () => 'now')} />
          <Button key="tab-routes" label="Models" variant={current === 'routes' ? 'primary' : 'secondary'} onPress={() => update($, tab, () => 'routes')} />
        </Box>
        <Box gap={1} alignItems="center">
          <Text dimColor size="footnote">Routing</Text>
          <Button key="power" label={isOff ? 'Off' : 'On'} variant={isOff ? 'secondary' : 'primary'} onPress={() => power($, isOff)} />
        </Box>
      </Box>
    )

    if (current === 'routes') {
      return (
        <Box flexDirection="column">
          {header}
          {section(`Models · ${clean(cfg.active, NAME_MAX)}`)}
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {ROLE_LIST.map(role => {
              const slot = slotOf(role)
              const modelPick = (
                <Box width={14} flexShrink={0} flexDirection="column" marginRight={1}>
                  <Select key={`model-${role}`} options={MODEL_LIST.map(v => ({ value: v, label: padLabel(MODEL_NAME[v] ?? v, MODEL_LIST.map(x => MODEL_NAME[x] ?? x), e.surface) }))} value={slot.model} onSelect={v => setSlot($, role, 'model', v)} />
                </Box>
              )
              const effortPick = (
                <Box width={14} flexShrink={0} flexDirection="column" marginRight={1}>
                  <Select key={`effort-${role}`} options={EFFORT_LIST.map(v => ({ value: v, label: padLabel(effortLabel(v), EFFORT_LIST.map(effortLabel), e.surface) }))} value={slot.effort} onSelect={v => setSlot($, role, 'effort', v)} />
                </Box>
              )
              const dots = (
                <Text>
                  <Text color={MODEL_COLOR[slot.model]}>{meter(slot.effort).on}</Text>
                  <Text dimColor>{meter(slot.effort).off}</Text>
                </Text>
              )
              if (narrow) {
                // Two lines per task: name and meter, then the two dropdowns (about 30 columns).
                return (
                  <Box key={`edit-${role}`} flexDirection="column">
                    <Box gap={1}>
                      <Text>{cap(role)}</Text>
                      {dots}
                    </Box>
                    <Box alignItems="center">
                      {modelPick}
                      {effortPick}
                    </Box>
                  </Box>
                )
              }
              return (
                <Box key={`edit-${role}`} alignItems="center">
                  <Box width={10} flexShrink={0}>
                    <Text>{cap(role)}</Text>
                  </Box>
                  {modelPick}
                  {effortPick}
                  {dots}
                </Box>
              )
            })}
          </Box>
          {Object.keys(cfg.setups).length > 1 ? (
            <Box flexDirection="column">
              {section('Setup')}
              <Box borderStyle="round" borderDimColor paddingX={1}>
                <Select key="setup" options={Object.keys(cfg.setups).map(v => ({ value: v, label: clean(v, NAME_MAX) }))} value={cfg.active} onSelect={v => edit($, c => (Object.hasOwn(c.setups, v) ? { ...c, active: v } : c))} />
              </Box>
            </Box>
          ) : null}
        </Box>
      )
    }

    const modeWord = s.mode === 'main' ? 'Auto' : cap(s.mode)
    const ctx = pl?.ctx

    return (
      <Box flexDirection="column">
        {header}

        {section('Now')}
        <Box flexDirection="column" borderStyle="round" borderColor={accent} borderDimColor={isOff} paddingX={1}>
          <Box justifyContent="space-between" gap={2}>
            <Text color={accent} dimColor={isOff} bold size="title" weight="bold">{MODEL_NAME[s.model] ?? s.model}</Text>
            <Text color={s.mode === 'manual' ? 'warning' : accent} dimColor={s.mode === 'main' || isOff} weight="semibold">{modeWord}</Text>
          </Box>
          <Text wrap="truncate-end">
            <Text color={accent} dimColor={isOff}>{m.on}</Text>
            <Text dimColor>{m.off}</Text>
            <Text dimColor size="footnote">{s.effort ? `  ${effortLabel(s.effort)} effort` : ''}{s.why ? `  ← ${clean(s.why, 40)}` : ''}</Text>
          </Text>
          {s.mode === 'manual' ? (
            <Text color="warning" size="footnote" wrap="truncate-end">
              {startedOn ? `/model ${startedOn} to resume routing` : 'Switch back with /model to resume routing'}
            </Text>
          ) : null}
        </Box>

        {section('Use')}
        <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
          <Box width={20} flexDirection="column">
            <Select
              key="use"
              options={[{ value: 'auto', label: 'Auto' }, ...MODEL_LIST.map(v => ({ value: v, label: MODEL_NAME[v] }))]}
              value={pinned ?? 'auto'}
              onSelect={v => update($, pin, () => (v === 'auto' ? null : v))}
            />
          </Box>
        </Box>

        {ctx != null ? (
          <Box flexDirection="column">
            {section('Context')}
            <Box borderStyle="round" borderDimColor paddingX={1} gap={1} alignItems="center">
              <Text color={ring(ctx).color} size="title">{ring(ctx).glyph}</Text>
              <Text color={ctx >= 60 ? ring(ctx).color : undefined} weight="semibold">{ctx}%</Text>
              <Text dimColor>used</Text>
            </Box>
          </Box>
        ) : null}

        {section('Tasks')}
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          {ROLE_LIST.map(role => {
            const slot = slotOf(role)
            const isNow = !isOff && s.role === role
            const mm = meter(slot.effort)
            return (
              <Box key={`row-${role}`} justifyContent="space-between" gap={1}>
                <Box flexShrink={1} gap={1}>
                  <Box width={1} flexShrink={0}>
                    <Text color={MODEL_COLOR[slot.model]}>{isNow ? '▸' : ' '}</Text>
                  </Box>
                  <Box width={9} flexShrink={0}>
                    <Text bold={isNow}>{cap(role)}</Text>
                  </Box>
                  <Box width={8} flexShrink={0}>
                    <Text color={isOff ? undefined : MODEL_COLOR[slot.model]} dimColor={isOff}>{MODEL_NAME[slot.model] ?? slot.model}</Text>
                  </Box>
                  <Box width={8} flexShrink={0}>
                    <Text>
                      <Text color={isOff ? undefined : MODEL_COLOR[slot.model]} dimColor={isOff}>{mm.on}</Text>
                      <Text dimColor>{mm.off}</Text>
                    </Text>
                  </Box>
                  <Text dimColor wrap="truncate-end">{effortLabel(slot.effort)}</Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
