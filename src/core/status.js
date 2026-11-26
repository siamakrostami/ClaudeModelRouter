import * as store from './store.js';

/** Status line segment: "⇢ <setup>" plus running helpers, or "⇢ off". */
export function statusSegment(sessionId) {
  if (!store.sessionEnabled(sessionId)) return '⇢ off';
  const manual = store.readState(sessionId).manual;
  if (manual) return `⇢ manual (${manual})`;
  const base = `⇢ ${store.activeName()}`;
  const running = Object.values(store.readState(sessionId).running || {});
  return running.length ? `${base} · ${running.join(', ')}` : base;
}
