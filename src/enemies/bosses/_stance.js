// Per-boss stance helpers (bosses C2 r1). A boss body built from shared art (the Wyrm Rider is a 'viper' spawned by the
// mount system) gets its own clip set by switching its Animator to a boss-only character id after spawn: the cached
// actions are dropped so the next play() bakes from the new set, and the current clip restarts at once.
export function useClipSet(actor, character) {
  const an = actor && actor.animator;
  if (!an || an.character === character) return false;
  const cur = an.cur ? an.cur.name : null;
  an.character = character;
  actor.character = character;
  for (const pair of an.actions.values()) for (const act of pair) { act.stop(); try { an.mixer.uncacheAction(act.getClip()); } catch (e) { /* already gone */ } }
  an.actions.clear();
  an.cur = null; an.prev = null;
  if (cur) actor.play(cur, { fade: 0, restart: true });
  return true;
}
