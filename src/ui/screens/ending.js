// Chapter 1 ending overlay (driven by src/game/ending.js): letterbox bars, forged captions, epilogue prose, a fade
// veil, the credits roll (with the batted-into-the-sky block) and the closing prompt. Pure DOM over the 3D scene.
//   const s = await ui.show('ending', { onSkip })
//   s.bars(on) · s.caption(kicker, title, { metal, sub }) · s.prose(lines, { hold }) · s.clear() · s.fade(on, seconds)
//   s.credits(blocks, seconds) → { el, batEl }   (batEl = the block the grunt bats) · s.bat() · s.prompt(text)
import { forge } from '../lettering.js';
import { h, CONFIRM } from '../widgets.js';

const CSS = `
.kca-screen-ending{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:"EB Garamond","Palatino Linotype","Book Antiqua",Georgia,serif;color:#f2e2c0}
.kca-end .bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height 1.2s cubic-bezier(.4,0,.2,1);z-index:3}
.kca-end .bar.t{top:0}.kca-end .bar.b{bottom:0}
.kca-end.bars .bar{height:10.5%}
.kca-end .veil{position:absolute;inset:0;background:#000;opacity:0;z-index:5;transition-property:opacity;transition-timing-function:ease}
.kca-end .veil.on{opacity:1}
.kca-end .cap{position:absolute;left:0;right:0;top:15%;text-align:center;z-index:4;opacity:0;transform:translateY(10px);transition:opacity .35s,transform .45s}
.kca-end .cap.on{opacity:1;transform:none}
.kca-end .cap .k svg{height:calc(20px*var(--uiz,1));filter:drop-shadow(0 2px 6px #000)}
.kca-end .cap .m svg{height:calc(64px*var(--uiz,1));filter:drop-shadow(0 4px 14px #000)}
.kca-end .cap .s{margin-top:calc(8px*var(--uiz,1));font-style:italic;font-size:calc(20px*var(--uiz,1));text-shadow:0 2px 8px #000}
.kca-end .prose{position:absolute;left:12%;right:12%;bottom:16%;text-align:center;z-index:4}
.kca-end .prose p{margin:calc(8px*var(--uiz,1)) 0;font-size:calc(24px*var(--uiz,1));line-height:1.45;font-style:italic;text-shadow:0 2px 10px #000,0 0 30px rgba(0,0,0,.8);opacity:0;transition:opacity .4s}
.kca-end .prose p.on{opacity:1}
.kca-end .rollwrap{position:absolute;inset:0;z-index:4;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 9%,#000 44%,transparent 58%);mask-image:linear-gradient(to bottom,transparent 0,#000 9%,#000 44%,transparent 58%)}
.kca-end .roll{position:absolute;left:0;right:0;top:0;text-align:center;will-change:transform}
.kca-end .roll .blk{margin:0 auto calc(54px*var(--uiz,1));width:60%}
.kca-end .roll .blk .r svg{height:calc(15px*var(--uiz,1));filter:drop-shadow(0 2px 5px #000)}
.kca-end .roll .blk .n{font-size:calc(24px*var(--uiz,1));margin-top:calc(6px*var(--uiz,1));text-shadow:0 2px 8px #000}
.kca-end .roll .blk .n small{display:block;font-size:.72em;opacity:.8;font-style:italic}
.kca-end .roll .blk.title svg{height:calc(70px*var(--uiz,1))}
.kca-end .roll .blk.batted{animation:kcaBat 1.6s cubic-bezier(.2,.6,.4,1) forwards}
@keyframes kcaBat{0%{transform:translate(0,0) rotate(0)}12%{transform:translate(4%,-6%) rotate(-8deg) scale(1.05)}100%{transform:translate(38%,-160%) rotate(-540deg) scale(.05);opacity:0}}
.kca-end .star{position:absolute;width:calc(10px*var(--uiz,1));height:calc(10px*var(--uiz,1));border-radius:50%;background:#fff;box-shadow:0 0 18px 8px #fff8d0;z-index:4;opacity:0;animation:kcaTw 1.2s ease-out forwards}
@keyframes kcaTw{0%{opacity:0;transform:scale(.2)}30%{opacity:1;transform:scale(1.4)}100%{opacity:0;transform:scale(.4)}}
.kca-end .pr{position:absolute;left:0;right:0;bottom:4%;text-align:center;z-index:4;opacity:0;transition:opacity .8s;letter-spacing:.3em;font-size:calc(15px*var(--uiz,1));color:#d8c090}
.kca-end .pr.on{opacity:1;animation:kcaBlink 1.6s infinite}
@keyframes kcaBlink{50%{opacity:.35}}
`;

