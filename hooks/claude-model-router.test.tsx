import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'model-router',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 } },
} as const

const PANE = {
  plugin: 'model-router',
  component: 'Pane',
  requestId: 'claude-model-router',
  props: { title: 'Claude Model Router', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop'] as const
const DIR = '/home/test/.claude/claude-model-router'
const SETUPS = `${DIR}/setups.json`

/**
 * Stand in for the engine: an in-memory disk (empty unless `files` says otherwise), the
 * session's model, and the bottom of turn.step that records what each request went out with.
 */
function engine(on: any, opts: { model?: string; files?: Record<string, string>; env?: Record<string, string> } = {}) {
  const current = { model: opts.model ?? 'claude-fable-5' }
  const files: Record<string, string> = { ...(opts.files ?? {}) }
  const sent: { model: string; effort: unknown; agentId?: string }[] = []
  mock.env(on, opts.env ?? { HOME: '/home/test' })
  on('fs.read', (_: any, e: any) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] }
  })
  on('fs.write', (_: any, e: any) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'router' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: current.model }))
  on('prompt.submit', (_: any, e: any) => e)
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('turn.step', async function* (_: any, e: any) {
    sent.push({ model: e.model, effort: e.effort, agentId: e.agentId })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { current, files, sent }
}

/** The band's route line, as one string. */
async function route(ui: any) {
  return (await ui.find({ type: 'Text', text: /●|○/ }))?.text
}

/** One request of a turn, read to its end; the engine's bottom records what it went out with. */
async function step($: any, turnId: string, extra: Record<string, unknown> = {}) {
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-fable-5', effort: 'xhigh', messageCount: 1, ...extra })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

/** A whole main-loop turn: submit, start, one step, complete. */
async function turn($: any, text: string, turnId: string, submit: Record<string, unknown> = {}) {
  await $.prompt.submit({ text, ...submit })
  await $.turn.start({ text, turnId })
  await step($, turnId)
  await $.turn.complete({ turnId, reason: 'answer', answer: '', durationMs: 1, isAborted: false })
}

test('the band and the pane draw every state on terminal and desktop', async ($: any, on: any) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of SURFACES) {
    // before any prompt: the model the session started on, no effort yet
    let band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toBe('○○○○○ Fable')
    expect(await band.find({ key: 'pin' })).toBeDefined()
    expect(await band.find({ key: 'settings' })).toBeDefined()
    await band.unmount()

    // a routed prompt: only the model and effort show, never the task
    await $.prompt.submit({ text: 'debug the crash in the parser' })
    band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toBe('●●●○○ Opus · High')
    expect(await band.find({ type: 'Text', text: /Hard|Plan|Chores|Main/ })).toBeUndefined()
    await band.unmount()

    // a narrow band drops the effort word and keeps the dropdown
    band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 40 }, surface })
    expect(await route(band)).toBe('●●●○○ Opus')
    expect(await band.find({ key: 'pin' })).toBeDefined()
    await band.unmount()

    // Auto opens the pane, where "Use" pins a model
    band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ key: 'pin' }))?.text).toBe('Auto ▾')
    await band.press({ key: 'pin' })
    let pane = await $.ui.mount({ ...PANE, surface })
    await pane.select({ key: 'use', value: 'haiku' })
    await $.prompt.submit({ text: 'debug the crash in the parser' })
    expect(await route(band)).toBe('●○○○○ Haiku · Low  Pinned')
    expect((await band.find({ key: 'pin' }))?.text).toBe('Haiku ▾')
    await pane.select({ key: 'use', value: 'auto' })
    await $.prompt.submit({ text: 'debug the crash in the parser' })
    expect(await route(band)).toBe('●●●○○ Opus · High')
    await band.unmount()
    await pane.unmount()

    // the pane: Models tab has a model and an effort control per task, narrow dock included
    pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: '▸' })).toBeDefined()
    await pane.press({ key: 'tab-routes' })
    for (const role of ['plan', 'review', 'hard', 'code', 'write', 'chores']) {
      expect(await pane.find({ key: `model-${role}` })).toBeDefined()
      expect(await pane.find({ key: `effort-${role}` })).toBeDefined()
    }
    await pane.press({ key: 'tab-now' })

    // off and back on
    await pane.press({ key: 'power' })
    expect((await pane.find({ key: 'power' }))?.text).toBe('Off')
    band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toMatch(/ {2}Off$/)
    await band.unmount()
    await pane.press({ key: 'power' })
    expect((await pane.find({ key: 'power' }))?.text).toBe('On')
    await pane.unmount()

    // minimized pane: the route alone
    const widget = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })
    expect(await widget.find({ key: 'power' })).toBeUndefined()
    await widget.unmount()

    await $.prompt.submit({ text: 'hello' })
  }
})

