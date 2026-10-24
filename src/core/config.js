// Global constants + URL parameter parsing. Everything else reads `params` / `QUALITY` from here.
//
// URL modes (docs/ARCHITECTURE.md §5):
//   ?mode=title (default) | ?mode=stage&stage=1&p1=brann[&p2=gorrim][&bot=1][&seed=N][&screen=K]
//   ?mode=showcase&what=<kind>&id=<id>[&anim=<clip>][&cam=<preset>][&tier=N]
//   &capture=1 (manual clock, hidden cursor) · &quality=low|high · &debug=1 (hitbox overlay + error toasts)

/** Simulation tick rate. Combat frame data is authored in these ticks. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** Gravity in m/s² (snappy arcade arc: Brann's 2.1 m apex takes ~0.44 s to reach). */
export const GRAVITY = 22;
/** Classic belt-scroller depth tolerance for melee (|Δz| ≤ this). */
export const DEPTH_TOL = 0.45;

/** Graphics quality saved by the Options menu (game/Settings.js, localStorage 'kca.settings.v1'), else 'high'. */
function savedQuality() {
  try { const s = JSON.parse(localStorage.getItem('kca.settings.v1') || 'null'); return s && s.quality === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}

function parseParams(search) {
  const q = new URLSearchParams(search);
  const get = (k, d) => (q.has(k) ? q.get(k) : d);
  const num = (k, d) => (q.has(k) && q.get(k) !== '' && !isNaN(Number(q.get(k))) ? Number(q.get(k)) : d);
  const bool = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const capture = bool('capture');
  return {
    raw: q,
    mode: get('mode', 'title'),
    stage: get('stage', '1'),
    p1: get('p1', null),
    p2: get('p2', null),
    bot: bool('bot'),
    /** bot=1 drives every player; bot=2 drives only P2 (handy for co-op tests). */
    botMask: q.get('bot') === '2' ? [false, true] : (bool('bot') ? [true, true] : [false, false]),
    seed: num('seed', capture ? 1 : (Date.now() % 100000)),
    screen: num('screen', 0),
    what: get('what', 'hero'),
    id: get('id', null),
    anim: get('anim', null),
    cam: get('cam', null),
    tier: num('tier', 1),
    capture,
    // &quality wins; otherwise the Options menu choice saved by game/Settings.js (captures ignore it: deterministic)
    quality: get('quality', capture ? 'high' : savedQuality()) === 'low' ? 'low' : 'high',
    debug: bool('debug'),
    /** Free-form getter for subsystem-specific params (e.g. params.get('spin')). */
    get: (k, d = null) => get(k, d),
    num,
    bool,
  };
}

export const params = parseParams(typeof location !== 'undefined' ? location.search : '');

/** Quality presets. Render/VFX read these; `quality=low` halves particles and shadow resolution. */
export const QUALITY = {
  // perf-1650: renderScale = internal resolution × (canvas upscaled by the compositor); drsMin = floor of the dynamic
  // resolution safety net (render/Renderer.js, only engages when frames miss 60 Hz); pixelBudget caps the drawing
  // buffer (DPR included) at ~1080p worth of pixels so a 1440p/4K or 150 %-scaled screen doesn't render 2–4× 1080p.
  high: { name: 'high', pixelRatio: Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 1.5), pixelBudget: 1920 * 1080 * 1.05, renderScale: 1, drsMin: 0.72, shadowMapSize: 2048, smaa: true, bloom: true, bloomResolution: 0.5, particleScale: 1, maxParticles: 6000, envResolution: 256 },
  low: { name: 'low', pixelRatio: 1, pixelBudget: 1920 * 1080 * 1.05, renderScale: 0.8, drsMin: 0.75, shadowMapSize: 1024, smaa: true, smaaPreset: 'low', bloom: true, bloomResolution: 0.35, particleScale: 0.5, maxParticles: 2500, envResolution: 128 },
}[params.quality];

/** Heroes known to the game (also discoverable via registries.heroes). */
export const HERO_IDS = ['brann', 'seraphine', 'gorrim'];
