// ScreenFx: the "juice" mapping from gameplay events to camera / post / victim-material reactions (VFX-owned).
// Calibrated per hit weight (palette.hitKind). Tune the table, not combat code.
//   victim flash  target.flash(color, ticks, strength) — a short tinted emissive pulse (never full white: strengths are
//                 scene-relative; in the night grade 0.3 emissive already out-shines the lit body). Combatant
//                 holds the flash through the victim's hitstop, so a KO reads as a freeze-frame, then decays `ticks`.
//   shake         cameraRig.shake(trauma) (amplitude ∝ trauma²), topped up (not stacked) so strings don't over-shake
//   punch         cameraRig.punch(amount, ticks) dolly-in on heavy+
//   pulse         renderer.post.pulse({ ca, desat, flash }) chromatic pulse on heavy+
//   ko            last enemy of a wave: brief global slow-mo + punch (the "final blow" beat)
import { bodyContact } from './contact.js';
import { EV } from '../core/EventBus.js';
import { hitKind, hitPalette } from './palette.js';

export const HIT_JUICE = {
  // r2: victim flash is LOCAL (HitFlash: falloff sphere of radius `fr` m around the contact point), so strengths are
  // higher than r1's full-body values — they only light a hand-sized hot spot.
  //            shake  punch        pulse CA  desat  victim flash strength / decay ticks / radius
  light: { shake: 0.12, punch: 0.012, pt: 5, ca: 0, desat: 0, flash: 0.48, fticks: 2, fr: 0.78 },
  block: { shake: 0.07, punch: 0, pt: 0, ca: 0, desat: 0, flash: 0.35, fticks: 3, fr: 0.26 },
  heavy: { shake: 0.2, punch: 0.03, pt: 8, ca: 0.0007, desat: 0, flash: 0.5, fticks: 4, fr: 0.44 },
  magic: { shake: 0.2, punch: 0.03, pt: 8, ca: 0.00045, desat: 0, flash: 0.5, fticks: 4, fr: 0.6 },
  otg: { shake: 0.22, punch: 0.035, pt: 9, ca: 0.0006, desat: 0, flash: 0.7, fticks: 7, fr: 0.42 },
  knockdown: { shake: 0.26, punch: 0.045, pt: 10, ca: 0.0006, desat: 0.05, flash: 0.5, fticks: 4, fr: 0.5 },
  throw: { shake: 0.3, punch: 0.045, pt: 10, ca: 0.0006, desat: 0, flash: 0.6, fticks: 7, fr: 0.6 },
  ko: { shake: 0.34, punch: 0.065, pt: 14, ca: 0.0008, desat: 0.14, flash: 0.55, fticks: 6, fr: 0.62 },
};

export class ScreenFx {
  constructor(game, vfx) {
    this.game = game;
    this.vfx = vfx;
    const bus = vfx.scope;
    bus.on(EV.HIT, (ev) => this.onHit(ev));
    bus.on(EV.KO, (e) => this.onKO(e));
  }

  onHit(ev) {
    const kind = hitKind({ ...ev, bounce: ev.hit && ev.hit.bounce });
    const J = HIT_JUICE[kind] || HIT_JUICE.light;
    // Victim material flash: element-tinted warm white for heroes' hits, hot red-white when a hero is struck.
    const t = ev.target;
    if (t && t.flash && J.flash > 0) {
      const pal = hitPalette(kind, ev.attacker, ev.hit && ev.hit.element);
      const col = kind === 'block' ? '#d6e4ff' : pal.hot;
      const point = kind === 'throw' && t.pos ? { x: t.pos.x, y: (ev.point ? ev.point.y : 0.4), z: t.pos.z } : bodyContact({ ...ev, kind });
      const small = t.typeId === 'thief' || (t.height || 1.8) < 1.25;
      if (this.vfx.hitFlash && point) this.vfx.hitFlash.hit(t, point, { color: col, ticks: small ? 2 : J.fticks, strength: small ? Math.min(.16, J.flash) : J.flash, radius: small ? Math.min(.22, J.fr) : J.fr, gain: 1.0, tint: kind !== 'block' });
      else t.flash(col, J.fticks, Math.min(0.3, J.flash * 0.3));
    }
    const cam = this.game.cameraRig;
    if (cam) {
      const want = ev.hit && ev.hit.shake != null ? Math.min(J.shake * 1.3, Math.max(J.shake * 0.6, ev.hit.shake)) : J.shake;
      const cur = cam.trauma || 0;
      cam.shake(Math.max(want * 0.35, want - cur * 0.6));
      if (J.punch) cam.punch(J.punch, J.pt);
    }
    const post = this.game.renderer && this.game.renderer.post;
    const ca = kind === 'knockdown' && /^heavy/.test(ev.moveId || '') ? HIT_JUICE.heavy.ca : J.ca;
    if (post && ca) post.pulse({ ca, desat: J.desat, duration: kind === 'ko' ? 0.3 : 0.18 });
  }

  onKO(e) {
    const g = this.game;
    const left = g.world.query({ team: 'enemies' }).filter((a) => a !== e.actor).length;
    if (left === 0 && e.actor && e.actor.team === 'enemies' && e.by && e.by.kind === 'hero') {
      g.slowmo(0.25, 0.35, { out: 0.3 });
      if (g.cameraRig) g.cameraRig.punch(0.09, 16);
    }
  }

  render() {}
}