test('before the first turn, a session started on Opus shows Opus with no effort', async ($: any, on: any) => {
  engine(on, { model: 'claude-opus-5' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toBe('○○○○○ Opus')
    await band.unmount()
  }
})

test('a session that starts on Opus routes normally', async ($: any, on: any) => {
  engine(on, { model: 'claude-opus-5' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename foo to bar' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toBe('●○○○○ Haiku · Low')
  await band.unmount()
})

test('a /model switch shows as Manual', async ($: any, on: any) => {
  const { current } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  current.model = 'claude-opus-5' // the person runs /model opus mid-session
  await $.prompt.submit({ text: 'debug the crash in the parser' })

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toMatch(/Opus.* {2}Manual$/)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: 'Manual' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\/model fable to resume/ })).toBeDefined()
    await pane.unmount()
  }
})

test('turn.step sends the routed model and effort, and leaves a subagent step alone', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename foo to bar' })
  await $.turn.start({ text: 'rename foo to bar', turnId: 't1' })
  await step($, 't1')
  await step($, 't1', { agentId: 'a1', model: 'claude-sonnet-5', effort: 'medium' })
  expect(sent[0]).toEqual({ model: 'haiku', effort: 'low', agentId: undefined })
  expect(sent[1]).toEqual({ model: 'claude-sonnet-5', effort: 'medium', agentId: 'a1' })
})

test('the route ends with its turn: a slash command after a routed prompt runs unrouted', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'rename foo to bar', 't1')
  expect(sent[0]?.model).toBe('haiku')

  // a step after the turn completed (a compaction, a continuation) is not routed either
  await step($, 't1b')
  expect(sent[1]?.model).toBe('claude-fable-5')

  await turn($, '/code-review', 't2', { command: { name: 'code-review', args: '' } })
  expect(sent[2]).toEqual({ model: 'claude-fable-5', effort: 'xhigh', agentId: undefined })
})

test('a pin applies to a slash command too', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'router', args: 'opus' })
  await turn($, '/code-review', 't1', { command: { name: 'code-review', args: '' } })
  expect(sent[0]).toEqual({ model: 'opus', effort: 'high', agentId: undefined })
})

test('a prompt typed mid-turn does not re-route the running turn', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename foo to bar' })
  await $.turn.start({ text: 'rename foo to bar', turnId: 't1' })
  await step($, 't1')
  await $.prompt.submit({ text: 'debug the crash in the parser', turnId: 't1', wait: true, origin: { kind: 'composer' } })
  await step($, 't1')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  expect(sent.map(s => s.model)).toEqual(['haiku', 'haiku'])

  // the queued prompt starts its own turn later and gets its own route
  await $.turn.start({ text: 'debug the crash in the parser', turnId: 't2' })
  await step($, 't2')
  expect(sent[2]).toEqual({ model: 'opus', effort: 'high', agentId: undefined })
})

