export type ScoredRole = 'plan' | 'review' | 'hard' | 'code' | 'write' | 'chores';
export type Role = ScoredRole | 'general';
export type Model = 'fable' | 'opus' | 'sonnet' | 'haiku';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RoleSetting = { model: string; effort: string };

/** Roles in tie-break order: most capable first; `general` (no rules, everything else) last. */
export const ROLES: Role[];
/** The roles keyword rules score: every role but `general`, in tie-break order. */
export const SCORED_ROLES: ScoredRole[];
export const MODELS: Model[];
export const EFFORTS: Effort[];
/** Default sticky_tokens: from this context size an automatic route keeps the previous model. */
export const DEFAULT_STICKY_TOKENS: number;
/** A valid sticky_tokens value (a non-negative integer), else DEFAULT_STICKY_TOKENS. */
export function stickyOf(value: unknown): number;
export const DEFAULT_SETUP: Record<Role, RoleSetting>;
export const ROLE_INFO: Record<Role, string>;
/** Case-insensitive regex sources per scored role; each pattern that matches adds 1 to the role's score. */
export const DEFAULT_RULES: Record<ScoredRole, string[]>;
