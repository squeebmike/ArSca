// ByteRider_97 -- The Mana Pocket's mascot, from the SHATTERKID comic
// universe (store, 2026-11-02, character spec). A living late-1990s CRT
// monitor: translucent teal shell, purple side panel, charcoal trim,
// neon-green buttons, a nearly black curved screen with scanlines, lime
// digital eyes and mouth, a wiggly antenna. No arms, hands, legs or feet:
// the whole monitor is the character -- he bounces, tilts, shakes, floats,
// squashes and stretches.
//
// A reusable component with its own state machine: play(state) runs a
// reaction once and returns to idle; reactions queue so simultaneous events
// never break an animation; long quiet spells put him to sleep. It knows
// nothing about Whatnot -- the overlay (scripts/live-studio-overlay.mjs)
// maps events to reactions -- so the storefront and dashboard can use it too.
// SVG + CSS transforms/opacity only (cheap while streaming).

export const MASCOT_STATES = ['idle', 'happy', 'talking', 'surprised', 'jackpot', 'glitch', 'sleeping', 'alert', 'countdown', 'celebrating', 'disappearing'];
// How long a one-off reaction plays before going back to idle (ms).
const LENGTH = { happy: 1800, talking: 2200, surprised: 1400, jackpot: 3200, glitch: 1300, alert: 2200, countdown: 5000, celebrating: 2800, disappearing: 2000, sleeping: 0, idle: 0 };
// Higher goes first when several are waiting.
const PRIORITY = { jackpot: 5, celebrating: 4, disappearing: 4, alert: 3, countdown: 3, surprised: 2, happy: 2, talking: 1, glitch: 1 };
// SHATTERKID easter eggs: rare, small, never the plot.
export const EASTER_EGGS = ['RE:MIND', 'PRIMARY USER', 'SYSTEM REWIND', '1997'];
export const BOOT_LINES = ['BYTE-BIOS v1.997', 'MEMORY CHECK ... OK', 'PRIMARY USER: FOUND', 'LOADING BYTERIDER_97'];

