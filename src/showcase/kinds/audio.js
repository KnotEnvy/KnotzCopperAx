// what=audio — audio workbench. Click a sound to play it, pick a music cue, set intensity 0–3 / boss.
//   &auto=1 cycles every sound. Any click/key unlocks audio.
// Offline render API for tools/audio-render.mjs (runs in OfflineAudioContext through the real mixer, no unlock needed):
//   __KCA.showcase.renderReel(names|category, opts) → { sr, L, R (base64 int16), markers, peakDb }
//   __KCA.showcase.renderMusic(cueId, seconds, { levels:[[bar,level]...], bossAt, sfx:true }) → same shape
//   __KCA.showcase.sfxStats() → [{ name, peakDb (raw, pre-mixer), dur }]   categories() → { name: [sound ids] }
import { buildMixer } from '../../audio/mixer.js';
import { seeded, hashStr } from '../../audio/dsp.js';
import { Sequencer } from '../../audio/music/_seq.js';

const SR = 48000;
const CATS = {
  weapons: (n) => n.startsWith('whoosh_'),
  hits: (n) => n.startsWith('hit_') || ['body_fall', 'body_impact', 'grab', 'throw', 'charge'].includes(n),
  movement: (n) => n.startsWith('step_') || ['jump', 'land', 'land_heavy', 'dodge', 'dodge_perfect', 'splash'].includes(n),
  magic: (n) => n.startsWith('magic_') || n.startsWith('impact_') || n.startsWith('pickup_'),
  ui: (n) => n.startsWith('ui_') || ['go', 'lock', 'boss_stinger', 'player_down', 'thief_cackle'].includes(n),
  voices: (n) => n.startsWith('vo_') || n === 'roar' || n.startsWith('roar_'),
};

function b64(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); i16[i] = x < 0 ? x * 32768 : x * 32767; }
  const u8 = new Uint8Array(i16.buffer); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function pack(buf, markers) {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  let p = 0; for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  return { sr: buf.sampleRate, L: b64(L), R: b64(R), markers, peakDb: p > 0 ? 20 * Math.log10(p) : -120, seconds: buf.length / buf.sampleRate };
}