test('notifications, schedules and meta prompts are not classified', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't0')
  await turn($, 'rename foo to bar', 't1', { origin: { kind: 'task-notification' } })
  await turn($, 'rename foo to bar', 't2', { origin: { kind: 'scheduled-trigger' } })
  await turn($, 'rename foo to bar', 't3', { isMeta: true, origin: { kind: 'composer' } })
  expect(sent.map(s => s.model)).toEqual(['opus', 'claude-fable-5', 'claude-fable-5', 'claude-fable-5'])
  // the band keeps showing the person's own last route
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toBe('●●●○○ Opus · High')
  await band.unmount()
  await turn($, 'rename foo to bar', 't4', { origin: { kind: 'composer' } })
  expect(sent[4]?.model).toBe('haiku')
})

test('/router off, on, auto, a model pin, and an unknown argument', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'router', args: 'off' })).text).toMatch(/paused/)
  await turn($, 'rename foo to bar', 't1')
  expect(sent[0]?.model).toBe('claude-fable-5')
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toMatch(/ {2}Off$/)
  await band.unmount()

  expect((await $.command.run({ command: 'router', args: 'on' })).text).toMatch(/on/)
  await turn($, 'rename foo to bar', 't2')
  expect(sent[1]?.model).toBe('haiku')

  expect((await $.command.run({ command: 'router', args: 'opus' })).text).toMatch(/Opus/)
  await turn($, 'rename foo to bar', 't3')
  expect(sent[2]).toEqual({ model: 'opus', effort: 'high', agentId: undefined })
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toBe('●●●○○ Opus · High  Pinned')
  expect((await band.find({ key: 'pin' }))?.text).toBe('Opus ▾')
  await band.unmount()

  expect((await $.command.run({ command: 'router', args: 'auto' })).text).toMatch(/automatic/)
  await turn($, 'rename foo to bar', 't4')
  expect(sent[3]?.model).toBe('haiku')

  // a role is not a pin: the argument is refused and nothing changes
  const hard = await $.command.run({ command: 'router', args: 'hard' })
  expect(hard.text).toMatch(/unknown option "hard"/)
  await turn($, 'rename foo to bar', 't5')
  expect(sent[4]?.model).toBe('haiku')
})

test('a pane edit keeps a setup the CLI saved after the session loaded the file', async ($: any, on: any) => {
  const { files } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })

  // the CLI runs `save fast` in another terminal
  const fast = { plan: { model: 'opus', effort: 'high' } }
  files[SETUPS] = JSON.stringify({ active: 'default', enabled: true, custom: 'kept', main_model: 'fable', setups: { default: {}, fast } })

  await pane.select({ key: 'model-code', value: 'opus' })
  const saved = JSON.parse(files[SETUPS] ?? '{}')
  expect(saved.setups.default.code).toEqual({ model: 'opus', effort: 'medium' })
  expect(saved.setups.fast.plan).toEqual({ model: 'opus', effort: 'high' })
  expect(saved.custom).toBe('kept')
  expect(saved.main_model).toBeUndefined()
  expect(saved.active).toBe('default')

  // round trip: a fresh session reads back what the pane wrote
  await pane.select({ key: 'effort-code', value: 'max' })
  expect(JSON.parse(files[SETUPS] ?? '{}').setups.default.code).toEqual({ model: 'opus', effort: 'max' })
  await pane.unmount()
})

