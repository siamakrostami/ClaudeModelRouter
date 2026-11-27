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
type Rows = 'throw' | 'missing' | readonly string[]
function engine(
  on: any,
  opts: { model?: string; files?: Record<string, string>; env?: Record<string, string>; drop?: (text: string) => boolean; options?: Rows; tokens?: number; answered?: string } = {},
) {
  const current: { model: string; options?: Rows; tokens?: number } = { model: opts.model ?? 'claude-fable-5', options: opts.options, tokens: opts.tokens }
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
  // the /config rows: only the "model" row matters here; its options are what /model offers
  on('config.list', () => {
    if (current.options === 'throw') throw new Error('config unavailable')
    const theme = { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], provider: { kind: 'engine' }, isLocked: false }
    if (current.options === undefined || current.options === 'missing') return { value: [theme] }
    return { value: [theme, { key: 'model', label: 'Model', kind: 'choice', value: 'default', options: current.options, provider: { kind: 'engine' }, isLocked: false }] }
  })
  // the band's place needs a folder before it reads the context; only tests about tokens give one
  if (opts.tokens !== undefined) on('session.cwd', () => ({ value: '/work/my-repo' }))
  on('session.usage', () => {
    if (current.tokens === undefined) throw new Error('no usage yet')
    return { value: { context: { tokens: current.tokens, window: 200000, percent: Math.round((current.tokens / 200000) * 100) } } }
  })
  on('prompt.submit', (_: any, e: any) => (opts.drop?.(e.text) ? { drop: 'blocked beneath' } : e))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('turn.step', async function* (_: any, e: any) {
    sent.push({ model: e.model, effort: e.effort, agentId: e.agentId })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: opts.answered ? { model: opts.answered } : null }
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

    // back to no route for the next surface (0.4.0: a plain "hello" now routes to general)
    await $.prompt.submit({ text: '#self hello' })
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
  expect(Object.keys(files).filter(f => f.includes('.bak'))).toEqual([])

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-chores', value: 'sonnet' })
  await pane.unmount()
  const baks = Object.keys(files).filter(f => /\/setups\.json\.bak-\d+$/.test(f))
  expect(baks).toHaveLength(1)
  expect(files[baks[0] as string]).toBe('{not json')
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
  const { sent } = engine(on, { files: { [`${DIR}/rules.json`]: JSON.stringify({ write: ['zebra'] }) } })
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

/** Save one pane edit and report which setups.json the mod wrote. */
async function writtenWith($: any, on: any, env: Record<string, string>, files: Record<string, string> = {}) {
  const disk = engine(on, { env, files })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-code', value: 'opus' })
  await pane.unmount()
  return disk
}

const OWN = '/home/test/.claude/claude-model-router/setups.json'

// The mod never reads CLAUDE_MODEL_ROUTER_HOME: a project's .claude/settings.json can set the
// session's env, so the data folder is always <HOME or USERPROFILE>/.claude/claude-model-router.
const OVERRIDES = ['repo/.cmr', '/home/test/../../tmp/cmr', '/tmp/cmr', '/home/testevil/cmr', '/home/test/custom', '/home/test/custom/']
for (const custom of OVERRIDES) {
  test(`M1: the mod ignores CLAUDE_MODEL_ROUTER_HOME=${custom}`, async ($: any, on: any) => {
    const theirs = { [`${custom.replace(/\/$/, '')}/rules.json`]: JSON.stringify({ chores: ['zebra'] }) }
    const { files, sent } = await writtenWith($, on, { HOME: '/home/test', CLAUDE_MODEL_ROUTER_HOME: custom }, theirs)
    expect(Object.keys(files).filter(f => f.endsWith('setups.json'))).toEqual([OWN])
    await turn($, 'tell me about the zebra', 't1')
    // the other folder's rules.json was not read: it would make this chores (Haiku); 0.4.0 sends a
    // prompt that matches nothing to general (Sonnet) where 0.3 left it on the session model
    expect(sent[0]?.model).toBe('sonnet')
  })
}

test('M1: the default folder under HOME is used', async ($: any, on: any) => {
  const { files } = await writtenWith($, on, { HOME: '/home/test' })
  expect(Object.keys(files)).toEqual([OWN])
})

test('M1: a Windows USERPROFILE is used, an override beside it is not', async ($: any, on: any) => {
  const { files } = await writtenWith($, on, { USERPROFILE: 'C:\\Users\\win', CLAUDE_MODEL_ROUTER_HOME: 'C:\\Users\\win\\cmr' })
  // the test kit runs on POSIX and resolves a drive path against its cwd, so match the end
  expect(Object.keys(files)).toHaveLength(1)
  expect(Object.keys(files)[0]).toEndWith('C:\\Users\\win/.claude/claude-model-router/setups.json')
})

test('M1: with no home folder nothing is written, even with an override', async ($: any, on: any) => {
  const { files } = await writtenWith($, on, { CLAUDE_MODEL_ROUTER_HOME: '/tmp/cmr' })
  expect(Object.keys(files)).toEqual([])
})

test('M1: a relative HOME writes nothing, and routing still works', async ($: any, on: any) => {
  const { files, sent } = await writtenWith($, on, { HOME: 'repo' })
  expect(Object.keys(files)).toEqual([])
  await turn($, 'rename foo to bar', 't1')
  expect(sent[0]?.model).toBe('haiku')
})

test('M1: a relative HOME falls back to an absolute USERPROFILE', async ($: any, on: any) => {
  const { files } = await writtenWith($, on, { HOME: 'repo', USERPROFILE: '/Users/win' })
  expect(Object.keys(files)).toEqual(['/Users/win/.claude/claude-model-router/setups.json'])
})

// ---- L2: the mod's backup never follows a symlink ----

test('L2: a symlink at the backup name is not written through', async ($: any, on: any) => {
  const { files } = engine(on, { files: { [SETUPS]: '{not json' } })
  on('fs.stat', (_: any, e: any) => {
    if (/\.bak-\d+$/.test(e.path)) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: true } }
    throw new Error('ENOENT')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-chores', value: 'sonnet' })
  await pane.unmount()
  expect(Object.keys(files).filter(f => f.includes('.bak'))).toEqual([])
  expect(JSON.parse(files[SETUPS] ?? '{}').setups.default.chores).toEqual({ model: 'sonnet', effort: 'low' })
})

// ---- L3: setup names are own keys only ----

test('L3: an active name that is a prototype key falls back to the first setup', async ($: any, on: any) => {
  const fast = { code: { model: 'haiku', effort: 'low' } }
  const { sent } = engine(on, { files: { [SETUPS]: JSON.stringify({ active: 'toString', setups: { fast, default: {} } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  expect(await pane.find({ type: 'Text', text: /MODELS · FAST/ })).toBeDefined()
  await pane.select({ key: 'model-plan', value: 'opus' }) // the dropdowns work again
  await pane.unmount()
  await turn($, 'implement the trips endpoint', 't1')
  expect(sent[0]).toEqual({ model: 'haiku', effort: 'low', agentId: undefined })
})

test('L3: __proto__, constructor and bad names in setups.json are not offered', async ($: any, on: any) => {
  const text = '{"active":"default","setups":{"__proto__":{},"constructor":{},"bad name":{},"default":{},"fast":{}}}'
  const { files } = engine(on, { files: { [SETUPS]: text } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  const select = await pane.find({ key: 'setup' })
  expect((select?.props.options as any[]).map(o => o.value)).toEqual(['default', 'fast'])
  await pane.select({ key: 'setup', value: 'fast' })
  expect(JSON.parse(files[SETUPS] ?? '{}').active).toBe('fast')
  await pane.unmount()
})

// ---- L4: text from a folder, a branch or a prompt is drawn without control bytes ----

const CONTROL = /[\x00-\x1f\x7f]/

test('L4: a folder name with escape sequences is drawn clean', async ($: any, on: any) => {
  engine(on)
  on('session.cwd', () => ({ value: '/work/my-\x1b[31mrepo' }))
  await $.session.start({ cwd: '/work/r', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 160 }, surface })
    const text = (await band.find({ type: 'Text', text: /repo/ }))?.text ?? ''
    expect(text).toMatch(/^my- ?\[31mrepo$/)
    expect(text).not.toMatch(CONTROL)
    await band.unmount()
  }
})

test('L4: a branch name with escape sequences is drawn clean', async ($: any, on: any) => {
  engine(on)
  on('session.cwd', () => ({ value: '/work/my-repo' }))
  on('vcs.detect', () => ({ vcs: 'git', root: '/work/my-repo', mainRoot: '/work/my-repo', revision: 'abc', branch: 'fe\x1b]0;pwned\x07at', defaultBranch: 'main', remote: null }))
  await $.session.start({ cwd: '/work/r', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 160 }, surface })
    const text = (await band.find({ type: 'Text', text: /repo/ }))?.text ?? ''
    expect(text).toMatch(/^my-repo \| fe ?\]0;pwned ?at$/)
    expect(text).not.toMatch(CONTROL)
    await band.unmount()
  }
})

test('L4: the why in the pane carries no control bytes from the prompt', async ($: any, on: any) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'why does \x1b]0;evil\x07 the upload fail' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const why = (await pane.find({ type: 'Text', text: /←/ }))?.text ?? ''
  expect(why).toMatch(/← why does/)
  expect(why).not.toMatch(CONTROL)
  await pane.unmount()
})

// ---- L5: a queued prompt is kept as a fingerprint, never as text ----

test('L5: plugin state holds a hash of a queued prompt, not its text', async ($: any, on: any) => {
  const { sent } = engine(on)
  const writes: any[] = []
  on('state.set', ($s: any, e: any, next: any) => {
    if (e.plugin === 'model-router' && e.key === 'queued') writes.push(e.value)
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename foo to bar' })
  await $.turn.start({ text: 'rename foo to bar', turnId: 't1' })
  const secret = 'debug the crash, token sk-live-12345'
  await $.prompt.submit({ text: secret, turnId: 't1', wait: true, origin: { kind: 'composer' } })
  const q = JSON.stringify(writes.filter(Boolean))
  expect(q).toContain('"route"')
  expect(q).not.toContain('sk-live')
  expect(q).toMatch(/"hash":"[0-9a-f]{8}:\d+"/)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  // a different later turn does not take it; the matching one does
  await $.turn.start({ text: 'something else', turnId: 't2' })
  await step($, 't2')
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await $.turn.start({ text: `  ${secret}\n`, turnId: 't3' })
  await step($, 't3')
  expect(sent.map(s => s.model)).toEqual(['claude-fable-5', 'opus'])
})

// ---- I4: a route decided at a submit that starts no turn is not bound to a later turn ----

test('I4: a dropped submit leaves no route for the next turn', async ($: any, on: any) => {
  const { sent } = engine(on, { drop: t => t.startsWith('debug') })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'debug the crash in the parser' })
  await $.turn.start({ text: '', turnId: 't1' }) // a continuation, no submit of its own
  await step($, 't1')
  expect(sent[0]?.model).toBe('claude-fable-5')
})

test('I4: a pending route does not outlive a turn.complete', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'debug the crash in the parser' }) // starts no turn
  await $.turn.complete({ turnId: 't0', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await $.turn.start({ text: '', turnId: 't1' })
  await step($, 't1')
  expect(sent[0]?.model).toBe('claude-fable-5')
})

test('I4: a new submit replaces the pending route', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'debug the crash in the parser' })
  await $.prompt.submit({ text: 'rename foo to bar' })
  await $.turn.start({ text: 'rename foo to bar', turnId: 't1' })
  await step($, 't1')
  expect(sent[0]?.model).toBe('haiku')
})

