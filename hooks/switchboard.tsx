import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { classify } from '../src/core/classify.js'
import type { Config, Live, Route } from '../types'
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
  const isManual = sessionModel !== '' && sessionModel !== cfg.mainModel
  await update($, manual, () => (isManual ? sessionModel : null))
  if (!cfg.enabled || isManual || (await read($, paused))) return null
  const setup = cfg.setups[cfg.active]
  const pinned = await read($, pin)
  if (pinned && setup[pinned]) {
    return { role: pinned, ...setup[pinned], why: 'pinned', source: 'pin' } as Route
  }
  const r = classify(text, cfg.rules, setup)
  if (!r) return null
  return { role: r.role, model: r.model, effort: r.effort, why: r.why, source: r.forced ? 'override' : 'auto' } as Route
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'router', description: 'Switchboard settings: models per task, setups, pause (also: /router off|on|auto|<task>)' })
    await update($, route, () => null)
    await reload($).catch(() => {})
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
    if (ROLE_LIST.includes(arg)) {
      await update($, pin, () => arg)
      return { text: `Switchboard: every turn pinned to "${arg}". /router auto to undo.` }
    }
    await reload($).catch(() => {})
    await $.ui.open({ id: PANE, title: 'Switchboard' })
    return { text: 'Switchboard pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
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

  // ---- the band above the prompt ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const cfg = await read($, config)
    if (!cfg) return next(e)
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const r = await read($, route)
    const l = await read($, live)
    const isOff = (await read($, paused)) || !cfg.enabled
    const man = await read($, manual)
    const pinned = await read($, pin)

    const shown = man
      ? { model: man, effort: l?.effort ?? '' }
      : r
        ? { model: r.model, effort: r.effort }
        : l ?? { model: cfg.mainModel, effort: cfg.setups[cfg.active].plan.effort }
    const color = MODEL_COLOR[shown.model] ?? 'gray'
    const m = meter(shown.effort)
    const tag = isOff ? 'off' : man ? 'manual' : r ? r.role : 'main'
    const why = !isOff && !man && r?.why && r.source !== 'pin' ? `← ${r.why}` : ''

    return (
      <Box paddingX={1} justifyContent="space-between" gap={2}>
        <Box gap={1} flexShrink={1}>
          <Text>
            <Text color={color}>{m.on}</Text>
            <Text dimColor>{m.off}</Text>
          </Text>
          <Text color={color} bold>{MODEL_NAME[shown.model] ?? shown.model}</Text>
          {shown.effort ? <Text dimColor>· {shown.effort}</Text> : null}
          <Text color={r && !isOff && !man ? color : undefined} dimColor={!r || isOff || !!man}>
            {' '}{tag}
          </Text>
          {why ? <Text dimColor wrap="truncate">{why}</Text> : null}
        </Box>
        <Box gap={1} flexShrink={0}>
          <Select
            key="pin"
            options={[{ value: 'auto', label: 'Auto' }, ...ROLE_LIST.map(v => ({ value: v }))]}
            value={pinned ?? 'auto'}
            onSelect={v => update($, pin, () => (v === 'auto' ? null : v))}
          />
          <Button key="router" label="Router" onPress={() => $.ui.open({ id: PANE, title: 'Router' })} />
        </Box>
      </Box>
    )
  })

  // ---- the /router pane ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const cfg = await read($, config)
    if (!cfg) return <Text dimColor>Loading…</Text>
    const current = await read($, tab)
    const r = await read($, route)
    const isOff = (await read($, paused)) || !cfg.enabled
    const setup = cfg.setups[cfg.active]

    const header = (
      <Box justifyContent="space-between" marginBottom={1}>
        <Box gap={1}>
          {[['now', 'Now'], ['routes', 'Routes']].map(([id, label]) => (
            <Button key={`tab-${id}`} label={label} variant={current === id ? 'primary' : 'secondary'} onPress={() => update($, tab, () => id)} />
          ))}
        </Box>
        <Button key="power" label={isOff ? 'Off' : 'On'} variant={isOff ? 'secondary' : 'primary'} onPress={() => update($, paused, v => !v)} />
      </Box>
    )

    const row = (role: string) => {
      const s = setup[role]
      const mm = meter(s.effort)
      const isNow = !isOff && r?.role === role
      return (
        <Box key={`row-${role}`} gap={1}>
          <Box width={8}>
            <Text bold={isNow} color={isNow ? MODEL_COLOR[s.model] : undefined} dimColor={!isNow}>{role}</Text>
          </Box>
          <Text>
            <Text color={MODEL_COLOR[s.model]}>{mm.on}</Text>
            <Text dimColor>{mm.off}</Text>
          </Text>
          <Text color={MODEL_COLOR[s.model]} bold={isNow}>{MODEL_NAME[s.model]}</Text>
          <Text dimColor>· {s.effort}</Text>
        </Box>
      )
    }

    if (current === 'routes') {
      const set = (role: string, field: 'model' | 'effort', v: string) =>
        edit($, c => ({ ...c, setups: { ...c.setups, [c.active]: { ...c.setups[c.active], [role]: { ...c.setups[c.active][role], [field]: v } } } }))
      return (
        <Box flexDirection="column">
          {header}
          {ROLE_LIST.map(role => (
            <Box key={`edit-${role}`} gap={1} alignItems="center">
              <Box width={8}>
                <Text>{role}</Text>
              </Box>
              <Select key={`model-${role}`} options={MODEL_LIST.map(v => ({ value: v, label: MODEL_NAME[v] }))} value={setup[role].model} onSelect={v => set(role, 'model', v)} />
              <Select key={`effort-${role}`} options={EFFORT_LIST.map(v => ({ value: v }))} value={setup[role].effort} onSelect={v => set(role, 'effort', v)} />
            </Box>
          ))}
          {Object.keys(cfg.setups).length > 1 ? (
            <Box marginTop={1}>
              <Select key="setup" options={Object.keys(cfg.setups).map(v => ({ value: v }))} value={cfg.active} onSelect={v => edit($, c => ({ ...c, active: v }))} />
            </Box>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}
        {ROLE_LIST.map(row)}
      </Box>
    )
  })
}