test('switching setups from the pane', async ($: any, on: any) => {
  const fast = { code: { model: 'haiku', effort: 'low' } }
  const { files, sent } = engine(on, { files: { [SETUPS]: JSON.stringify({ active: 'default', setups: { default: {}, fast } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'setup', value: 'fast' })
  expect(JSON.parse(files[SETUPS] ?? '{}').active).toBe('fast')
  await pane.unmount()
  await turn($, 'implement the trips endpoint', 't1')
  expect(sent[0]).toEqual({ model: 'haiku', effort: 'low', agentId: undefined })
})

test('a corrupt setups.json: defaults are used, and the first save backs it up', async ($: any, on: any) => {
  const { files, sent } = engine(on, { files: { [SETUPS]: '{not json' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'rename foo to bar', 't1')
  expect(sent[0]).toEqual({ model: 'haiku', effort: 'low', agentId: undefined })
  expect(files[`${SETUPS}.bak`]).toBeUndefined()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-chores', value: 'sonnet' })
  await pane.unmount()
  expect(files[`${SETUPS}.bak`]).toBe('{not json')
  expect(JSON.parse(files[SETUPS] ?? '{}').setups.default.chores).toEqual({ model: 'sonnet', effort: 'low' })
})

test('a partial setups.json is filled with defaults', async ($: any, on: any) => {
  const partial = { active: 'mine', setups: { mine: { chores: { model: 'sonnet' }, hard: { model: 'gpt', effort: 'huge' } } } }
  const { sent } = engine(on, { files: { [SETUPS]: JSON.stringify(partial) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'rename foo to bar', 't1')
  await turn($, 'debug the crash in the parser', 't2')
  expect(sent[0]).toEqual({ model: 'sonnet', effort: 'low', agentId: undefined })
  expect(sent[1]).toEqual({ model: 'opus', effort: 'high', agentId: undefined })
})

test('enabled: false in setups.json turns routing off until the pane turns it on', async ($: any, on: any) => {
  const { files, sent } = engine(on, { files: { [SETUPS]: JSON.stringify({ active: 'default', enabled: false, setups: { default: {} } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'rename foo to bar', 't1')
  expect(sent[0]?.model).toBe('claude-fable-5')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'power' }))?.text).toBe('Off')
  await pane.press({ key: 'power' })
  expect((await pane.find({ key: 'power' }))?.text).toBe('On')
  await pane.unmount()
  expect(JSON.parse(files[SETUPS] ?? '{}').enabled).toBe(true)
  await turn($, 'rename foo to bar', 't2')
  expect(sent[1]?.model).toBe('haiku')
})

test('rules.json replaces the rules of the roles it names', async ($: any, on: any) => {
  const { sent } = engine(on, { files: { [`${DIR}/rules.json`]: JSON.stringify({ write: ['\\bzebra\\b'] }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'tell me about the zebra', 't1')
  await turn($, 'rename foo to bar', 't2')
  expect(sent.map(s => s.model)).toEqual(['sonnet', 'haiku'])
})

test('with no HOME or USERPROFILE nothing is written, and routing still works', async ($: any, on: any) => {
  const { files, sent } = engine(on, { env: {} })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-code', value: 'opus' })
  await pane.unmount()
  expect(Object.keys(files)).toEqual([])
  await turn($, 'rename foo to bar', 't1')
  expect(sent[0]?.model).toBe('haiku')
})

test('USERPROFILE is used when HOME is unset', async ($: any, on: any) => {
  const { files } = engine(on, { env: { USERPROFILE: '/Users/win' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-code', value: 'opus' })
  await pane.unmount()
  expect(Object.keys(files)).toEqual(['/Users/win/.claude/claude-model-router/setups.json'])
})

test('a long branch is cut to fit the band, and hidden when the band is narrow', async ($: any, on: any) => {
  engine(on)
  const branch = `feature/${'very-long-branch-name-'.repeat(6)}end`
  on('session.cwd', () => ({ value: '/work/my-repo' }))
  on('vcs.detect', () => ({ vcs: 'git', root: '/work/my-repo', mainRoot: '/work/my-repo', revision: 'abc', branch, defaultBranch: 'main', remote: null }))
  await $.session.start({ cwd: '/work/my-repo', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    for (const cols of [80, 100, 160]) {
      const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: cols }, surface })
      const text = (await band.find({ type: 'Text', text: /my-repo/ }))?.text ?? ''
      expect(text).toMatch(/^my-repo \| feature/)
      expect(text.length).toBeLessThanOrEqual(cols - 62)
      expect(text.endsWith('…')).toBe(true)
      await band.unmount()
    }
    const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 70 }, surface })
    expect(await narrow.find({ type: 'Text', text: /my-repo/ })).toBeUndefined()
    expect(await narrow.find({ key: 'pin' })).toBeDefined()
    await narrow.unmount()
  }
})
