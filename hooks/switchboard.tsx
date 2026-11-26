import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { classify } from '../src/core/classify.js'
import type { Config, Live, Route, Setup } from '../types'
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

const PANE = 'switchboard'

const config = atom({ plugin: 'switchboard', key: 'config' } as const, null, { shape: 'config-1' })
const route = atom({ plugin: 'switchboard', key: 'route' } as const, null, { shape: 'route-1' })
const live = atom({ plugin: 'switchboard', key: 'live' } as const, null, { shape: 'live-1' })
const paused = atom({ plugin: 'switchboard', key: 'paused' } as const, false)
const manual = atom({ plugin: 'switchboard', key: 'manual' } as const, null)
const pin = atom({ plugin: 'switchboard', key: 'pin' } as const, null)
const place = atom({ plugin: 'switchboard', key: 'place' } as const, null)
const base = atom({ plugin: 'switchboard', key: 'base' } as const, null)
const tab = atom({ plugin: 'switchboard', key: 'tab' } as const, 'now')

async function reload($: any) {
  const cfg = await loadConfig($)
  await update($, config, () => cfg)
  return cfg
}

/** Change the config, save it to setups.json and keep the atom in step. */
async function edit($: any, fn: (cfg: Config) => Config) {
  const cfg = fn(structuredClone((await read($, config)) ?? (await loadConfig($))))
  await saveConfig($, cfg)
  await update($, config, () => cfg)
}

/** Decide this turn's route from the prompt, a pin, or nothing (stay on the session's model). */
async function decide($: any, text: string) {
  const cfg = await reload($)
  const sessionModel = family(String(await $.session.model()))
  // Manual only when the model was changed with /model after the session started.
  const started = await read($, base)
  if (!started && sessionModel) await update($, base, () => sessionModel)
  const isManual = sessionModel !== '' && !!started && sessionModel !== started
  await update($, manual, () => (isManual ? sessionModel : null))
  if (!cfg.enabled || isManual || (await read($, paused))) return null
  const setup = cfg.setups[cfg.active]
  const pinned = await read($, pin)
  if (pinned && MODEL_LIST.includes(pinned)) {
    // Pinned to a model: use the effort of the first task that runs on it.
    const role = ROLE_LIST.find(r => setup[r]?.model === pinned) ?? 'code'
    const effort = setup[role]?.model === pinned ? setup[role].effort : 'high'
    return { role, model: pinned, effort, why: '', source: 'pin' } as Route
  }
  const r = classify(text, cfg.rules, setup)
  if (!r) return null
  return { role: r.role, model: r.model, effort: r.effort, why: r.why, source: r.forced ? 'override' : 'auto' } as Route
}

/** Turn routing on or off from the pane. On also clears a saved "enabled: false". */
async function power($: any, turnOn: boolean) {
  await update($, paused, () => !turnOn)
  if (turnOn && (await read($, config))?.enabled === false) await edit($, c => ({ ...c, enabled: true }))
}

/** Set one task's model or effort in the active setup. */
async function setSlot($: any, role: string, field: 'model' | 'effort', value: string) {
  await edit($, c => {
    const setup = c.setups[c.active]
    const slot = setup?.[role]
    if (!setup || !slot) return c
    return { ...c, setups: { ...c.setups, [c.active]: { ...setup, [role]: { ...slot, [field]: value } } } }
  })
}

type Mode = 'auto' | 'pinned' | 'main' | 'manual' | 'off'

/** What the band and the pane both need: what this turn runs on, and in which mode. */
function status(cfg: Config, r: Route | null, l: Live | null, isPaused: boolean, man: string | null) {
  const mode: Mode = isPaused || !cfg.enabled ? 'off' : man ? 'manual' : r ? (r.source === 'pin' ? 'pinned' : 'auto') : 'main'
  const routed = mode === 'auto' || mode === 'pinned'
  const idle = l ?? { model: cfg.mainModel, effort: cfg.setups[cfg.active]?.plan?.effort ?? '' }
  const shown = mode === 'manual' ? { model: man as string, effort: l?.effort ?? '' } : routed && r ? { model: r.model, effort: r.effort } : idle
  return {
    mode,
    model: shown.model,
    effort: shown.effort,
    role: routed && r ? r.role : '',
    why: mode === 'auto' && r?.why ? r.why : '',
  }
}

/** Display form of a task, mode or effort word: Plan, Manual, High. */
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)
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
      <Text color={color} dimColor={off} bold={!off}> {MODEL_NAME[s.model] ?? s.model}</Text>
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

