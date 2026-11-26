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

/** Stand in for the engine: no setups.json on disk, so the mod uses its defaults. */
function engine(on: any, model = 'claude-fable-5') {
  const current = { model }
  mock.env(on, { HOME: '/home/test' })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.write', () => ({ value: {} }))
  on('command.register', () => ({ value: { command: 'router' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: current.model }))
  on('prompt.submit', (_: any, e: any) => e)
  return current
}

/** The band's route line, as one string. */
async function route(ui: any) {
  return (await ui.find({ type: 'Text', text: /●|○/ }))?.text
}

test('the band and the pane draw every state on terminal and desktop', async ($: any, on: any) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of SURFACES) {
    // before any prompt: the main model, no task word anywhere
    let band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toBe('●●●●○ Fable · X-High')
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

    // the pane: Routes tab has a model and an effort control per task
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

test('a session that starts on Opus routes normally', async ($: any, on: any) => {
  engine(on, 'claude-opus-5')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename foo to bar' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await route(band)).toBe('●○○○○ Haiku · Low')
  await band.unmount()
})

test('a /model switch shows as Manual', async ($: any, on: any) => {
  const current = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  current.model = 'claude-opus-5' // the person runs /model opus mid-session
  await $.prompt.submit({ text: 'debug the crash in the parser' })

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await route(band)).toMatch(/Opus.* {2}Manual$/)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: 'Manual' })).toBeDefined()
    await pane.unmount()
  }
})
