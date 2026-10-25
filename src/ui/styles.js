// UI stylesheet (injected once). Hand-forged copper/bronze + parchment + illuminated-manuscript look.
// Display lettering is vector (src/ui/lettering.js); body text uses a humanist serif stack in small caps.
// Motion: springy transforms (cubic-bezier(.2,1.5,.35,1)) and purposeful fades; no default browser chrome.
const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .4  0 0 0 0 .3  0 0 0 .55 0"/></filter><rect width="220" height="220" filter="url(#n)"/></svg>')}")`;
const PARCH = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><filter id="p" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".008 .012" numOctaves="4" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .3  0 0 0 0 .15  0 0 0 .45 0"/></filter><rect width="640" height="640" filter="url(#p)"/></svg>')}")`;
const EASE = 'cubic-bezier(.2,1.5,.35,1)';

// Bundled body face (r6): EB Garamond (SIL OFL 1.1, public/assets/fonts/EBGaramond-OFL.txt), latin subset, 400/500/700. Without it Linux fell
// back to a system serif with SYNTHESISED small caps. font-display:block + an explicit load() in injectStyles keep first paint on the real face.
const FB = `${import.meta.env.BASE_URL || '/'}assets/fonts/`;
const FONT_FACES = [400, 500, 700].map((w) => `@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: ${w}; font-display: block; src: url("${FB}eb-garamond-latin-${w}-normal.woff2") format("woff2"); }`).concat(`@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: 400; font-display: block; src: url("${FB}eb-garamond-latin-400-italic.woff2") format("woff2"); }`).join('\n');

const CSS = `${FONT_FACES}
.kca-ui { --copper:#c8743a; --copper-hi:#ffc58a; --gold:#ffd070; --gold-hi:#fff0b8; --bronze:#8a6034; --bronze-dk:#3a2412; --ink:#140b06;
  --parch:#ecdcb6; --parch-dk:#b89868; --ivory:#f4e6c8; --ember:#ff7a30; --p1:#ff9a3c; --p2:#5fb2ff; --blood:#b3261a;
  --body: "EB Garamond", "Constantia", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
  position: fixed; inset: 0; pointer-events: none; font-family: var(--body); color: var(--ivory); user-select: none; z-index: 5;
  will-change: transform; } /* perf-1650: own compositor layer — a canvas resize (dynamic resolution) no longer re-rasters the whole HUD */
.kca-ui * { box-sizing: border-box; }
.kca-layer { position: absolute; inset: 0; zoom: var(--uiz, 1); }
.kca-screen { position: absolute; inset: 0; pointer-events: auto; }
.forge { display: inline-block; overflow: visible; vertical-align: middle; height: 1em; width: auto; }
.kca-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.sc { font-variant: small-caps; letter-spacing: .14em; }
.kca-noise { position: absolute; inset: 0; background: ${NOISE}; mix-blend-mode: overlay; opacity: .5; pointer-events: none; }

/* ---------- shared panels */
.kca-panel { position: relative; background: radial-gradient(ellipse at 50% 0%, rgba(90,52,26,.55), transparent 70%), linear-gradient(#22150d, #120a06);
  border: 2px solid #7a5230; border-radius: 4px; box-shadow: 0 0 0 1px #0a0503, 0 0 0 5px #2a180c, 0 0 0 6px #8a6034, 0 18px 40px rgba(0,0,0,.7), inset 0 0 40px rgba(0,0,0,.65); }
.kca-panel::after { content: ''; position: absolute; inset: 5px; border: 1px solid rgba(255,200,130,.18); border-radius: 2px; pointer-events: none; }
.kca-panel > .orn-corner { position: absolute; z-index: 2; filter: drop-shadow(0 2px 2px #000); }
.kca-panel > .c-tl { left: -17px; top: -17px; } .kca-panel > .c-tr { right: -17px; top: -17px; transform: scaleX(-1); }
.kca-panel > .c-bl { left: -17px; bottom: -17px; transform: scaleY(-1); } .kca-panel > .c-br { right: -17px; bottom: -17px; transform: scale(-1,-1); }
.kca-parch { position: relative; color: #2a1608; background: ${PARCH}, radial-gradient(ellipse at 50% 45%, #f4e6c4 0%, #e6d0a0 55%, #c49a62 100%);
  box-shadow: inset 0 0 60px rgba(90,40,10,.55), inset 0 0 8px rgba(60,20,0,.6), 0 20px 50px rgba(0,0,0,.75); border-radius: 3px; }
.orn-rule { display: flex; align-items: center; justify-content: center; gap: 4px; }
.orn-rule .orn-rule-b { height: 14px; flex: 1; max-width: 240px; filter: drop-shadow(0 2px 2px rgba(0,0,0,.8)); }
.orn-rule .orn-rule-b.flip { transform: scaleX(-1); }
.orn-rule .orn-rule-k { filter: drop-shadow(0 2px 3px rgba(0,0,0,.9)); }
.kca-btnrow { display: flex; gap: 22px; justify-content: center; font-size: 13px; letter-spacing: .28em; color: #d8c09a; text-shadow: 0 2px 3px #000; }
.kca-btnrow b { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px; margin-right: 7px; border-radius: 4px; border: 1.5px solid #c8a070;
  background: linear-gradient(#4a301a, #1c1008); color: #ffe0b0; font-size: 11px; letter-spacing: .05em; font-family: var(--body); box-shadow: 0 2px 0 #0a0503; }

/* ---------- menus (title, pause, options) */
.kca-menu { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.kca-mi { position: relative; height: 38px; display: flex; align-items: center; justify-content: center; opacity: .8; transform: scale(.94); transition: transform .16s ${EASE}, opacity .12s, filter .12s; filter: saturate(.85) brightness(.92); }
.kca-mi .forge { height: 30px; filter: drop-shadow(0 3px 3px rgba(0,0,0,.9)); }
.kca-mi .alt { display: none; }
.kca-mi.sel { opacity: 1; transform: scale(1.12); filter: drop-shadow(0 0 14px rgba(255,190,90,.6)) brightness(1.12); }
.kca-mi.sel .alt { display: inline-block; } .kca-mi.sel .base { display: none; }
.kca-mi.dis { opacity: .3; }
.kca-cursor { position: absolute; left: 0; top: 0; transition: transform .32s ${EASE}; filter: drop-shadow(0 3px 3px #000) drop-shadow(0 0 10px rgba(255,190,90,.55)); }
.kca-cursor .orn-sword { animation: kca-poke 1.1s ease-in-out infinite; }
.kca-cursor.r .orn-sword { transform: scaleX(-1); animation-name: kca-poke-r; }
@keyframes kca-poke { 50% { transform: translateX(7px); } }
@keyframes kca-poke-r { 0%,100% { transform: scaleX(-1); } 50% { transform: scaleX(-1) translateX(7px); } }
.kca-desc { height: 22px; margin-top: 14px; font-size: 15px; letter-spacing: .22em; color: #e0c898; text-shadow: 0 2px 3px #000; text-align: center; font-variant: small-caps; }

/* ---------- HUD */
.kca-hud { position: absolute; top: 16px; left: 20px; right: 20px; display: flex; justify-content: space-between; align-items: flex-start; opacity: 0; transform: translateY(-14px); transition: opacity .35s, transform .45s ${EASE}; }
.kca-hud.on { opacity: 1; transform: none; }
.kca-pp { position: relative; display: flex; gap: 10px; align-items: center; min-width: 420px; filter: drop-shadow(0 3px 5px rgba(0,0,0,.75)); }
.kca-pp.p2 { flex-direction: row-reverse; text-align: right; }
.kca-pp.empty .kca-pinfo, .kca-pp.empty .kca-medal { opacity: .0; }
.kca-join { position: absolute; top: 18px; display: none; font-size: 15px; letter-spacing: .4em; color: #ffe0a0; text-shadow: 0 2px 3px #000; animation: kca-blink 1.1s steps(1) infinite; }
.kca-pp.p1 .kca-join { left: 8px; } .kca-pp.p2 .kca-join { right: 8px; }
.kca-pp.empty .kca-join { display: block; }
.kca-medal { position: relative; width: 88px; height: 88px; flex: none; transition: opacity .3s; }
.kca-medal .ring { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 200deg, #6a3a16, #ffcf8a, #b86a2c, #4a2408, #d08a4a, #6a3a16);
  box-shadow: 0 0 0 2px #120803, inset 0 0 0 2px rgba(0,0,0,.6), 0 0 16px color-mix(in srgb, var(--pc, #c8874a) 40%, transparent); }
.kca-medal .face { position: absolute; inset: 7px; border-radius: 50%; overflow: hidden; background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--pc,#c8874a) 55%, #2a1a10), #0e0805 72%);
  box-shadow: inset 0 0 0 2px #1a0c04, inset 0 -8px 16px rgba(0,0,0,.7); }
.kca-medal .face img { position: absolute; left: 50%; top: 50%; width: 118%; transform: translate(-50%, -46%); }
.kca-medal .face .orn-crest { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%); }
.kca-medal .tag { position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); padding: 1px 9px; border-radius: 3px; font-size: 13px; font-weight: 700; letter-spacing: .12em;
  background: linear-gradient(var(--pcol, var(--p1)), color-mix(in srgb, var(--pcol, var(--p1)) 55%, #000)); color: #140803; border: 1.5px solid #120803; }
.kca-pp.p2 .kca-medal .tag { --pcol: var(--p2); }
.kca-medal.hit .face { animation: kca-hitflash .3s; }
@keyframes kca-hitflash { 0% { filter: brightness(2.4) saturate(0); } 100% { filter: none; } }
.kca-pinfo { display: flex; flex-direction: column; gap: 5px; transition: opacity .3s; }
.kca-name { height: 26px; display: flex; align-items: center; gap: 10px; }
.kca-pp.p2 .kca-name { flex-direction: row-reverse; }
.kca-name .forge { height: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,.9)); }
.kca-lives { display: flex; gap: 5px; align-items: center; }
.kca-lives i { width: 14px; height: 14px; transform: rotate(45deg); background: linear-gradient(135deg, #fff0c0, #e09a34 55%, #7a3a0a); border: 1.5px solid #1a0a02; box-shadow: 0 0 5px rgba(255,180,60,.5); }
.kca-lives i.gone { background: #2a1a10; box-shadow: none; opacity: .5; }
.kca-life { display: flex; gap: 3px; padding: 3px; background: linear-gradient(#3a2412, #1a0e06); border: 1.5px solid #9a6a3a; border-radius: 3px; box-shadow: 0 0 0 1.5px #0e0703, inset 0 1px 0 rgba(255,210,150,.25); }
.kca-pp.p2 .kca-life { flex-direction: row-reverse; }
.kca-block { position: relative; width: 98px; height: 20px; background: linear-gradient(#0a0503, #1c100a); border-radius: 2px; box-shadow: inset 0 2px 4px rgba(0,0,0,.9); overflow: hidden; }
.kca-block i { position: absolute; inset: 0; transform-origin: left; will-change: transform; } /* perf-1650: per-frame scaleX stays on the compositor (no HUD re-raster) */
.kca-pp.p2 .kca-block i { transform-origin: right; }
.kca-block .ghost { background: linear-gradient(#fff6e0, #ffb080 60%, #d85a2a); }
.kca-block .fill { background: linear-gradient(#fff2b0 0%, #ffd060 22%, #f08a2a 55%, #a8380c 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 0 rgba(80,20,0,.35); }
.kca-block .fill::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 11px, rgba(60,20,0,.28) 11px 12px); }
.kca-life.low .fill { background: linear-gradient(#ffd0c0, #ff5a3a 45%, #a0100a); animation: kca-pulse .42s infinite alternate; }
.kca-life.heal .fill { filter: brightness(1.6) saturate(1.3); transition: filter .5s; }
@keyframes kca-pulse { from { filter: brightness(1); } to { filter: brightness(1.7); } }
.kca-row { display: flex; gap: 12px; align-items: center; }
.kca-pp.p2 .kca-row { flex-direction: row-reverse; }
.kca-tiers { display: flex; gap: 3px; }
.kca-tier { position: relative; display: flex; gap: 1px; align-items: center; height: 30px; padding: 0 4px 0 18px; border: 1.5px solid #4a3a5a; border-radius: 3px; background: linear-gradient(rgba(24,16,34,.85), rgba(8,6,14,.9)); transition: border-color .2s, box-shadow .2s; }
.kca-tier em { position: absolute; left: 3px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 14px; font-weight: 700; color: #9a8ab0; text-shadow: 0 1px 1px #000; }
.kca-tier .orn-pot { width: 16px; height: 21px; }
.kca-tier.ready { border-color: #7fb4ff; box-shadow: 0 0 9px rgba(80,150,255,.5), inset 0 0 6px rgba(80,150,255,.25); }
.kca-tier.ready em { color: #e0f0ff; text-shadow: 0 0 6px #5aa0ff; }
.kca-tier.sel { border-color: #ffd070; box-shadow: 0 0 14px rgba(255,200,90,.85); animation: kca-selpop .3s ${EASE}; }
@keyframes kca-selpop { from { transform: scale(1.3); } }
.kca-pot { display: inline-block; width: 16px; height: 21px; }
.kca-pot .orn-pot { width: 100%; height: 100%; display: block; }
.kca-pot .f { display: none; } .kca-pot.full .f { display: block; } .kca-pot.full .e { display: none; }
.kca-pot.pop { animation: kca-potpop .35s ${EASE}; }
@keyframes kca-potpop { from { transform: scale(1.8) translateY(-4px); filter: brightness(2); } }
.kca-score { font-size: 27px; line-height: 1; font-weight: 700; letter-spacing: .08em; font-variant-numeric: tabular-nums; font-family: var(--body);
  background: linear-gradient(#fff3c8, #ffcf6a 50%, #c47a22); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 2px 0 #1a0802) drop-shadow(0 2px 3px #000); }
.kca-score.bump { animation: kca-bump .25s ease-out; }
@keyframes kca-bump { from { transform: scale(1.15); } }
/* CONTINUE? takes over the dead player's own life/pot/score slot (reserved region, same footprint) — the name plate
   above stays fully legible and nothing else (combo counter, other player) shares that space */
.kca-continue { display: none; align-items: center; gap: 14px; height: 66px; padding: 0 20px 0 14px; box-sizing: border-box;
  background: linear-gradient(#2a170b, #120904); border: 1.5px solid #b07a3e; border-radius: 4px; box-shadow: 0 0 0 1.5px #0e0703, inset 0 1px 0 rgba(255,210,150,.25); }
.kca-pp.p2 .kca-continue { flex-direction: row-reverse; padding: 0 14px 0 20px; }
.kca-pp.cont .kca-life, .kca-pp.cont .kca-row { display: none; }
.kca-continue .txt { display: flex; flex-direction: column; gap: 3px; }
.kca-pp.p2 .kca-continue .txt { align-items: flex-end; }
.kca-continue.on { display: flex; animation: kca-in .4s ${EASE}; }
.kca-continue .l .forge { height: 20px; } .kca-continue .d { height: 54px; width: 44px; display: flex; justify-content: center; } .kca-continue .d .forge { height: 54px; animation: kca-tick 1s ease-out infinite; filter: drop-shadow(0 3px 2px #000); }
.kca-continue .h { font-size: 12px; font-weight: 700; letter-spacing: .3em; color: #e0c898; animation: kca-blink 1s steps(1) infinite; }
@keyframes kca-tick { 0% { transform: scale(1.35); filter: brightness(1.8); } 30% { transform: scale(1); filter: none; } }
.kca-pp.cont .kca-medal .face { opacity: .45; filter: grayscale(.85); }
.kca-combo { position: absolute; top: 128px; display: flex; align-items: flex-end; gap: 8px; opacity: 0; transform: translateX(-20px); transition: opacity .25s, transform .35s ${EASE}; }
.kca-combo.p2 { transform: translateX(20px); } /* r6: same left-to-right order as 1P (number · HITS · rank) — the mirrored row-reverse read "KNOT HITS 52"; the right-edge anchoring keeps it mirrored */
.kca-combo.on { opacity: 1; transform: none; }
.kca-combo.muted { display: none; }
.kca-combo .n, .kca-combo .r { will-change: transform; } /* perf-1650: hit pops animate on the compositor */
.kca-combo .n .forge { height: 54px; filter: drop-shadow(0 3px 3px rgba(0,0,0,.9)); }
.kca-combo .l { padding-bottom: 6px; } .kca-combo .l .forge { height: 16px; }
.kca-combo .r { margin-left: 6px; padding-bottom: 2px; } .kca-combo .r .forge { height: 40px; filter: drop-shadow(0 3px 3px #000) drop-shadow(0 0 14px rgba(255,120,40,.6)); }
.kca-combo .r.knot .forge { height: 44px; animation: kca-knot 1.2s linear infinite; }
@keyframes kca-knot { 0%,100% { filter: drop-shadow(0 3px 3px #000) drop-shadow(0 0 8px #ff6a20); transform: scale(1); } 50% { filter: drop-shadow(0 3px 3px #000) drop-shadow(0 0 22px #ffd070) brightness(1.3); transform: scale(1.08); } }
.kca-combo .bar { position: absolute; left: 0; right: 0; bottom: -8px; height: 3px; background: linear-gradient(90deg, #ffd070, #ff6a20); transform-origin: left; will-change: transform; }
.kca-combo.p2 .bar { transform-origin: right; }
.kca-combo .pop { animation: kca-combopop .18s ease-out; }
@keyframes kca-combopop { from { transform: scale(1.45) rotate(-4deg); } }
.kca-stageplate { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); display: none; flex-direction: column; align-items: center; gap: 3px; min-width: 132px; padding: 12px 22px 8px; margin-top: -16px; box-sizing: border-box;
  background: linear-gradient(#2a170b, #110803); border: 1.5px solid #b07a3e; border-top: 0; border-radius: 0 0 10px 10px; box-shadow: 0 0 0 1.5px #0e0703, inset 0 -1px 0 rgba(255,210,150,.22), 0 6px 14px rgba(0,0,0,.6); }
.kca-stageplate.on { display: flex; }
.kca-stageplate::before, .kca-stageplate::after { content: ''; position: absolute; top: 22px; width: 9px; height: 9px; transform: rotate(45deg); background: linear-gradient(135deg, #ffe6a8, #b8702c); border: 1.5px solid #1a0a02; }
.kca-stageplate::before { left: 7px; } .kca-stageplate::after { right: 7px; }
.kca-stageplate .cap .forge { height: 13px; display: block; }
.kca-stageplate .num .forge { height: 40px; display: block; filter: drop-shadow(0 2px 2px #000); }
.kca-stageplate.nonum .num { display: none; }
.kca-stageplate .sn { max-width: 190px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; letter-spacing: .24em; color: #d8c09a; font-variant: small-caps; text-shadow: 0 1px 2px #000; }
.kca-stageplate .sn:empty { display: none; }
.kca-bosshp { position: fixed; bottom: 44px; left: 50%; width: min(640px, 58vw); transform: translateX(-50%); display: none; z-index: 2; } /* bosses r3: own bottom-centre slot (was inside the top HUD strip, over the STAGE plate) */
.kca-bosshp.on { display: block; } /* fade-in is driven by render-frame dt in Hud.update (a wall-clock CSS animation was caught missing/mid-fade by manual-clock captures) */
.kca-bosshp .nm { text-align: center; margin-bottom: 4px; } .kca-bosshp .nm .forge { height: 20px; }
.kca-bosshp .bar { height: 14px; padding: 2px; border: 1.5px solid #9a6a3a; background: #120804; border-radius: 3px; box-shadow: 0 0 0 1.5px #0a0502; position: relative; }
.kca-bosshp .pz { display: none; height: 5px; margin: 3px 4% 0; padding: 1px; border: 1px solid #6a4a2a; background: #120804; border-radius: 3px; position: relative; opacity: .92; } .kca-bosshp .pz.on { display: block; } .kca-bosshp .pz i { position: absolute; inset: 1px; transform-origin: left; will-change: transform; background: linear-gradient(90deg, #b8862e, #ffe6a0); } .kca-bosshp .pz.lock i { background: #7a6a58; } .kca-bosshp .pz.brk i { background: #fff; animation: kca-pzflash .24s steps(2) infinite; } @keyframes kca-pzflash { 50% { background: #ffb84a; } }
.kca-bosshp .bar i { position: absolute; inset: 2px; transform-origin: left; will-change: transform; } .kca-bosshp .bar .g { background: #ffe8c8; } .kca-bosshp .bar .f { background: linear-gradient(#ff9a7a, #c8201a 55%, #600806); }

/* ---------- GO arrow */
.kca-go { position: absolute; right: 56px; top: 40%; display: flex; align-items: center; gap: 4px; opacity: 0; pointer-events: none; }
.kca-go .forge { height: 64px; filter: drop-shadow(0 4px 4px #000) drop-shadow(0 0 20px rgba(255,170,60,.7)); }
.kca-go .arrows { display: flex; }
.kca-go .arrows svg { width: 40px; height: 64px; margin-left: -8px; filter: drop-shadow(0 4px 4px #000); }
.kca-go.on { opacity: 1; animation: kca-go-in .5s ${EASE}; }
.kca-go.on .arrows svg { animation: kca-chev 1s ease-in-out infinite; }
.kca-go.on .arrows svg:nth-child(2) { animation-delay: .12s; } .kca-go.on .arrows svg:nth-child(3) { animation-delay: .24s; }
.kca-go.on .word { animation: kca-go-bob 1s ease-in-out infinite; }
@keyframes kca-go-in { from { opacity: 0; transform: translateX(80px); } }
@keyframes kca-go-bob { 50% { transform: translateX(10px); } }
@keyframes kca-chev { 0%,100% { opacity: .25; transform: translateX(0); } 40% { opacity: 1; transform: translateX(10px); } }

/* ---------- cards (stage title, boss, big) */
.kca-card { position: absolute; left: 50%; top: 36%; transform: translate(-50%, -50%); text-align: center; opacity: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; will-change: transform, opacity; }
.kca-card .ribbon { position: relative; padding: 10px 70px 14px; }
.kca-card .ribbon::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(14,7,3,.82) 18%, rgba(14,7,3,.82) 82%, transparent); }
.kca-card .ribbon > * { position: relative; }
.kca-card .kicker .forge { height: 26px; filter: drop-shadow(0 2px 3px #000); }
.kca-card .main .forge { height: 76px; filter: drop-shadow(0 5px 5px rgba(0,0,0,.9)) drop-shadow(0 0 28px rgba(255,140,60,.35)); }
.kca-card .orn-rule { width: 760px; }
/* perf C1: the left-to-right wipe slides a hard-edged MASK (200 % wide gradient, opaque half → transparent half) instead
   of animating clip-path. Any wipe that clips the lettering geometrically (clip-path, or an overflow box) lets Chrome
   drop the lettering's raster tiles from the prewarm and re-rasterise the stroked forge SVG tile by tile as the edge
   uncovers it: 3 GPU-process raster flushes (147 / 55 / 103 ms, 39 StrokeTessellateOps) the moment the stage curtain
   lifted (reveal trace, tools/scenarios/revealtrace.mjs RT_SKIA=1). With the mask the lettering layer stays "visible",
   keeps its tiles, and only the cheap gradient mask repaints: largest flush 16 ms, reveal raster total 399 → 82 ms. */
.kca-card .main { overflow: hidden; will-change: transform; -webkit-mask-image: linear-gradient(90deg, #000 50%, transparent 50%); mask-image: linear-gradient(90deg, #000 50%, transparent 50%); -webkit-mask-size: 200% 100%; mask-size: 200% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: 100% 0; mask-position: 100% 0; }
.kca-card.in .main { animation: kca-wipe .7s .12s cubic-bezier(.3,.8,.3,1) forwards; }
@keyframes kca-wipe { to { -webkit-mask-position: 0 0; mask-position: 0 0; } }
.kca-card.big { top: 42%; }
.kca-card.big .main .forge { height: 150px; filter: drop-shadow(0 6px 0 #2a1204) drop-shadow(0 10px 14px rgba(0,0,0,.9)) drop-shadow(0 0 40px rgba(255,160,50,.45)); }
.kca-card.big .kicker .forge { height: 30px; }
.kca-card.big .kca-card-sub { font-size: 132px; line-height: 1; background-image: linear-gradient(180deg, #fff6d2, #ffd866 34%, #e09a34 58%, #8a4a16 86%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.kca-card.big .ribbon::before { display: none; }
.kca-card.big .main { -webkit-mask-image: none; mask-image: none; clip-path: inset(0 100% 0 0); } /* big card: no wipe — hidden until .in, then the slam (unchanged) */
.kca-card.big.in .main { animation: kca-slam .6s cubic-bezier(.2,1.4,.4,1) forwards; clip-path: none; }
@keyframes kca-slam { 0% { transform: scale(2.6); opacity: 0; filter: blur(6px); } 60% { opacity: 1; filter: none; } 100% { transform: none; opacity: 1; } }
.kca-veil { position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(ellipse 70% 38% at 50% 104%, rgba(255,110,30,.30), rgba(160,40,8,.12) 55%, transparent 80%),
    radial-gradient(ellipse at 50% 42%, rgba(40,14,4,.30) 0%, rgba(14,5,2,.74) 58%, rgba(4,1,0,.94) 100%),
    linear-gradient(rgba(10,4,2,.55), transparent 40%); }
.kca-veil::after { content: ''; position: absolute; inset: 0; background: linear-gradient(rgba(120,50,20,.22), rgba(60,20,6,.18)); mix-blend-mode: color; }
.kca-veil.on { opacity: 1; }
.kca-toast.top { bottom: auto; top: 118px; z-index: 5; }
.kca-toast { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); padding: 8px 22px; background: rgba(20,12,8,.85); border: 1px solid #7a5530; border-radius: 3px; font-size: 16px; letter-spacing: .14em; font-variant: small-caps; }
/* boss intro */
.kca-boss { position: absolute; left: 0; right: 0; top: 75%; height: 108px; pointer-events: none; } /* bosses C2 r12: lower third (was top 58%, 150px: the band covered every boss's hands/torso through the intro) */
.kca-boss .band { position: absolute; left: -5%; right: -5%; top: 0; height: 108px; transform: skewY(-4deg) scaleX(0); transform-origin: left; background: linear-gradient(90deg, rgba(40,4,2,.0), rgba(40,6,2,.9) 10%, rgba(20,3,1,.9) 50%, rgba(40,6,2,0) 82%);
  border-top: 2px solid #c8401a; border-bottom: 2px solid #c8401a; box-shadow: 0 0 40px rgba(200,40,10,.35); }
.kca-boss.in .band { animation: kca-band .45s cubic-bezier(.3,.9,.3,1) forwards; }
@keyframes kca-band { to { transform: skewY(-4deg) scaleX(1); } }
.kca-boss .txt { position: absolute; left: 14%; top: 12px; display: flex; flex-direction: column; gap: 4px; opacity: 0; transform: translateX(-60px); will-change: transform, opacity; }
.kca-boss.in .txt { animation: kca-slidein .6s .25s ${EASE} forwards; }
@keyframes kca-slidein { to { opacity: 1; transform: none; } }
.kca-boss .ep { font-size: 14px; letter-spacing: .5em; color: #ffb090; text-shadow: 0 2px 3px #000; font-variant: small-caps; }
.kca-boss .nm .forge { height: 54px; filter: drop-shadow(0 4px 4px #000) drop-shadow(0 0 24px rgba(255,80,30,.5)); }
.kca-boss.out { transition: opacity .5s; opacity: 0; }

/* ---------- title */
.kca-title { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 9vh;
  background: radial-gradient(ellipse at 50% 40%, rgba(10,4,2,.15) 20%, rgba(8,3,1,.78) 100%), linear-gradient(rgba(6,2,1,.45), transparent 30%, transparent 60%, rgba(6,2,1,.85)); }
.kca-title { isolation: isolate; }
.kca-title > .bd { position: absolute; inset: -3%; z-index: -1; pointer-events: none; background: url(${FB.replace("fonts/", "ui/")}title_backdrop.webp) center / cover no-repeat;
  animation: kca-bdzoom 90s ease-in-out infinite alternate; }
@keyframes kca-bdzoom { from { transform: scale(1.0) translateX(0); } to { transform: scale(1.06) translateX(-1.2%); } }
.kca-logo { position: relative; display: flex; flex-direction: column; align-items: center; opacity: 0; transform: scale(.9); }
.kca-title.in .kca-logo { animation: kca-logo 1.4s cubic-bezier(.2,1.2,.3,1) forwards; }
@keyframes kca-logo { 0% { opacity: 0; transform: scale(1.25); filter: blur(10px) brightness(3); } 50% { opacity: 1; filter: none; } 100% { opacity: 1; transform: none; } }
.kca-logo > :not(.backer) { position: relative; z-index: 1; }
.kca-logo .backer { position: absolute; left: 50%; top: -9vh; width: 0; height: 0; z-index: 0; pointer-events: none; }
.kca-logo .backer .banner { position: absolute; left: -190px; top: 0; width: 380px; height: calc(9vh + 330px); filter: drop-shadow(0 18px 22px rgba(0,0,0,.85));
  transform-origin: 50% 0; animation: kca-sway 7s ease-in-out infinite alternate; }
@keyframes kca-sway { from { transform: rotate(-.6deg) skewX(.4deg); } to { transform: rotate(.6deg) skewX(-.4deg); } }
.kca-logo .backer .slab { position: absolute; left: -600px; top: calc(9vh + 125px); width: 1200px; height: 240px; opacity: .95; }
.kca-logo .emb { position: relative; margin-bottom: 2px; z-index: 1; filter: drop-shadow(0 4px 6px rgba(0,0,0,.9)) drop-shadow(0 0 18px rgba(255,140,50,.35)); }
.kca-logo .emb .orn-knot { animation: kca-spin 40s linear infinite; }
@keyframes kca-spin { to { transform: rotate(360deg); } }
.kca-logo .l1 { display: flex; align-items: center; gap: 18px; }
.kca-logo .l1 .forge { height: 54px; filter: drop-shadow(0 4px 3px rgba(0,0,0,.95)); }
.kca-logo .l1 .orn-braid { width: 150px; height: 18px; filter: drop-shadow(0 2px 2px #000); }
.kca-logo .l2 .forge { height: 150px; filter: drop-shadow(0 7px 0 #1c0802) drop-shadow(0 12px 16px rgba(0,0,0,.95)) drop-shadow(0 0 50px rgba(255,120,40,.35)); }
.kca-logo .tag { margin-top: 8px; font-size: 19px; letter-spacing: .75em; padding-left: .75em; color: #e8d0a4; text-shadow: 0 2px 4px #000; font-variant: small-caps; }
.kca-logo .axe { position: absolute; right: -86px; top: 88px; width: 120px; transform: rotate(18deg); filter: drop-shadow(0 6px 6px #000); }
.kca-press { position: relative; margin-top: 7vh; height: 40px; padding: 8px 54px 0; isolation: isolate; animation: kca-pulse 1.4s ease-in-out infinite; }
.kca-press::before { content: ''; position: absolute; inset: -4px 0 -6px; z-index: -1; border-radius: 4px; border-top: 1.5px solid rgba(224,160,64,.55); border-bottom: 1.5px solid rgba(224,160,64,.55);
  background: linear-gradient(90deg, transparent, rgba(8,4,2,.9) 14%, rgba(8,4,2,.9) 86%, transparent); }
.kca-press .forge { height: 34px; filter: drop-shadow(0 3px 3px #000) drop-shadow(0 0 16px rgba(255,214,140,.7)) brightness(1.15); }
@keyframes kca-pulse { 50% { opacity: .72; } }
.kca-menuwrap { position: relative; isolation: isolate; margin-top: 4.5vh; padding: 12px 0 10px; display: flex; flex-direction: column; align-items: center; }
.kca-menuwrap::before { content: ''; position: absolute; inset: 0 -130px; z-index: -1; border-radius: 6px; border-top: 1.5px solid rgba(224,160,64,.4); border-bottom: 1.5px solid rgba(224,160,64,.4);
  background: linear-gradient(90deg, transparent, rgba(8,4,2,.88) 12%, rgba(8,4,2,.88) 88%, transparent); }
.kca-menuwrap.hidden, .kca-press.hidden { display: none; }
.kca-menu-in { animation: kca-in .45s cubic-bezier(.2,1.5,.35,1); }
.kca-credit { position: absolute; bottom: 22px; right: 34px; font-size: 16px; letter-spacing: .3em; color: #e8d0a4; text-shadow: 0 2px 3px #000; }
.kca-credit b { color: var(--gold); }
.kca-copy { position: absolute; bottom: 22px; left: 0; right: 0; text-align: center; font-size: 12px; letter-spacing: .35em; color: #bfa47c; text-shadow: 0 2px 3px #000; }
.kca-hs-mini { position: absolute; bottom: 22px; left: 34px; font-size: 13px; letter-spacing: .2em; color: #d8c09a; text-shadow: 0 2px 3px #000; }
.kca-hs-mini b { color: var(--gold); font-variant-numeric: tabular-nums; }
@keyframes kca-blink { 50% { opacity: .15; } }
@keyframes kca-in { from { opacity: 0; transform: scale(.9); } }
.kca-demo { position: absolute; top: 118px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; }
.kca-demo .d .forge { height: 38px; filter: drop-shadow(0 3px 3px #000); }
.kca-demo .p { animation: kca-blink 1.2s steps(1) infinite; } .kca-demo .p .forge { height: 22px; filter: drop-shadow(0 2px 2px #000); }
.kca-demo .bg { position: absolute; inset: -8px -80px; background: linear-gradient(90deg, transparent, rgba(10,5,2,.7) 25%, rgba(10,5,2,.7) 75%, transparent); z-index: -1; }
.kca-demo-logo { position: absolute; bottom: 26px; right: 32px; opacity: .9; } .kca-demo-logo .forge { height: 30px; }

/* ---------- character select */
.kca-select { display: flex; flex-direction: column; align-items: center; background: linear-gradient(rgba(4,2,1,.7), transparent 20%, transparent 58%, rgba(4,2,1,.88)); }
.kca-select .hd { margin-top: 26px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.kca-select .hd .forge { height: 40px; filter: drop-shadow(0 3px 3px #000); }
.kca-select .hd .orn-rule { width: 640px; }
.kca-select .timer { position: absolute; top: 26px; right: 40px; text-align: center; font-size: 12px; letter-spacing: .3em; color: #d8c09a; }
.kca-select .timer .forge { height: 44px; display: block; margin: 2px auto 0; }
.kca-cards { position: absolute; bottom: 46px; left: 0; right: 0; display: flex; justify-content: center; gap: 36px; }
@media (max-height: 800px) { .kca-cards { transform: scale(.8); transform-origin: 50% 100%; bottom: 40px; } } /* C2 r16: on short screens (720p) the fixed-size cards covered the centre hand's heel */
.kca-hcard { position: relative; width: 318px; padding: 12px 16px 10px; transition: transform .35s ${EASE}, box-shadow .3s; transform: translateY(4px) scale(.96); }
.kca-hcard.hov { transform: translateY(-6px) scale(1); }
.kca-hcard.hov.p1 { box-shadow: 0 0 0 1px #0a0503, 0 0 0 5px #2a180c, 0 0 0 6px var(--p1), 0 0 34px rgba(255,150,60,.45), 0 18px 40px rgba(0,0,0,.7), inset 0 0 40px rgba(0,0,0,.65); }
.kca-hcard.hov.p2 { box-shadow: 0 0 0 1px #0a0503, 0 0 0 5px #2a180c, 0 0 0 6px var(--p2), 0 0 34px rgba(80,160,255,.45), 0 18px 40px rgba(0,0,0,.7), inset 0 0 40px rgba(0,0,0,.65); }
.kca-hcard.hov.p1.p2 { box-shadow: 0 0 0 1px #0a0503, 0 0 0 5px #2a180c, -4px 0 0 6px var(--p1), 4px 0 0 6px var(--p2), 0 18px 40px rgba(0,0,0,.7), inset 0 0 40px rgba(0,0,0,.65); }
.kca-hcard .top { display: flex; gap: 12px; align-items: center; }
.kca-hcard .nm .forge { height: 26px; filter: drop-shadow(0 2px 2px #000); }
.kca-hcard .ttl { font-size: 14.5px; letter-spacing: .1em; color: #d8b888; font-variant: small-caps; margin-top: 3px; white-space: nowrap; } /* C2 r16: one line (the card is ~60 px shorter so the centre hand's heel clears it) */
.kca-hcard p { margin: 6px 0 6px; font-size: 13.5px; line-height: 1.4; color: #ecdcbc; }
.kca-hcard .el .n { margin-left: auto; display: flex; align-items: center; gap: 4px; color: #bfe2ff; }
.kca-stats { display: grid; grid-template-columns: 64px 1fr 64px 1fr; gap: 5px 9px; align-items: center; font-size: 13.5px; letter-spacing: .1em; color: #c8ae84; font-variant: small-caps; } /* C2 r16: 2 x 2 (was 4 rows) */
.kca-stats .pips { display: flex; gap: 3px; }
.kca-stats .pips i { flex: 1; height: 8px; transform: skewX(-20deg); background: #2a1a10; border: 1px solid #4a3020; }
.kca-stats .pips i.on { background: linear-gradient(#ffe0a0, #e08a3a 60%, #8a3a0a); border-color: #1a0a02; box-shadow: 0 0 6px rgba(255,160,60,.45); }
.kca-hcard .el { margin-top: 7px; display: flex; align-items: center; gap: 8px; font-size: 13.5px; letter-spacing: .12em; white-space: nowrap; font-variant: small-caps; color: var(--elc, #ffcf80); }
.kca-hcard .el .orn-pot { width: 12px; height: 16px; }
.kca-hcard .el .gem { width: 14px; height: 14px; transform: rotate(45deg); background: radial-gradient(circle at 35% 35%, #fff, var(--elc) 50%, #000 130%); border: 1.5px solid #120803; box-shadow: 0 0 8px var(--elc); }
.kca-flag { position: absolute; top: -34px; width: 50px; height: 60px; display: none; z-index: 3; filter: drop-shadow(0 3px 3px #000); transition: transform .3s ${EASE}; }
.kca-flag.on { display: block; animation: kca-flag .4s ${EASE}; }
.kca-flag.f1 { left: 16px; } .kca-flag.f2 { right: 16px; }
@keyframes kca-flag { from { transform: translateY(-30px); opacity: 0; } }
.kca-flag svg { width: 100%; height: 100%; }
.kca-stamp { position: absolute; right: -12px; top: -25px; padding: 3px 15px 2px; border-radius: 3px; border: 2px solid var(--p1); background: linear-gradient(#2a180c, #0c0603); box-shadow: 0 0 0 1px #0a0503, 0 6px 14px rgba(0,0,0,.7), 0 0 22px rgba(255,150,60,.35);
  transform: rotate(-4deg) scale(2.2); opacity: 0; transition: transform .3s cubic-bezier(.3,1.6,.4,1), opacity .15s; pointer-events: none; z-index: 4; }
.kca-stamp.on { opacity: 1; transform: rotate(-4deg) scale(1); }
.kca-stamp .forge { height: 22px; display: block; }
.kca-hcard.p1.p2 .kca-stamp.s1 { right: auto; left: 70px; } .kca-hcard.p1.p2 .kca-stamp.s2 { left: auto; right: 70px; } /* both players on one card: the plaques sit between the two flags */
.kca-stamp.s2.on { transform: rotate(3deg) scale(1); }
.kca-stamp.s2 { right: auto; left: -12px; transform: rotate(3deg) scale(2.2); border-color: var(--p2); box-shadow: 0 0 0 1px #0a0503, 0 6px 14px rgba(0,0,0,.7), 0 0 22px rgba(80,160,255,.35); }
.kca-hcard.locked:not(.hov) { filter: saturate(.55) brightness(.8); } /* a readied hero's card dims once its cursor leaves; the READY plaque is hung above the card, never over text */
.kca-select .kca-btnrow { position: absolute; bottom: 16px; left: 0; right: 0; }
.kca-select .join2 { position: absolute; top: 108px; right: 60px; font-size: 14px; letter-spacing: .35em; color: var(--p2); text-shadow: 0 2px 3px #000; animation: kca-blink 1.2s steps(1) infinite; }

/* ---------- pause / options / overlays */
.kca-dim { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(10,5,2,.55), rgba(4,2,1,.88)); backdrop-filter: blur(3px) saturate(.6); animation: kca-fade .25s; }
@keyframes kca-fade { from { opacity: 0; } }
.kca-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.kca-pause .kca-panel { padding: 30px 70px 26px; min-width: 460px; display: flex; flex-direction: column; align-items: center; gap: 14px; animation: kca-in .3s ${EASE}; }
.kca-pause .hd .forge { height: 44px; filter: drop-shadow(0 3px 3px #000); }
.kca-opts .kca-panel { padding: 28px 44px 22px; width: 760px; display: flex; flex-direction: column; gap: 10px; animation: kca-in .3s ${EASE}; }
.kca-opts .hd { text-align: center; } .kca-opts .hd .forge { height: 40px; }
.kca-orow { display: grid; grid-template-columns: 250px 1fr; align-items: center; height: 44px; padding: 0 18px; border-radius: 3px; transition: background .2s; position: relative; }
.kca-orow .k { font-size: 17px; letter-spacing: .22em; font-variant: small-caps; color: #cdb48a; }
.kca-orow.sel { background: linear-gradient(90deg, rgba(255,170,80,.18), rgba(255,170,80,.02)); }
.kca-orow.sel .k { color: #ffe0a8; text-shadow: 0 0 10px rgba(255,160,60,.5); }
.kca-orow.sel::before { content: ''; position: absolute; left: -2px; top: 8px; bottom: 8px; width: 3px; background: var(--gold); box-shadow: 0 0 8px var(--gold); }
.kca-orow .v { display: flex; align-items: center; gap: 14px; justify-content: flex-end; font-size: 16px; letter-spacing: .2em; font-variant: small-caps; color: #f4e6c8; }
.kca-orow .v .arr { color: #8a6a44; font-size: 13px; } .kca-orow.sel .v .arr { color: var(--gold); }
.kca-seg { display: flex; gap: 3px; } .kca-seg i { width: 16px; height: 16px; transform: skewX(-16deg); background: #241810; border: 1px solid #4a3020; }
.kca-seg i.on { background: linear-gradient(#ffe8b0, #e0903a 60%, #8a3a0a); border-color: #1a0a02; }
.kca-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 20px; padding: 12px 18px 4px; font-size: 12.5px; letter-spacing: .12em; color: #c8ae84; border-top: 1px solid rgba(200,150,90,.25); margin-top: 6px; }
.kca-controls b { color: #ffe0b0; font-weight: 400; } .kca-controls h4 { grid-column: 1/-1; margin: 0 0 4px; font-weight: 400; letter-spacing: .3em; font-variant: small-caps; color: #e0c898; font-size: 13px; }

/* ---------- tally */
.kca-tally .kca-panel { padding: 26px 50px 22px; width: 820px; display: flex; flex-direction: column; gap: 6px; animation: kca-in .4s ${EASE}; }
.kca-tally .hd { text-align: center; } .kca-tally .hd .k .forge { height: 22px; } .kca-tally .hd .m .forge { height: 50px; }
.kca-tally .hd .k, .kca-hs .hd .k { line-height: 0; margin-bottom: 9px; } .kca-tally .hd { margin-bottom: 12px; } .kca-hs .hd .forge { display: block; margin: 0 auto; }
.kca-tally .hd .m .forge, .kca-hs .hd > .forge { display: block; margin: 0 auto; }
.kca-tcols { display: grid; gap: 40px; margin-top: 6px; }
.kca-tally .kca-panel.duo { width: min(1160px, 94vw); }
.kca-tally .kca-panel.duo .kca-trow { font-size: 15px; letter-spacing: .12em; }
.kca-tcol h5 { margin: 0 0 8px; display: flex; align-items: center; gap: 10px; font-weight: 400; } .kca-tcol h5 .forge { height: 18px; }
.kca-tbody { display: grid; grid-template-columns: 1fr 132px; gap: 20px; align-items: stretch; }
.kca-trow { display: flex; justify-content: space-between; height: 30px; align-items: center; font-size: 16px; letter-spacing: .18em; font-variant: small-caps; color: #d8c09a; border-bottom: 1px solid rgba(200,150,90,.14); opacity: 0; transform: translateX(-16px); transition: opacity .2s, transform .3s ${EASE}; }
.kca-trow.on { opacity: 1; transform: none; }
.kca-rrule { margin-top: 14px; text-align: center; font-size: 16.5px; line-height: 1.5; letter-spacing: .04em; font-style: italic; color: #dcc397; text-shadow: 0 1px 2px #000; }
.kca-rrule .cl { opacity: 0; } .kca-rrule.on .cl { opacity: 1; }
.kca-rrule .saga { font-size: 17.5px; letter-spacing: .05em; color: #e6cfa0; }
.kca-rrule .cl { font-style: normal; color: #f0d79e; font-size: 17px; letter-spacing: .1em; margin-top: 2px; font-variant: small-caps; }
.kca-trow.info { height: 24px; font-size: 14.5px; color: #c4a67e; } .kca-trow.info b { color: #e8d4a8; font-weight: 500; } .kca-tally .kca-panel.duo .kca-trow.info { font-size: 14.5px; }
.kca-trow b { font-variant-numeric: tabular-nums; color: #ffe8b8; font-weight: 700; letter-spacing: .08em; }
.kca-trow.total { border-bottom: 0; border-top: 1px solid rgba(255,200,120,.4); font-size: 18px; color: #ffe0a0; margin-top: 4px; }
.kca-trow.total b { color: var(--gold); font-size: 22px; }
.kca-tcol { position: relative; }
/* rating plaque: its own reserved column — caption band on top, letter in a sunken well below; never overlaps rows */
.kca-rate { display: grid; grid-template-rows: auto 1fr; border: 1.5px solid #9a6a3a; border-radius: 4px; overflow: hidden;
  background: radial-gradient(ellipse at 50% 60%, rgba(120,60,20,.35), transparent 70%), linear-gradient(#1c1008, #0c0603); box-shadow: 0 0 0 1.5px #0e0703, inset 0 0 18px rgba(0,0,0,.8); }
.kca-rate small { display: block; padding: 5px 0 4px; text-align: center; font-size: 12px; font-weight: 700; letter-spacing: .42em; padding-left: .42em; color: #f0d8a8;
  background: linear-gradient(#5a3418, #2e1a0a); border-bottom: 1.5px solid #9a6a3a; }
.kca-rate .well { position: relative; display: grid; place-items: center; min-height: 118px; }
.kca-rate .well .forge { height: 76px; opacity: 0; transform: scale(3) rotate(-14deg); filter: drop-shadow(0 4px 3px #000) drop-shadow(0 0 22px rgba(255,180,60,.55)); }
.kca-rate.on .well .forge { animation: kca-stampin .45s cubic-bezier(.3,1.5,.4,1) forwards; }
.kca-rate.on { border-color: #e0a860; box-shadow: 0 0 0 1.5px #0e0703, inset 0 0 18px rgba(0,0,0,.8), 0 0 18px rgba(255,170,70,.35); transition: box-shadow .3s, border-color .3s; }
@keyframes kca-stampin { to { opacity: 1; transform: rotate(-6deg); } }

/* ---------- map interlude */
.kca-map { display: grid; place-items: center; overflow: hidden; background: #160a04; }
.kca-map > .desk { position: absolute; inset: 0; z-index: 0; background: url(${FB.replace('fonts/', 'ui/')}desk.webp) center / cover, #2a1608; } /* r7: baked oak planks + lamp pool (blender/ui_desk_paint.py) */
.kca-map > .desk::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 50% 46% at 18% 4%, rgba(255,196,110,.34), rgba(255,160,70,.1) 52%, transparent 78%); mix-blend-mode: screen; animation: kca-lampflick 3.7s ease-in-out infinite; }
@keyframes kca-lampflick { 0%, 100% { opacity: .92; } 18% { opacity: 1; } 41% { opacity: .86; } 63% { opacity: .98; } 82% { opacity: .9; } }
.kca-map > .sheet, .kca-map > .deskshadow { grid-area: 1 / 1; }
.kca-map .deskshadow { position: relative; z-index: 1; width: min(1320px, 92vw); aspect-ratio: 16/9; max-height: 88vh; transform: rotate(-.6deg); box-shadow: 18px 30px 60px rgba(0,0,0,.82), 4px 6px 12px rgba(0,0,0,.7); }
.kca-map .sheet { position: relative; z-index: 2; width: min(1320px, 92vw); aspect-ratio: 16/9; max-height: 88vh; transform: rotate(-.6deg); animation: kca-unroll .9s cubic-bezier(.2,1,.3,1); overflow: hidden; }
@keyframes kca-unroll { from { clip-path: inset(0 50% 0 50%); } to { clip-path: inset(0 0 0 0); } }
.kca-map svg.mapsvg { position: absolute; inset: 0; width: 100%; height: 100%; }
.kca-map img.relief { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .5s; user-select: none; } .kca-map img.relief.on { opacity: 1; }
/* lamp-lit sheet: a warm pool from the lamp (upper left), the far corner falls into shadow, and the paper edge lifts off the desk */
.kca-map .sheet .lamp { position: absolute; inset: 0; pointer-events: none; z-index: 3; background: radial-gradient(ellipse 66% 80% at 6% 0%, rgba(255,226,150,.66), rgba(255,190,100,.26) 46%, transparent 80%); mix-blend-mode: screen; animation: kca-lampflick 3.7s ease-in-out infinite; }
.kca-map .sheet .lamp::after { content: ''; position: absolute; inset: 0; background: linear-gradient(118deg, transparent 26%, rgba(40,16,2,.40) 58%, rgba(22,8,0,.72) 100%); mix-blend-mode: multiply; }
.kca-map .sheet .wear { position: absolute; inset: 0; pointer-events: none; z-index: 3; box-shadow: inset 0 0 90px rgba(80,36,8,.5), inset 0 0 14px rgba(50,20,2,.55), inset 2px 2px 0 rgba(255,236,190,.22), inset -3px -3px 6px rgba(30,10,0,.4); }
.kca-map .ring .pulse { transform-box: fill-box; transform-origin: center; animation: kca-ringp 2.4s ease-out infinite; }
@keyframes kca-ringp { from { transform: scale(1); opacity: .9; } to { transform: scale(1.4); opacity: 0; } }
.kca-map .route { stroke-dasharray: 3000; stroke-dashoffset: 3000; }
.kca-map .cap { position: absolute; left: 0; right: 0; bottom: 3.5%; text-align: center; pointer-events: none; }
.kca-map .cap::before, .kca-map .title::before { content: ''; position: absolute; left: 50%; top: 50%; width: 760px; height: 150%; transform: translate(-50%, -50%); z-index: -1;
  background: radial-gradient(closest-side, rgba(234,217,176,.98) 62%, rgba(234,217,176,.9) 76%, rgba(234,217,176,0) 100%); }
.kca-map .cap, .kca-map .title { isolation: isolate; }
.kca-map .cap .k { font-size: 15px; letter-spacing: .5em; color: #5a3010; font-variant: small-caps; margin-bottom: 6px; }
.kca-map .cap .forge { height: 52px; filter: drop-shadow(0 2px 1px rgba(60,20,0,.5)); }
.kca-map .title { position: absolute; top: 5%; left: 0; right: 0; text-align: center; padding: 6px 0; }
.kca-map .title::before { width: 860px; height: 170%; } .kca-map .title .forge { height: 34px; }

/* ---------- ranking (YOUR STRENGTH) */
.kca-rank { background: radial-gradient(ellipse at 50% 40%, #3a2112, #130a05 85%); display: grid; place-items: center; grid-template-rows: 100%; grid-template-columns: 100%; } /* r6: explicit 100% track — a sheet taller than the viewport used to grow the auto track downward, so the --fit scale (about the centre) pushed the PERFECT! seal off-screen at 720p */
.kca-rank .sheet { position: relative; width: 1180px; padding: 34px 50px 30px; display: grid; grid-template-columns: 1.1fr 1fr; gap: 20px 72px; transform: scale(var(--fit, 1)); }
.kca-rank h2 { margin: 0 0 10px; text-align: center; } .kca-rank h2 .forge { height: 40px; }
.kca-rank table { width: 100%; border-collapse: collapse; font-size: 16.5px; letter-spacing: .1em; color: #3a1e08; }
.kca-rank th { font-weight: 400; font-variant: small-caps; letter-spacing: .25em; font-size: 13px; color: #6a3c14; border-bottom: 2px solid #8a5a2a; padding: 4px 6px; text-align: right; }
.kca-rank td { padding: 8px 6px; border-bottom: 1px solid rgba(120,70,30,.25); text-align: right; font-variant-numeric: tabular-nums; }
.kca-rank th:first-child, .kca-rank td:first-child { text-align: left; }
.kca-rank td .sn { display: inline-block; width: 22px; margin-right: 8px; text-align: center; font-weight: 700; color: #8a2a10; border-right: 1px solid rgba(120,70,30,.35); }
.kca-rank td .sn.camp { color: #a8895a; font-weight: 400; }
.kca-rank tr.tot td { border-top: 2px solid #8a5a2a; border-bottom: 0; font-weight: 700; }
.kca-rank .strength { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 2px; color: #5a3010; } .kca-rank .strength .cap { font-variant: small-caps; letter-spacing: .5em; padding-left: .5em; font-size: 17px; }
.kca-rank .strength .forge { height: 58px; }
.kca-rank .epitaph { margin: 14px auto 10px; max-width: 470px; text-align: center; font-size: 17.5px; line-height: 1.45; letter-spacing: .05em; color: #3a1c06; font-style: italic; }
.kca-rank .deeds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 14px 8px 6px; }
.kca-rank .deeds > div { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px 10px; border: 1px solid rgba(110,56,18,.55); border-radius: 3px; background: linear-gradient(rgba(150,90,40,.16), rgba(150,90,40,.05)); box-shadow: inset 0 0 14px rgba(90,40,10,.22); }
.kca-rank .deeds b { font-size: 34px; line-height: 1; font-weight: 700; color: #7a2208; text-shadow: 0 1px 0 rgba(255,230,180,.5); font-variant-numeric: tabular-nums; }
.kca-rank .deeds span { font-variant: small-caps; letter-spacing: .26em; font-size: 13.5px; color: #4a2608; padding-left: .26em; }
.kca-rank .roadcap { margin: 10px 0 0; text-align: center; font-variant: small-caps; letter-spacing: .34em; font-size: 14px; color: #6a3c14; }
.kca-rank .roadmap { position: relative; height: 112px; margin: 0 auto; max-width: 476px; }
.kca-rank .roadmap svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.kca-rank .wp { position: absolute; width: 0; display: flex; flex-direction: column; align-items: center; }
.kca-rank .wn { flex: none; width: 38px; height: 38px; margin-left: 0; display: grid; place-items: center; border-radius: 50%; border: 1.8px dashed #a88a5c; color: #a88a5c; font-size: 19px; background: rgba(240,222,176,.55); }
.kca-rank .wp.on .wn { border: 2px solid #3a1204; background: radial-gradient(circle at 35% 30%, #a8421e, #6a1c08 70%); color: #f6e2b0; font-weight: 700; box-shadow: inset 0 0 0 2px rgba(232,200,138,.55), 0 2px 3px rgba(60,20,0,.4); }
.kca-rank .wl { margin-top: 5px; white-space: nowrap; font-variant: small-caps; letter-spacing: .14em; font-size: 14.5px; color: #a88a5c; } .kca-rank .wp.on .wl { color: #5a2208; }
.kca-rank .tk { display: flex; gap: 3px; margin-top: 3px; } .kca-rank .tk i { width: 2.5px; height: 14px; background: #a8321a; transform: rotate(18deg); border-radius: 1px; }
.kca-rank .waxline { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 26px; }
.kca-rank .wax { flex: none; width: 78px; height: 78px; border-radius: 50% 46% 52% 48% / 48% 52% 46% 50%; display: grid; place-items: center; color: #f4d8a0; font-size: 31px; letter-spacing: .04em; text-shadow: 0 -1px 0 rgba(40,6,0,.7), 0 1px 0 rgba(255,190,120,.35);
  background: radial-gradient(circle at 35% 30%, #d8553a 0%, #a8321a 38%, #6e1608 100%); box-shadow: inset 0 0 0 4px rgba(120,20,6,.55), inset 0 0 0 5.5px rgba(240,150,100,.35), 0 3px 5px rgba(60,10,0,.45); }
.kca-rank .waxtxt { font-size: 16.5px; line-height: 1.55; letter-spacing: .1em; color: #4a2608; text-align: left; font-variant: small-caps; } .kca-rank .waxtxt i { font-variant: normal; letter-spacing: .06em; color: #5a3010; font-size: 16px; }
.kca-rank .fate { margin-top: 12px; text-align: center; font-size: 15.5px; letter-spacing: .08em; font-style: italic; color: #4a2608; }
.kca-rank .sheet.kca-parch, .kca-rank .kca-parch { background: ${PARCH}, radial-gradient(ellipse at 50% 45%, #fbefd0 0%, #efdaaa 60%, #d9b27a 100%); box-shadow: inset 0 0 36px rgba(110,56,18,.34), inset 0 0 6px rgba(60,20,0,.5), 0 20px 50px rgba(0,0,0,.6); }
.kca-rank table { color: #24100a; } .kca-rank th { color: #4a2608; border-bottom-color: #6a3c14; } .kca-rank td { border-bottom-color: rgba(100,56,24,.38); }
.kca-rank .kca-ladder td.t { color: #3e200a; }
.kca-rank .kca-ladder td { padding: 11.5px 6px; font-size: 17.5px; }
.kca-rank .verdict { margin-top: 18px; text-align: center; font-variant: small-caps; letter-spacing: .22em; font-size: 16px; color: #5a3010; } .kca-rank .verdict b { font-size: 22px; color: #8a2a10; letter-spacing: .12em; }
.kca-ladder { position: relative; font-size: 14px; }
.kca-ladder td { padding: 2px 8px; } .kca-ladder td.c { font-weight: 700; letter-spacing: .12em; text-align: left; width: 90px; } .kca-ladder td.t { text-align: left; font-style: italic; color: #5a3212; }
.kca-ladder tr.me td { color: #7a0e04; background: rgba(196,64,26,.20); box-shadow: inset 0 1px 0 rgba(150,40,14,.35), inset 0 -1px 0 rgba(150,40,14,.35); }
.kca-ladder tr.me td.c { box-shadow: inset 4px 0 0 #a8321a, inset 0 1px 0 rgba(150,40,14,.35), inset 0 -1px 0 rgba(150,40,14,.35); }
.kca-ladder tr.me td:last-child { box-shadow: inset -4px 0 0 rgba(168,50,26,.55), inset 0 1px 0 rgba(150,40,14,.35), inset 0 -1px 0 rgba(150,40,14,.35); }
.kca-rank .cur { position: absolute; left: -54px; top: 20px; filter: drop-shadow(0 2px 2px rgba(60,20,0,.6)); }
/* PERFECT! lives in its own reserved foot band (between two rules), never over the ledger */
.kca-rank .foot.has-perfect { display: flex; align-items: center; justify-content: center; gap: 18px; min-height: 124px; }
.kca-rank .foot.has-perfect .orn-rule { flex: 1 1 0; min-width: 0; }
.kca-rank .perfect { flex: none; opacity: 0; transform: scale(2.4) rotate(-4deg); }
.kca-rank .perfect.on { animation: kca-perfect .6s cubic-bezier(.3,1.5,.4,1) forwards; }
@keyframes kca-perfect { to { opacity: 1; transform: rotate(-4deg) scale(1); } }
.kca-rank .perfect .seal { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 34px 12px; border: 2px solid #8a2a10; border-radius: 6px;
  background: radial-gradient(ellipse at 50% 40%, rgba(255,200,140,.35), rgba(140,40,10,.12) 70%); box-shadow: inset 0 0 0 3px rgba(240,220,180,.5), inset 0 0 0 4.5px #8a2a10; }
.kca-rank .perfect .forge { height: 76px; filter: drop-shadow(0 4px 2px rgba(60,10,0,.55)); }
.kca-rank .perfect small { font-size: 12px; letter-spacing: .3em; color: #7a1e08; font-variant: small-caps; font-style: italic; }
.kca-rank .foot { grid-column: 1/-1; text-align: center; }

/* ---------- high scores */
.kca-hs { background: radial-gradient(ellipse at 50% 30%, rgba(30,14,6,.7), rgba(6,2,1,.94) 80%); display: grid; place-items: center; }
.kca-hs .kca-panel { width: 780px; padding: 28px 56px 24px; animation: kca-in .4s ${EASE}; }
.kca-hs .hd { text-align: center; margin-bottom: 10px; } .kca-hs .hd .forge { height: 46px; } .kca-hs .hd .k .forge { height: 18px; }
.kca-hs table { width: 100%; border-collapse: collapse; font-size: 19px; letter-spacing: .14em; }
.kca-hs td { padding: 5px 8px; font-variant-numeric: tabular-nums; color: #e8d4ac; border-bottom: 1px solid rgba(200,150,90,.13); }
.kca-hs td.r { width: 60px; color: #a88a60; font-variant: small-caps; } .kca-hs td.i { font-weight: 700; letter-spacing: .35em; color: #ffe0a0; } .kca-hs td.s { text-align: right; color: var(--gold); }
.kca-hs td.h { width: 44px; } .kca-hs td.h .orn-crest { vertical-align: middle; } .kca-hs td.st { color: #b89868; font-size: 14px; text-align: center; }
.kca-hs tr.new td { background: linear-gradient(90deg, rgba(255,180,80,.22), rgba(255,180,80,.03)); animation: kca-blinksoft 1s ease-in-out infinite; }
@keyframes kca-blinksoft { 50% { color: #fff; } }
.kca-hs tr:nth-child(1) td.r, .kca-hs tr:nth-child(1) td.i { color: #fff0b0; }
.kca-entry { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.kca-entry .slots { display: flex; gap: 18px; }
.kca-entry .slot { position: relative; width: 86px; height: 110px; display: grid; place-items: center; border-bottom: 3px solid #6a4a2a; }
.kca-entry .slot .forge { height: 76px; }
.kca-entry .slot.cur { border-bottom-color: var(--gold); } .kca-entry .slot.cur .forge { animation: kca-float 1s ease-in-out infinite; }
.kca-entry .slot.cur::before, .kca-entry .slot.cur::after { content: ''; position: absolute; left: 50%; border: 9px solid transparent; transform: translateX(-50%); }
.kca-entry .slot.cur::before { top: -18px; border-bottom-color: var(--gold); } .kca-entry .slot.cur::after { bottom: -24px; border-top-color: var(--gold); }
@keyframes kca-float { 50% { transform: translateY(-5px); } }
.kca-entry .who { font-size: 16px; letter-spacing: .3em; font-variant: small-caps; color: #e0c898; }
.kca-entry .who b { color: var(--pcol, var(--p1)); }
.kca-entry .sc2 { font-size: 26px; font-weight: 700; color: var(--gold); letter-spacing: .1em; font-variant-numeric: tabular-nums; }
`;

let injected = false;
export function injectStyles() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'kca-ui-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
  // C2 r15 (board r14 'EB Garamond 400 italic: unloaded' while the ranking uses italic titles): preload the italic face with the three upright weights,
  // otherwise the first italic run synthesises a faux-italic until the lazy fetch lands.
  if (document.fonts && document.fonts.load) {
    for (const w of [400, 500, 700]) document.fonts.load(`${w} 16px "EB Garamond"`).catch(() => {});
    document.fonts.load('italic 400 16px "EB Garamond"').catch(() => {});
  }
}
