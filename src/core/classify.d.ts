import type { RoleSetting } from './defaults.js';

/** What a prompt routes to. `forced` is true for #role, @model and "use <model> for this". */
export type Classified = {
  role: string;
  model: string;
  effort: string;
  forced: boolean;
  /** The override or the first matched words, shown beside the route. */
  why: string;
};

/** Sort a prompt into a role by the rules; null means "stay on the session's model". */
export function classify(
  prompt: string | undefined | null,
  rules: Record<string, readonly string[]>,
  setup: Record<string, RoleSetting>,
): Classified | null;