// ---- 0.4.0 (1): models the account cannot use fall back ----

const ALL = ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']
const NO_FABLE = ALL.filter(o => !o.includes('fable'))

async function optionsOf(pane: any, key: string) {
  return ((await pane.find({ key }))?.props.options as any[]).map(o => o.value)
}

test('an account without Fable: plan runs on Opus, and the pane says so in one line', async ($: any, on: any) => {
  const { sent } = engine(on, { options: NO_FABLE })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'Plan the migration to the new API', 't1')
  expect(sent[0]).toEqual({ model: 'opus', effort: 'xhigh', agentId: undefined })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toBe('●●●●○ Opus · X-High')
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await optionsOf(pane, 'use')).toEqual(['auto', 'opus', 'sonnet', 'haiku'])
    await pane.press({ key: 'tab-routes' })
    // the selected Fable stays in its own dropdown so nothing changes silently; others drop it
    expect(await optionsOf(pane, 'model-plan')).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    expect(await optionsOf(pane, 'model-code')).toEqual(['opus', 'sonnet', 'haiku'])
    expect((await pane.find({ type: 'Text', text: /available/ }))?.text).toBe("Fable isn't available on this account, so Opus is used instead.")
    await pane.press({ key: 'tab-now' })
    await pane.unmount()
  }
})