const C = { teal: '#2bd4c6', tealDark: '#159c92', purple: '#7b3fe4', char: '#1f2529', lime: '#b6ff3a', screen: '#05080a' };
export const BYTERIDER_SVG = `<svg class="br-svg" viewBox="0 0 220 230" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
 <pattern id="br-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#ffffff" opacity=".05"/></pattern>
 <radialGradient id="br-glow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="${C.lime}" stop-opacity=".22"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></radialGradient>
 <linearGradient id="br-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ff5ea" stop-opacity=".92"/><stop offset=".55" stop-color="${C.teal}" stop-opacity=".82"/><stop offset="1" stop-color="${C.tealDark}" stop-opacity=".9"/></linearGradient>
 <clipPath id="br-screen-clip"><rect x="46" y="68" width="118" height="88" rx="16"/></clipPath>
</defs>
<g class="br-antenna"><path d="M150 50 Q156 26 176 14" fill="none" stroke="${C.char}" stroke-width="5" stroke-linecap="round"/><circle cx="177" cy="13" r="7" fill="${C.lime}" stroke="${C.char}" stroke-width="3"/></g>
<rect x="20" y="44" width="176" height="150" rx="28" fill="url(#br-shell)" stroke="${C.char}" stroke-width="6"/>
<path d="M44 52 L176 52" stroke="#ffffff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
<g stroke="${C.char}" stroke-width="3" stroke-linecap="round"><path d="M70 47 v-0"/><path d="M84 48 l14 0 M84 54 l14 0 M118 48 l14 0 M118 54 l14 0"/></g>
<rect x="182" y="66" width="12" height="104" rx="6" fill="${C.purple}" stroke="${C.char}" stroke-width="3"/>
<rect x="36" y="60" width="138" height="104" rx="22" fill="${C.char}"/>
<rect class="br-screen" x="46" y="68" width="118" height="88" rx="16" fill="${C.screen}"/>
<g clip-path="url(#br-screen-clip)">
 <rect class="br-glow" x="46" y="68" width="118" height="88" fill="url(#br-glow)"/>
 <g class="br-face">
  <g class="br-eyes br-eyes-normal" fill="${C.lime}"><rect class="br-eye" x="72" y="88" width="16" height="26" rx="6"/><rect class="br-eye" x="122" y="88" width="16" height="26" rx="6"/></g>
  <g class="br-eyes br-eyes-happy" fill="none" stroke="${C.lime}" stroke-width="6" stroke-linecap="round"><path d="M70 104 Q80 90 90 104"/><path d="M120 104 Q130 90 140 104"/></g>
  <g class="br-eyes br-eyes-wide" fill="${C.lime}"><circle cx="80" cy="100" r="13"/><circle cx="130" cy="100" r="13"/><circle cx="80" cy="100" r="5" fill="${C.screen}"/><circle cx="130" cy="100" r="5" fill="${C.screen}"/></g>
  <g class="br-eyes br-eyes-dollar" fill="${C.lime}" font-family="monospace" font-weight="900" font-size="34" text-anchor="middle"><text x="80" y="112">$</text><text x="130" y="112">$</text></g>
  <g class="br-eyes br-eyes-closed" fill="none" stroke="${C.lime}" stroke-width="5" stroke-linecap="round"><path d="M70 102 Q80 108 90 102"/><path d="M120 102 Q130 108 140 102"/></g>
  <g class="br-mouth br-m-smile" fill="none" stroke="${C.lime}" stroke-width="5" stroke-linecap="round"><path d="M92 130 Q105 140 118 130"/></g>
  <g class="br-mouth br-m-grin" fill="${C.lime}"><path d="M86 126 Q105 150 124 126 Z"/></g>
  <g class="br-mouth br-m-o" fill="${C.lime}"><ellipse cx="105" cy="134" rx="9" ry="11"/></g>
  <g class="br-mouth br-m-flat" stroke="${C.lime}" stroke-width="5" stroke-linecap="round"><path d="M94 134 L116 134"/></g>
  <g class="br-mouth br-m-talk" fill="${C.lime}"><ellipse class="br-talk-a" cx="105" cy="133" rx="12" ry="4"/><ellipse class="br-talk-b" cx="105" cy="133" rx="10" ry="9"/><ellipse class="br-talk-c" cx="105" cy="133" rx="6" ry="6"/></g>
 </g>
 <text class="br-screen-text" x="105" y="116" text-anchor="middle" font-family="monospace" font-weight="700" font-size="13" fill="${C.lime}"></text>
 <rect x="46" y="68" width="118" height="88" fill="url(#br-scan)"/>
 <rect class="br-static" x="46" y="68" width="118" height="88" fill="#ffffff"/>
</g>
<rect x="46" y="68" width="118" height="88" rx="16" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3"/>
<circle cx="58" cy="176" r="5" fill="${C.lime}" stroke="${C.char}" stroke-width="2"/><circle cx="74" cy="176" r="5" fill="${C.lime}" stroke="${C.char}" stroke-width="2"/>
<circle class="br-led" cx="160" cy="176" r="4" fill="#39ff6a"/>
<path d="M78 194 L142 194 L132 210 L88 210 Z" fill="${C.char}"/>
</svg>`;

// --- The state machine (no DOM): what to show now, what waits next. ---
export function createMascotMachine({ now = () => Date.now(), sleepAfterMs = 5 * 60000 } = {}) {
  let current = { state: 'idle', text: '', until: 0 }, queue = [], lastActivity = now();
  const length = (state, text, ms) => ms ?? Math.max(LENGTH[state] ?? 1500, text ? 900 + String(text).length * 55 : 0);
  return {
    get current() { return current; },
    get queue() { return queue.slice(); },
    // Ask for a reaction. Returns what is showing now.
    play(state, { text = '', ms } = {}) {
      if (!MASCOT_STATES.includes(state)) state = 'happy';
      lastActivity = now();
      const item = { state, text: String(text || '').slice(0, 120), ms: length(state, text, ms) };
      if (state === 'idle' || state === 'sleeping') { queue = []; current = { state, text: item.text, until: 0 }; return current; }
      const busy = current.until > now() && current.state !== 'idle' && current.state !== 'sleeping';
      if (!busy) { current = { state, text: item.text, until: now() + item.ms }; return current; }
      queue.push(item);
      queue.sort((a, b) => (PRIORITY[b.state] || 0) - (PRIORITY[a.state] || 0));
      if (queue.length > 4) queue.length = 4; // the least important are dropped
      return current;
    },
    // Called on a timer: moves on when a reaction is done; sleeps when quiet.
    tick() {
      const t = now();
      if (current.until && t >= current.until) {
        const next = queue.shift();
        current = next ? { state: next.state, text: next.text, until: t + next.ms } : { state: 'idle', text: '', until: 0 };
        lastActivity = t;
      }
      if (current.state === 'idle' && !queue.length && sleepAfterMs > 0 && t - lastActivity >= sleepAfterMs) current = { state: 'sleeping', text: '', until: 0 };
      return current;
    },
    wake() { lastActivity = now(); if (current.state === 'sleeping') current = { state: 'idle', text: '', until: 0 }; return current; },
  };
}

