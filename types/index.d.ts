export type RoleSetting = { model: string; effort: string }
export type Setup = Record<string, RoleSetting>

/** setups.json and rules.json as the mod reads them, defaults filled in. */
export type Config = {
  active: string
  enabled: boolean
  mainModel: string
  setups: Record<string, Setup>
  rules: Record<string, string[]>
}

/** Where this turn is going and why. */
export type Route = {
  role: string
  model: string
  effort: string
  why: string
  source: 'auto' | 'pin' | 'override'
}

/** The model and effort the last main-chat request actually went out with. */
export type Live = { model: string; effort: string }

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      config: Shaped<Config | null>
      route: Shaped<Route | null>
      live: Shaped<Live | null>
      paused: boolean
      manual: string | null
      pin: string | null
      tab: string
    }
  }
}
