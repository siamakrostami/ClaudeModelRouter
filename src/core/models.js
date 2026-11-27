// Which model families the account can pick, and what to use when a setup names one it cannot.

import { MODELS } from './defaults.js';

/** When a model is not available, the first of these that is. */
export const FALLBACK = {
  fable: ['opus', 'sonnet', 'haiku'],
  opus: ['sonnet', 'haiku', 'fable'],
  sonnet: ['haiku', 'opus', 'fable'],
  haiku: ['sonnet', 'opus', 'fable'],
};

/**
 * The families the `/config` rows offer: the row keyed `model` lists what `/model` offers
 * ("opus", "fable[1m]", ...), and a family is available when any option contains its name.
 * Null (unknown) when the row is missing or odd, or names no family: never a reason to stop routing.
 */
export function availableFrom(rows) {
  if (!Array.isArray(rows)) return null;
  const row = rows.find(r => r && typeof r === 'object' && r.key === 'model');
  const options = Array.isArray(row?.options) ? row.options.filter(o => typeof o === 'string').map(o => o.toLowerCase()) : [];
  const found = MODELS.filter(m => options.some(o => o.includes(m)));
  return found.length ? found : null;
}

/**
 * The model to send instead of `model` when the account cannot use it (see FALLBACK).
 * Unknown availability (null or empty), an available model or an unknown name: unchanged.
 */
export function resolveModel(model, available) {
  if (!Array.isArray(available) || !available.length || available.includes(model) || !Object.hasOwn(FALLBACK, model)) return model;
  return FALLBACK[model].find(m => available.includes(m)) ?? model;
}
