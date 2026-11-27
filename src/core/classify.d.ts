import type { RoleSetting } from './defaults.js';

/** What a prompt routes to. `forced` is true for #role, @model and "use <model> for this". */
export type Classified = {
  role: string;
  model: string;
  effort: string;
  forced: boolean;
  /** The override, the continuation phrase or the first matched words, shown beside the route. */
  why: string;
};

/** What the session was doing: the role of its previous route, if any. */
export type ClassifyContext = { previousRole?: string | null };

/**
 * Sort a prompt into a role: overrides, then short continuations (by `context.previousRole`),
 * then keyword rules, then the previous role when it was hard, code or write, else general.
 * Null means "stay on the session's model" (#self, "do it yourself", an empty prompt).
 */
export function classify(
  prompt: string | undefined | null,
  rules: Record<string, readonly string[]>,
  setup: Record<string, RoleSetting>,
  context?: ClassifyContext,
): Classified | null;

/** The regex source a user rule (a plain word or phrase) compiles to: escaped, `\s+` between words, `\b` at word ends. */
export function phraseSource(phrase: string): string;
