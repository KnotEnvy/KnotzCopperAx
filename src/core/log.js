// Central error/warn collector. info().errors (test hooks) reads from here, and the debug toast shows it.
// Always use reportError() for caught subsystem failures so captures surface them.

const errors = [];
const listeners = new Set();

export function reportError(tag, err) {
  const msg = `[${tag}] ${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err)}`;
  errors.push({ t: performance.now(), tag, msg });
  if (errors.length > 100) errors.shift();
  console.error(`[KCA:${tag}]`, err);
  for (const fn of listeners) { try { fn(errors[errors.length - 1]); } catch { /* ignore */ } }
}

export function warnOnce(key, ...args) {
  if (warnOnce._seen.has(key)) return;
  warnOnce._seen.add(key);
  console.warn('[KCA]', ...args);
}
warnOnce._seen = new Set();

export const getErrors = () => errors.map((e) => e.msg);
export const onError = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