test('an account with Fable: Fable plans, every model is offered, no extra line', async ($: any, on: any) => {
  const { sent } = engine(on, { options: ALL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'Plan the migration to the new API', 't1')
  expect(sent[0]).toEqual({ model: 'fable', effort: 'xhigh', agentId: undefined })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await optionsOf(pane, 'use')).toEqual(['auto', 'fable', 'opus', 'sonnet', 'haiku'])
  await pane.press({ key: 'tab-routes' })
  expect(await optionsOf(pane, 'model-code')).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
  expect(await pane.find({ type: 'Text', text: /available/ })).toBeUndefined()
  await pane.unmount()
})

for (const options of ['missing', 'throw', ['default', 'best']] as const) {
  test(`model row ${Array.isArray(options) ? 'naming no family' : options}: every model counts as available`, async ($: any, on: any) => {
    const { sent } = engine(on, { options: options as Rows })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await turn($, 'Plan the migration to the new API', 't1')
    expect(sent[0]?.model).toBe('fable')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'tab-routes' })
    expect(await pane.find({ type: 'Text', text: /available/ })).toBeUndefined()
    await pane.unmount()
  })
}

test('a pin, #plan and @fable on an account without Fable all go to Opus', async ($: any, on: any) => {
  const { sent } = engine(on, { options: NO_FABLE })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, '#plan tidy this', 't1')
  await turn($, '@fable tidy this', 't2')
  expect((await $.command.run({ command: 'router', args: 'fable' })).text).toMatch(/Opus/)
  await turn($, 'rename foo to bar', 't3')
  expect(sent.map(s => s.model)).toEqual(['opus', 'opus', 'opus'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toMatch(/^●+○* Opus · \S+ {2}Pinned$/)
  expect((await band.find({ key: 'pin' }))?.text).toBe('Opus ▾')
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // the pinned Fable stays listed so the picker shows what was chosen
  expect(await optionsOf(pane, 'use')).toEqual(['auto', 'fable', 'opus', 'sonnet', 'haiku'])
  await pane.unmount()
})

test('availability is read again when a turn completes', async ($: any, on: any) => {
  const { sent, current } = engine(on, { options: ALL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'Plan the migration to the new API', 't1')
  current.options = NO_FABLE
  await turn($, 'rename foo to bar', 't2')
  await turn($, 'Plan the migration to the new API', 't3')
  expect(sent.map(s => s.model)).toEqual(['fable', 'haiku', 'opus'])
})

// ---- 0.4.0 (2, 3): general, staying in flow, continuations ----

test('a first prompt that matches nothing runs on general (Sonnet medium), not the session model', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'tell me about the zebra', 't1')
  expect(sent[0]).toEqual({ model: 'sonnet', effort: 'medium', agentId: undefined })
})

