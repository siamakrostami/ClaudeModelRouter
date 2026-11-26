export type Role = 'plan' | 'review' | 'hard' | 'code' | 'write' | 'chores';
export type Model = 'fable' | 'opus' | 'sonnet' | 'haiku';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RoleSetting = { model: string; effort: string };

/** Roles in tie-break order: most capable first. */
export const ROLES: Role[];
export const MODELS: Model[];
export const EFFORTS: Effort[];
export const DEFAULT_SETUP: Record<Role, RoleSetting>;
export const ROLE_INFO: Record<Role, string>;
/** Case-insensitive regex sources per role; each pattern that matches adds 1 to the role's score. */
export const DEFAULT_RULES: Record<Role, string[]>;
