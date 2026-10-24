// VFX palettes + hit classification (shared by effects/*, ScreenFx and Trails).
// Hit hues stay saturated through bloom; shape and timing carry each weight independently of the ground ring.
// Element palettes own a hue family (earth = incandescent amber → warm stone, fire = orange → blood red,
// storm = ice-cyan → violet) so magic reads by colour alone; physical hits use the per-WEIGHT palettes below.
export const PALETTES = {
  earth: { core: '#fff4d8', hot: '#ffd18a', mid: '#ec8b30', tail: '#763c25', glint: '#fff0c2', trail: ['#fff2c0', '#d89a20'], mote: '#efad58' },
  fire: { core: '#fff0c0', hot: '#ffb03a', mid: '#ff5210', tail: '#c01006', glint: '#ffc080', trail: ['#ffe4a0', '#ff4a10'], mote: '#ff7a30' },
  storm: { core: '#f4fcff', hot: '#b0eaff', mid: '#40b0ff', tail: '#7040ff', glint: '#dcf6ff', trail: ['#e8f8ff', '#4aa8ff'], mote: '#9ad8ff' },
  enemy: { core: '#fff0e8', hot: '#ffb8a0', mid: '#ff4c3a', tail: '#a0102c', glint: '#ffd0c0', trail: ['#ffe4d6', '#c85440'], mote: '#ff8a6a' },
  neutral: { core: '#fff6ea', hot: '#ffe0b8', mid: '#ffb070', tail: '#c05a28', glint: '#ffeed0', trail: ['#fff2e0', '#e0a070'], mote: '#ffd0a0' },
  metal: { core: '#ffffff', hot: '#fff4c8', mid: '#ffd070', tail: '#ff8a2a', glint: '#e4f0ff', trail: ['#ffffff', '#c0d8ff'], mote: '#fff0c0' },
};

/** Physical (weapon) hit palettes per weight class: the weight reads by hue as well as by shape. */
export const KIND_PALETTES = {
  light: { core: '#ffffff', hot: '#ffd888', mid: '#eab957', tail: '#b67b28', glint: '#ffffff' },          // crisp white-gold tick
  heavy: { core: '#fff4d6', hot: '#ffc450', mid: '#ff8a18', tail: '#d8400a', glint: '#ffe0a0' },          // amber
  otg: { core: '#fff0d0', hot: '#ffb048', mid: '#ff7018', tail: '#b8300a', glint: '#ffe0a0' },
  knockdown: { core: '#fff0e4', hot: '#ff9a5a', mid: '#ff3c20', tail: '#a80c30', glint: '#ffd8c8' },      // crimson
  ko: { core: '#ffffff', hot: '#ffe070', mid: '#ff3424', tail: '#80083c', glint: '#fff4c0' },             // gold + blood
  throw: { core: '#fff2d0', hot: '#ffd08a', mid: '#e89238', tail: '#8a4a18', glint: '#fff0c8' },          // earthen slam
  block: PALETTES.metal,
};

/** Palette for a hit: magic → element (explicit or caster's); enemy attackers → enemy red; else the weight palette. */
export function hitPalette(kind, attacker, element) {
  if (kind === 'magic') return PALETTES[element] || PALETTES[elementOf(attacker)] || PALETTES.fire;
  if (kind === 'block') return PALETTES.metal;
  if (attacker && attacker.team === 'enemies') return PALETTES.enemy;
  return KIND_PALETTES[kind] || KIND_PALETTES.light;
}

/** Element key for an actor: hero magic element, else 'enemy' (enemies) / 'neutral'. */
export function elementOf(actor) {
  if (!actor) return 'neutral';
  const el = actor.def && actor.def.magic && actor.def.magic.element;
  if (el && PALETTES[el]) return el;
  if (actor.team === 'enemies') return 'enemy';
  return 'neutral';
}

export function paletteOf(actor, element) {
  return PALETTES[element] || PALETTES[elementOf(actor)] || PALETTES.neutral;
}

/**
 * Hit weight class from a HitEvent-like object:
 *   'block' · 'throw' (thrown body lands) · 'otg' (downed stab) · 'magic' · 'ko' (killing blow) ·
 *   'knockdown' (floors / launches) · 'heavy' · 'light'.  An explicit o.kind wins.
 */
export function hitKind(o = {}) {
  if (o.kind) return o.kind;
  if (o.blocked) return 'block';
  const id = o.moveId || '';
  if (id === 'throw') return 'throw';
  if (o.otg || id.startsWith('death_stab')) return 'otg';
  if (o.level === 'magic') return 'magic';
  if (o.killed) return 'ko';
  if (o.knockdown || o.launch > 0 || o.bounce > 0) return 'knockdown';
  if (o.level === 'heavy' || id.startsWith('heavy') || id === 'throw_impact') return 'heavy';
  return 'light';
}

export const WEIGHT = { light: 0, block: 0, heavy: 1, magic: 1, otg: 1, knockdown: 2, throw: 2, ko: 3 };