test('the previous route steers continuations and unmatched prompts', async ($: any, on: any) => {
  const { sent } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'Plan the migration to the new API', 't1')
  await turn($, 'yes go ahead', 't2') // approval after a plan: implement it
  await turn($, 'debug the crash in the parser', 't3')
  await turn($, 'fix this', 't4') // still debugging: stays on Opus
  await turn($, 'tell me about the zebra', 't5') // in flow after hard
  await turn($, 'yes, now write the PR description', 't6')
  expect(sent.map(s => `${s.model}/${s.effort}`)).toEqual(['fable/xhigh', 'sonnet/medium', 'opus/high', 'opus/high', 'opus/high', 'sonnet/medium'])
})

test('the pane lists General in the Tasks and the Models tab', async ($: any, on: any) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'tell me about the zebra' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'row-general' })).toBeDefined()
  await pane.press({ key: 'tab-routes' })
  expect(await pane.find({ key: 'model-general' })).toBeDefined()
  expect(await pane.find({ key: 'effort-general' })).toBeDefined()
  await pane.unmount()
})

// ---- 0.4.0 (4): in a long conversation an automatic route keeps the warm model ----

test('below sticky_tokens the model switches, with no Holding', async ($: any, on: any) => {
  const { sent } = engine(on, { tokens: 59999 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't1')
  await turn($, 'rename foo to bar', 't2')
  expect(sent.map(s => s.model)).toEqual(['opus', 'haiku'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toBe('●○○○○ Haiku · Low')
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /cache warm/ })).toBeUndefined()
  await pane.unmount()
})

