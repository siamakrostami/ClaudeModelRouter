/** Control bytes become spaces, whitespace collapses, cut to `max` characters (… when cut). */
export function clean(text: unknown, max: number): string;
/** FNV-1a 32-bit hex of the text plus ":" and its length; stands in for the text itself. */
export function fingerprint(text: string): string;
export const NAME_RE: RegExp;
/** Letters, digits, - _ . (1-40 characters), and not a prototype key such as __proto__. */
export function isSetupName(name: unknown): name is string;