export default {
  id: 'ending',
  create(ui, opts = {}) {
    if (!document.getElementById('kca-end-css')) { const s = document.createElement('style'); s.id = 'kca-end-css'; s.textContent = CSS; document.head.appendChild(s); }
    const el = h('<div class="kca-end"><div class="bar t"></div><div class="bar b"></div><div class="cap"></div><div class="prose"></div><div class="rollwrap"><div class="roll"></div></div><div class="pr"></div><div class="veil"></div></div>');
    const cap = el.querySelector('.cap'), prose = el.querySelector('.prose'), roll = el.querySelector('.roll'), veil = el.querySelector('.veil'), pr = el.querySelector('.pr');
    let rollT = -1, rollDur = 1, rollH = 0, batEl = null, timers = [], now = 0;
    // sim-time timers (deterministic under the capture clock)
    const later = (ms, fn) => timers.push({ at: now + ms / 1000, fn });
    const api = {
      el,
      bars(on) { el.classList.toggle('bars', !!on); },
      caption(kicker, title, { metal = 'gold', sub = '' } = {}) {
        cap.classList.remove('on');
        cap.innerHTML = `${kicker ? `<div class="k">${forge(kicker, { metal: 'bronze', track: 18 })}</div>` : ''}<div class="m">${forge(title, { metal, track: 12, glint: 2.4 })}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
        later(20, () => cap.classList.add('on'));
      },
      uncaption() { cap.classList.remove('on'); },
      /** Epilogue lines fade in one after another (stagger in seconds of UI time). */
      prose(lines, { stagger = 2.2 } = {}) {
        prose.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
        [...prose.children].forEach((p, i) => later(200 + i * stagger * 1000, () => p.classList.add('on')));
      },
      clear() { cap.classList.remove('on'); [...prose.children].forEach((p) => p.classList.remove('on')); },
      fade(on, seconds = 1) { veil.style.transitionDuration = `${seconds}s`; veil.classList.toggle('on', !!on); },
      /** blocks: [{ role, name, sub?, title?, bat? }] — scrolls bottom → top over `seconds` (sim-driven via update). */
      credits(blocks, seconds = 24) {
        roll.innerHTML = blocks.map((b, i) => b.title
          ? `<div class="blk title" data-i="${i}">${forge(b.title, { metal: 'gold', track: 14, glint: 2.6 })}${b.sub ? `<div class="n"><small>${b.sub}</small></div>` : ''}</div>`
          : `<div class="blk${b.bat ? ' bat' : ''}" data-i="${i}"><div class="r">${forge(b.role, { metal: b.bat ? 'ember' : 'bronze', track: 14 })}</div><div class="n">${b.name}${b.sub ? `<small>${b.sub}</small>` : ''}</div></div>`).join('');
        batEl = roll.querySelector('.blk.bat');
        rollT = 0; rollDur = seconds; rollH = 0;
        return { el: roll, batEl };
      },
      /** Screen-space y (0..1 of the viewport) of the batted block's centre, for syncing the 3D swing. */
      batY() { if (!batEl) return 2; const r = batEl.getBoundingClientRect(), H = el.getBoundingClientRect().height || innerHeight; return (r.top + r.height / 2) / H; },
      bat() {
        if (!batEl || batEl.classList.contains('batted')) return;
        const r = batEl.getBoundingClientRect(), R = el.getBoundingClientRect();
        batEl.classList.add('batted');
        later(1450, () => { const s = document.createElement('div'); s.className = 'star'; s.style.left = `${(r.left - R.left + r.width * 0.5 + R.width * 0.24)}px`; s.style.top = `${Math.max(8, r.top - R.top - R.height * 0.55)}px`; el.appendChild(s); later(1300, () => s.remove()); });
      },
      /** Pause the roll where it is (the grunt's moment). */
      hold(on) { this._hold = !!on; },
      prompt(text) { pr.textContent = text; pr.classList.add('on'); },
      tick(dt) { // driven per sim tick by src/game/ending.js (not the UI render loop)
        now += Math.min(dt, 0.1);
        for (let i = timers.length - 1; i >= 0; i--) if (now >= timers[i].at) { const t = timers.splice(i, 1)[0]; try { t.fn(); } catch (e) { /* ignore */ } }
        if (rollT < 0) return;
        if (!this._hold) rollT += Math.min(dt, 0.1);
        const H = el.getBoundingClientRect().height || innerHeight;
        if (!rollH) rollH = roll.scrollHeight;
        const k = Math.min(1, rollT / rollDur);
        roll.style.transform = `translateY(${H - k * (H + rollH)}px)`;
      },
      onAction(player, action) { if (CONFIRM.includes(action) && opts.onSkip) opts.onSkip(action); return true; },
      dispose() { timers = []; },
    };
    return api;
  },
};