test('at sticky_tokens an automatic route holds the previous model with the chosen effort', async ($: any, on: any) => {
  const { sent } = engine(on, { tokens: 120000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't1') // the first turn never holds
  await turn($, 'rename foo to bar', 't2')
  expect(sent.map(s => `${s.model}/${s.effort}`)).toEqual(['opus/high', 'opus/low'])
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toBe('●○○○○ Opus · Low  Holding')
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: /cache warm/ }))?.text).toBe('Staying on Opus to keep its cache warm (conversation is 120k tokens).')
    await pane.unmount()
  }
})

test('a pin, a #tag, @model and a plain-language override still switch in a long conversation', async ($: any, on: any) => {
  const { sent } = engine(on, { tokens: 150000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't1')
  await turn($, '#chores tidy this', 't2')
  await turn($, '@sonnet tidy this', 't3')
  await turn($, 'use haiku for this: tidy', 't4')
  await $.command.run({ command: 'router', args: 'fable' })
  await turn($, 'rename foo to bar', 't5')
  expect(sent.map(s => s.model)).toEqual(['opus', 'haiku', 'sonnet', 'haiku', 'fable'])
})

test('sticky_tokens 0 turns holding off, and the pane keeps it when it saves', async ($: any, on: any) => {
  const { sent, files } = engine(on, { tokens: 150000, files: { [SETUPS]: JSON.stringify({ active: 'default', sticky_tokens: 0, setups: { default: {} } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't1')
  await turn($, 'rename foo to bar', 't2')
  expect(sent.map(s => s.model)).toEqual(['opus', 'haiku'])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-routes' })
  await pane.select({ key: 'model-code', value: 'opus' })
  await pane.unmount()
  expect(JSON.parse(files[SETUPS] ?? '{}').sticky_tokens).toBe(0)
})

test('a custom sticky_tokens is honoured, and a bad one falls back to 60000', async ($: any, on: any) => {
  const { sent, current, files } = engine(on, { tokens: 70000, files: { [SETUPS]: JSON.stringify({ active: 'default', sticky_tokens: 100000, setups: { default: {} } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't1')
  await turn($, 'rename foo to bar', 't2') // 70k < 100k: switches
  files[SETUPS] = JSON.stringify({ active: 'default', sticky_tokens: -5, setups: { default: {} } })
  current.tokens = 70000
  await turn($, 'debug the crash in the parser', 't3') // 70k >= 60k: holds Haiku
  expect(sent.map(s => s.model)).toEqual(['opus', 'haiku', 'haiku'])
})

test('a held route is never applied to a subagent, and the first request decides nothing for it', async ($: any, on: any) => {
  const { sent } = engine(on, { tokens: 120000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 'debug the crash in the parser', 't1')
  await $.prompt.submit({ text: 'rename foo to bar' })
  await $.turn.start({ text: 'rename foo to bar', turnId: 't2' })
  await step($, 't2', { agentId: 'a1', model: 'claude-haiku-5', effort: 'low' })
  await step($, 't2')
  expect(sent.slice(1)).toEqual([
    { model: 'claude-haiku-5', effort: 'low', agentId: 'a1' },
    { model: 'opus', effort: 'low', agentId: undefined },
  ])
})

test('the band shows the model that answered, not the one asked for', async ($: any, on: any) => {
  engine(on, { answered: 'claude-fable-5' }) // the engine ignores the swap and answers on Fable
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename foo to bar' }) // routes to Haiku
  await $.turn.start({ text: 'rename foo to bar', turnId: 't1' })
  await step($, 't1')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toContain('Fable')
  await band.unmount()
})
