import type { Model } from './defaults.js';

/** Per model, the models tried in order when it is not available. */
export const FALLBACK: Record<Model, Model[]>;

/**
 * The model families the `/config` "model" row offers, or null when that is unknown
 * (row missing or odd, or no family named).
 */
export function availableFrom(rows: unknown): Model[] | null;

/** `model`, or the first available fallback for it; unchanged when availability is unknown. */
export function resolveModel(model: string, available: readonly string[] | null | undefined): string;
