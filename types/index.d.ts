export type RoleSetting = { model: string; effort: string }
export type Setup = Record<string, RoleSetting>

/** setups.json and rules.json as the mod reads them, defaults filled in. */
export type Config = {
  active: string
  enabled: boolean
  setups: Record<string, Setup>
  rules: Record<string, string[]>
}

/** Where a turn is going and why: picked from the prompt (auto) or a pinned model (pin). */
export type Route = {
  role: string
  model: string
  effort: string
  why: string
  source: 'auto' | 'pin'
}

/** The route `turn.step` applies, bound to the one turn it was decided for. */
export type TurnRoute = Route & { turnId: string }

/** A route decided at submit, waiting for its turn to start. */
export type Pending = { route: Route | null }

/** A prompt typed while a turn ran, routed for the turn it may start later. */
export type Queued = { text: string; route: Route }

/** The model and effort the last main-chat request actually went out with. */
export type Live = { model: string; effort: string }

/** Where the session is: project folder name, git branch, context window used. */
export type Place = { project: string; branch: string | null; ctx: number | null }

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      config: Shaped<Config | null>
      route: Shaped<TurnRoute | null>
      last: Shaped<Route | null>
      pending: Shaped<Pending | null>
      queued: Shaped<Queued | null>
      live: Shaped<Live | null>
      paused: boolean
      manual: string | null
      pin: string | null
      tab: string
      place: Place | null
      base: string | null
    }
  }
}
