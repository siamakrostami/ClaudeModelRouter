export type RoleSetting = { model: string; effort: string }
export type Setup = Record<string, RoleSetting>

/** setups.json and rules.json as the mod reads them, defaults filled in. */
export type Config = {
  active: string
  enabled: boolean
  setups: Record<string, Setup>
  rules: Record<string, string[]>
  /** sticky_tokens from setups.json: from this context size an automatic route keeps the previous model; 0 = off. */
  sticky: number
}

/** Where a turn is going and why: picked from the prompt (auto) or a pinned model (pin). */
export type Route = {
  role: string
  model: string
  effort: string
  why: string
  source: 'auto' | 'pin'
  /** From #role, @model or "use <model> for this": never held. */
  forced?: boolean
  /** Kept on the previous model (`model`) to keep its prompt cache warm, instead of `wanted`. */
  held?: boolean
  wanted?: string
  /** Set by Claude's switch_model call, for the rest of the turn. */
  switched?: boolean
  /** The context size, in tokens, the hold was decided at. */
  tokens?: number
}

/** The route `turn.step` applies, bound to the one turn it was decided for. */
export type TurnRoute = Route & { turnId: string }

/** A route decided at submit, waiting for its turn to start. */
export type Pending = { route: Route | null }

/**
 * A prompt typed while a turn ran, routed for the turn it may start later. `hash` is the
 * fingerprint (FNV-1a 32-bit hex plus length) of its trimmed text; the text itself is not kept.
 */
export type Queued = { hash: string; route: Route }

/** The model and effort the last main-chat request actually went out with. */
export type Live = { model: string; effort: string }

/** Requests and tokens one model family used this session. */
export type ModelTally = { requests: number; input: number; cacheRead: number; cacheWrite: number; output: number }
export type Tally = Record<string, ModelTally>

/** Where the session is: project folder name, git branch, context window used (percent and tokens). */
export type Place = { project: string; branch: string | null; ctx: number | null; tokens?: number | null }

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
      /** Model families the account can pick (the /config "model" row); null when unknown. */
      available: string[] | null
      /** A model Claude switched to with switch_model; cleared when the turn ends. */
      switched: Shaped<Live | null>
      /** Per-model requests and tokens this session. */
      tally: Shaped<Tally | null>
      /** Steps this turn in which Fable edited files. */
      fableEdits: number
    }
  }
}