// --- The character on a page. ---
// host: an element to fill. Returns { play, say, wake, show, destroy }.
export function createByteRider(host, { sleepAfterMs = 5 * 60000, eggEveryMs = 60000, eggChance = 1 / 45, random = Math.random } = {}) {
  host.classList.add('byterider');
  host.innerHTML = `<div class="br-bubble" hidden></div><div class="br-rig"><div class="br-motion">${BYTERIDER_SVG}</div><div class="br-zzz" aria-hidden="true"><i>Z</i><i>Z</i><i>z</i></div><div class="br-fx" aria-hidden="true"></div></div>`;
  const bubble = host.querySelector('.br-bubble'), fx = host.querySelector('.br-fx'), screenText = host.querySelector('.br-screen-text');
  const machine = createMascotMachine({ sleepAfterMs });
  let shown = '', screenTimer = null;
  const burst = (colors, n = 14) => {
    fx.replaceChildren();
    for (let i = 0; i < n; i++) { const p = document.createElement('i'); const a = (i / n) * Math.PI * 2; p.style.setProperty('--dx', Math.round(Math.cos(a) * (70 + (i % 3) * 25)) + 'px'); p.style.setProperty('--dy', Math.round(Math.sin(a) * (60 + (i % 4) * 20) - 30) + 'px'); p.style.background = colors[i % colors.length]; fx.append(p); }
    setTimeout(() => fx.replaceChildren(), 1400);
  };
  const flashScreen = (lines, each = 420) => {
    clearTimeout(screenTimer);
    let i = 0;
    const step = () => { screenText.textContent = lines[i] || ''; host.classList.toggle('br-screen-on', i < lines.length); if (i++ < lines.length) screenTimer = setTimeout(step, each); };
    step();
  };
  const render = cur => {
    if (cur.state !== shown) {
      host.classList.remove(...MASCOT_STATES.map(s => 'br-' + s));
      host.classList.add('br-' + cur.state);
      shown = cur.state;
      if (cur.state === 'jackpot') burst(['#b6ff3a', '#7b3fe4', '#22e6ff', '#ffe23d'], 18);
      if (cur.state === 'celebrating') burst(['#b6ff3a', '#7b3fe4'], 16);
    }
    if (cur.text) { bubble.textContent = cur.text; bubble.hidden = false; } else bubble.hidden = true;
  };
  const loop = setInterval(() => render(machine.tick()), 200);
  // Now and then while idle: a SHATTERKID glitch.
  const eggs = setInterval(() => {
    if (machine.current.state !== 'idle' || random() >= eggChance) return;
    render(machine.play('glitch', { ms: 1400 }));
    flashScreen([EASTER_EGGS[Math.floor(random() * EASTER_EGGS.length)]], 1200);
  }, eggEveryMs);
  render(machine.current);
  return {
    machine,
    play(state, opts = {}) {
      render(machine.play(state, opts));
      if (state === 'disappearing' && opts.boot) setTimeout(() => flashScreen(BOOT_LINES, 380), 900);
    },
    say(text, ms) { render(machine.play('talking', { text, ms })); },
    wake() { render(machine.wake()); },
    show(on) { host.hidden = !on; },
    destroy() { clearInterval(loop); clearInterval(eggs); clearTimeout(screenTimer); host.replaceChildren(); },
  };
}