export default {
  id: 'audio',
  async setup(ctx) {
    const { game } = ctx;
    ctx.studio({ plinth: false });
    ctx.orbit({ target: [0, 1, 0], distance: 6 });
    const audio = game.audio;
    const names = [...audio.sounds.keys()];
    const catOf = (n) => Object.keys(CATS).find((c) => CATS[c](n)) || 'misc';
    const cats = {}; for (const n of names) (cats[catOf(n)] = cats[catOf(n)] || []).push(n);

    // ---------------------------------------------------------------- workbench UI
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:24px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;font:13px "Palatino Linotype",Georgia,serif;color:#f0dcb8;z-index:6;overflow:auto;background:rgba(12,8,6,.82);padding:18px;border:1px solid #6b4a2a';
    const head = document.createElement('div'); head.style.cssText = 'grid-column:1/-1;display:flex;gap:10px;align-items:center;flex-wrap:wrap;letter-spacing:.12em';
    el.appendChild(head);
    const btn = (label, fn, css = '') => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `background:#2a1a10;color:#f0dcb8;border:1px solid #8a6a3a;padding:3px 8px;font:inherit;cursor:pointer;${css}`; b.onclick = () => { audio.unlock(); fn(); paint(); }; return b; };
    const status = document.createElement('span'); status.style.cssText = 'margin-left:auto;opacity:.75';
    head.append(document.createTextNode('AUDIO WORKBENCH · music:'));
    for (const id of audio.music.cues.keys()) head.appendChild(btn(id, () => audio.music.play(id, { restart: true })));
    head.appendChild(btn('stop', () => audio.music.stop()));
    head.append(document.createTextNode(' intensity:'));
    for (const n of [0, 1, 2, 3]) head.appendChild(btn(String(n), () => audio.music.setIntensity(n)));
    head.appendChild(btn('auto', () => audio.music.setIntensity(null)));
    head.appendChild(btn('boss', () => audio.music.setBoss(!audio.music.boss)));
    head.appendChild(status);
    for (const [c, list] of Object.entries(cats)) {
      const col = document.createElement('div');
      col.innerHTML = `<div style="color:#ffb060;letter-spacing:.2em;margin:4px 0 6px">${c.toUpperCase()} (${list.length})</div>`;
      for (const n of list) col.appendChild(btn(n, () => audio.play(n, { tier: 3 }), 'display:block;width:100%;text-align:left;margin:2px 0'));
      el.appendChild(col);
    }
    document.body.appendChild(el);
    const paint = () => { const s = audio.stats, m = audio.music.info(); status.textContent = `ctx ${audio.ctx ? audio.ctx.state : 'locked (click)'} · voices ${audio.voices.length} · played ${s.played} · pre-rendered ${s.prerendered} · cue ${m.cue || '-'} L${m.level}${m.boss ? ' BOSS' : ''}`; };
    ctx.every(0.5, paint);
    if (game.params.raw.has('auto')) { let i = 0; ctx.every(0.9, () => { audio.unlock(); audio.play(names[i++ % names.length], { tier: 3 }); }); }

    // ---------------------------------------------------------------- offline renders
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const vol = { master: 0.8, sfx: 1, music: 0.6, ui: 0.8, voice: 0.9 };
    function placeSfx(oc, m, name, t, o = {}) {
      const fn = audio.sounds.get(name); if (!fn) return 0;
      const meta = fn.meta || {};
      const out = oc.createGain(); out.gain.value = (o.volume ?? 1) * (meta.norm ?? meta.gain ?? 1);
      let tail = out;
      if (o.pan) { const p = oc.createStereoPanner(); p.pan.value = o.pan; out.connect(p); tail = p; }
      tail.connect(m[meta.bus || 'sfx'] || m.sfx);
      if (meta.verb) { const s = oc.createGain(); s.gain.value = meta.verb; tail.connect(s); s.connect(m.roomSend); }
      fn(oc, out, { rng: seeded(hashStr(name) + (o.variant || 0) * 7919), pitch: o.pitch || 1, tier: o.tier, at: t });
      return meta.dur || 1;
    }
    const expand = (sel) => (Array.isArray(sel) ? sel : cats[sel] || []);

    async function renderReel(sel, { variants = 2, gap = 0.18, maxLen = 3.2 } = {}) {
      await audio.calibrate();
      const list = expand(sel), plan = [];
      let t = 0.2;
      for (const n of list) {
        const meta = (audio.sounds.get(n) || {}).meta || {};
        const tiers = n.startsWith('magic_') && n !== 'magic_rise' ? [1, 3, 6] : n.startsWith('impact_') ? [1, 5] : [null];
        const reps = n === 'pickup_pot' ? 5 : n.startsWith('step_') ? 4 : tiers.length > 1 ? 1 : variants;
        for (const tier of tiers) for (let v = 0; v < reps; v++) {
          const pitch = n === 'pickup_pot' ? Math.pow(2, [0, 2, 4, 7, 9][v] / 12) : 1;
          plan.push({ n, t, v, tier, pitch });
          const len = Math.min(maxLen, (meta.dur || 1) * (n.startsWith('step_') ? 1 : 0.85));
          t += n.startsWith('step_') ? 0.3 : n === 'pickup_pot' ? 0.32 : len * (tier ? 0.25 + tier * 0.15 : 1) + gap;
        }
        t += 0.25;
      }
      const sec = t + 1.5;
      const oc = new OAC(2, Math.ceil(sec * SR), SR);
      const m = buildMixer(oc, vol);
      for (const p of plan) placeSfx(oc, m, p.n, p.t, { variant: p.v, tier: p.tier, pitch: p.pitch });
      const buf = await oc.startRendering();
      const markers = []; for (const p of plan) if (!markers.length || markers[markers.length - 1].name !== p.n) markers.push({ t: p.t, name: p.n });
      return pack(buf, markers);
    }

    /** Music excerpt through the real mixer; levels = [[bar, level]...] (intensity changes on bars); sfx = scripted brawl. */
    async function renderMusic(id, seconds = 30, { levels = [[0, 0]], bossAt = null, sfx = false, transpose = 0 } = {}) {
      const c = audio.music.cues.get(id); if (!c) throw new Error(`no cue ${id}`);
      await audio.calibrate();
      const oc = new OAC(2, Math.ceil(seconds * SR), SR);
      const m = buildMixer(oc, vol);
      const lvAt = (bar) => { let l = 0; for (const [b, v] of levels) if (bar >= b) l = v; return l; };
      const song = { ...c.song, transpose };
      const seq = new Sequencer(oc, m.music, m.hallSend, song, { start: 0.05, intensity: song.adaptive ? lvAt : null, boss: song.adaptive ? (bar) => bossAt !== null && bar >= bossAt : null });
      seq.scheduleUntil(seconds);
      const markers = [{ t: 0, name: `${id} L${lvAt(0)}` }];
      for (const [b, v] of levels) if (b > 0) markers.push({ t: 0.05 + b * seq.barDur, name: `L${v}` });
      if (bossAt !== null) markers.push({ t: 0.05 + bossAt * seq.barDur, name: 'BOSS' });
      if (sfx) { // scripted brawl on top: whooshes/hits every ~0.35 s with sidechain ducks, like the engine does
        const r = seeded(99); let t = 1;
        const duckAt = (tt, amt, len) => { const g = m.musicDuck.gain; g.setTargetAtTime(1 - amt, tt, 0.012); g.setTargetAtTime(1, tt + len, 0.35); };
        while (t < seconds - 1) {
          const k = r();
          placeSfx(oc, m, ['whoosh_greatsword', 'whoosh_sabre', 'whoosh_axe'][Math.floor(r() * 3)], t, { variant: Math.floor(r() * 4), pan: r() * 1.2 - 0.6, volume: 0.85 });
          if (k < 0.12) { placeSfx(oc, m, 'hit_ko', t + 0.08, { variant: 1 }); placeSfx(oc, m, 'vo_enemy_death', t + 0.12); duckAt(t + 0.08, 0.5, 0.45); }
          else if (k < 0.45) { placeSfx(oc, m, 'hit_heavy', t + 0.08, { variant: Math.floor(r() * 4) }); duckAt(t + 0.08, 0.25, 0.16); }
          else placeSfx(oc, m, 'hit_light', t + 0.07, { variant: Math.floor(r() * 4), volume: 0.8 });
          if (r() < 0.5) placeSfx(oc, m, 'step_dirt', t + 0.2, { variant: Math.floor(r() * 6), volume: 0.55 });
          t += 0.28 + r() * 0.3;
        }
        markers.push({ t: 1, name: '+ brawl SFX' });
      }
      const buf = await oc.startRendering();
      return pack(buf, markers);
    }

    async function sfxStats() {
      await audio.calibrate();
      const out = [];
      for (const n of names) {
        const fn = audio.sounds.get(n), meta = fn.meta || {};
        const dur = meta.dur || 1, oc = new OAC(1, Math.ceil(dur * SR), SR), g = oc.createGain(); g.connect(oc.destination);
        g.gain.value = meta.norm ?? 1;
        fn(oc, g, { rng: seeded(hashStr(n)), pitch: 1, tier: 6, at: 0 });
        const b = await oc.startRendering(), d = b.getChannelData(0);
        let p = 0, s = 0; for (let i = 0; i < d.length; i++) { p = Math.max(p, Math.abs(d[i])); s += d[i] * d[i]; }
        out.push({ name: n, norm: +(meta.norm ?? 1).toFixed(3), peakDb: +(20 * Math.log10(p || 1e-6)).toFixed(1), rmsDb: +(10 * Math.log10(s / d.length || 1e-12)).toFixed(1), dur, gain: meta.gain ?? 1 });
      }
      return out;
    }

    ctx.expose({ play: (n, o) => { audio.unlock(); return !!audio.play(n, o); }, sounds: () => names, categories: () => cats, renderReel, renderMusic, sfxStats });
  },
};