/** Open the pane on one of its tabs. */
async function openPane($: any, which: 'now' | 'routes') {
  await update($, tab, () => which)
  await $.ui.open({ id: PANE, title: 'Switchboard' })
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

/** Project, branch and context percentage for the band. Each part is best effort. */
async function where($: any) {
  const root = String(await $.session.root())
  const project = root.split('/').filter(Boolean).pop() ?? root
  const copy = await $.vcs.detect({ path: root }).catch(() => null)
  const usage = await $.session.usage().catch(() => null)
  const pct = usage?.context?.percent
  const value: Place = { project, branch: copy?.branch ?? null, ctx: typeof pct === 'number' ? pct : null }
  await update($, place, () => value)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'router', description: 'Switchboard settings: models per task, setups, pause (also: /router off|on|auto|<task>)' })
    await update($, route, () => null)
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
      return { text: 'Switchboard paused for this session.' }
    }
    if (arg === 'on' || arg === 'resume') {
      await update($, paused, () => false)
      return { text: 'Switchboard routing on.' }
    }
    if (arg === 'auto') {
      await update($, pin, () => null)
      return { text: 'Switchboard: back to automatic routing.' }
    }
    if (MODEL_LIST.includes(arg)) {
      await update($, pin, () => arg)
      return { text: `Switchboard: every turn uses ${MODEL_NAME[arg]}. /router auto to undo.` }
    }
    await reload($).catch(() => {})
    await $.ui.open({ id: PANE, title: 'Switchboard' })
    return { text: 'Switchboard pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await where($).catch(() => {})
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.agentId) await where($).catch(() => {})
    if (e.agentId || e.command) return next(e)
    const r = await decide($, e.text).catch(() => null)
    await update($, route, () => r)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const r = await read($, route)
    if (!r) {
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
    const s = status(cfg, await read($, route), await read($, live), await read($, paused), await read($, manual))
    const pinned = await read($, pin)
    const cols = e.props.bodyColumns ?? 80
    const pl = await read($, place)

    const row = (
      <Box paddingX={1} justifyContent="space-between" gap={2}>
        <Box gap={2} flexShrink={1} overflow="hidden">
          <Box flexShrink={0}>{routeLine(Text, s, cols >= 48)}</Box>
        </Box>
        <Box gap={1} flexShrink={0}>
          {pl && cols >= 90 ? (
            <Text dimColor wrap="truncate-end">
              {pl.project}
              {pl.branch ? ` ⎇ ${pl.branch}` : ''}
            </Text>
          ) : null}
          {pl?.ctx != null ? (
            <Text>
              <Text color={ring(pl.ctx).color}>{ring(pl.ctx).glyph}</Text>
              <Text dimColor={pl.ctx < 60} color={pl.ctx >= 60 ? ring(pl.ctx).color : undefined}> {pl.ctx}%</Text>
            </Text>
          ) : null}
          <Button key="pin" label={pinned ? `${MODEL_NAME[pinned] ?? cap(pinned)} ▾` : 'Auto ▾'} variant="secondary" onPress={() => openPane($, 'now')} />
          <Button key="settings" label="⚙️" variant="secondary" onPress={() => openPane($, 'routes')} />
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
    const s = status(cfg, await read($, route), await read($, live), await read($, paused), await read($, manual))
    const pinned = await read($, pin)
    const pl = await read($, place)
    const isOff = s.mode === 'off'
    const setup: Setup = cfg.setups[cfg.active] ?? {}
    const slotOf = (role: string) => setup[role] ?? { model: cfg.mainModel, effort: '' }
    const startedOn = await read($, base)
    const cols = e.props.bodyColumns ?? 60

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
          {section(`Models · ${cfg.active}`)}
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {ROLE_LIST.map(role => {
              const slot = slotOf(role)
              return (
                <Box key={`edit-${role}`} alignItems="center">
                  <Box width={10} flexShrink={0}>
                    <Text>{cap(role)}</Text>
                  </Box>
                  <Box width={14} flexShrink={0} flexDirection="column" marginRight={1}>
                    <Select key={`model-${role}`} options={MODEL_LIST.map(v => ({ value: v, label: padLabel(MODEL_NAME[v], MODEL_LIST.map(x => MODEL_NAME[x]), e.surface) }))} value={slot.model} onSelect={v => setSlot($, role, 'model', v)} />
                  </Box>
                  <Box width={14} flexShrink={0} flexDirection="column" marginRight={1}>
                    <Select key={`effort-${role}`} options={EFFORT_LIST.map(v => ({ value: v, label: padLabel(effortLabel(v), EFFORT_LIST.map(effortLabel), e.surface) }))} value={slot.effort} onSelect={v => setSlot($, role, 'effort', v)} />
                  </Box>
                  <Text color={MODEL_COLOR[slot.model]}>{meter(slot.effort).on}</Text>
                  <Text dimColor>{meter(slot.effort).off}</Text>
                </Box>
              )
            })}
          </Box>
          {Object.keys(cfg.setups).length > 1 ? (
            <Box flexDirection="column">
              {section('Setup')}
              <Box borderStyle="round" borderDimColor paddingX={1}>
                <Select key="setup" options={Object.keys(cfg.setups).map(v => ({ value: v }))} value={cfg.active} onSelect={v => edit($, c => ({ ...c, active: v }))} />
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
            <Text dimColor size="footnote">{s.effort ? `  ${effortLabel(s.effort)} effort` : ''}{s.why ? `  ← ${s.why}` : ''}</Text>
          </Text>
          {s.mode === 'manual' ? (
            <Text color="warning" size="footnote" wrap="truncate-end">/model {startedOn ?? cfg.mainModel} to resume routing</Text>
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
