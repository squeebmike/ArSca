// ByteRider_97 -- The Mana Pocket's mascot, the store's own character from
// its SHATTERKID comic universe (store, 2026-11-02). A living late-1990s CRT
// monitor -- and on stream, the phone screen IS the monitor (store: "I want
// his face on the screen. The border of the phone is his border. No square
// around him. No antenna. Think glitch version of Face from Nick Jr 90s tv").
// So: the whole 1080 x 1920 frame gets his bezel (translucent teal, charcoal
// trim, purple accent, neon-green buttons, scanlines, CRT corner fuzz), and
// his big lime digital face pops onto the screen when he reacts, glitching in
// and out, so the cameras stay clear the rest of the time.
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

const C = { teal: '#2bd4c6', purple: '#7b3fe4', char: '#1f2529', lime: '#b6ff3a' };
// His face, drawn around (0,0); the overlay places and sizes it.
const FACE = `
 <g class="br-eyes br-eyes-normal" fill="${C.lime}"><rect class="br-eye" x="-255" y="-215" width="110" height="190" rx="44"/><rect class="br-eye" x="145" y="-215" width="110" height="190" rx="44"/></g>
 <g class="br-eyes br-eyes-happy" fill="none" stroke="${C.lime}" stroke-width="36" stroke-linecap="round"><path d="M-265 -90 Q-200 -220 -135 -90"/><path d="M135 -90 Q200 -220 265 -90"/></g>
 <g class="br-eyes br-eyes-wide" fill="${C.lime}"><circle cx="-200" cy="-120" r="115"/><circle cx="200" cy="-120" r="115"/><circle cx="-200" cy="-120" r="42" fill="#05080a"/><circle cx="200" cy="-120" r="42" fill="#05080a"/></g>
 <g class="br-eyes br-eyes-dollar" fill="${C.lime}" font-family="'Press Start 2P',monospace" font-weight="900" font-size="230" text-anchor="middle"><text x="-200" y="-20">$</text><text x="200" y="-20">$</text></g>
 <g class="br-eyes br-eyes-closed" fill="none" stroke="${C.lime}" stroke-width="32" stroke-linecap="round"><path d="M-265 -110 Q-200 -60 -135 -110"/><path d="M135 -110 Q200 -60 265 -110"/></g>
 <g class="br-mouth br-m-smile" fill="none" stroke="${C.lime}" stroke-width="36" stroke-linecap="round"><path d="M-160 150 Q0 280 160 150"/></g>
 <g class="br-mouth br-m-grin" fill="${C.lime}"><path d="M-210 120 Q0 380 210 120 Z"/></g>
 <g class="br-mouth br-m-o" fill="${C.lime}"><ellipse cx="0" cy="210" rx="72" ry="92"/></g>
 <g class="br-mouth br-m-flat" stroke="${C.lime}" stroke-width="34" stroke-linecap="round"><path d="M-120 210 L120 210"/></g>
 <g class="br-mouth br-m-talk" fill="${C.lime}"><ellipse class="br-talk-a" cx="0" cy="205" rx="130" ry="26"/><ellipse class="br-talk-b" cx="0" cy="205" rx="110" ry="80"/><ellipse class="br-talk-c" cx="0" cy="205" rx="66" ry="56"/></g>`;
// The whole frame: his bezel at the screen's edge, his face in the middle.
export const BYTERIDER_SVG = `<svg class="br-svg" viewBox="0 0 1080 1920" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
 <pattern id="br-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000000" opacity=".22"/></pattern>
 <radialGradient id="br-fuzz" cx="50%" cy="50%" r="75%"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
</defs>
<g class="br-frame">
 <rect class="br-scanlines" x="0" y="0" width="1080" height="1920" fill="url(#br-scan)"/>
 <rect class="br-vignette" x="0" y="0" width="1080" height="1920" fill="url(#br-fuzz)"/>
 <rect class="br-bezel" x="12" y="12" width="1056" height="1896" rx="70" fill="none" stroke="${C.teal}" stroke-opacity=".78" stroke-width="24"/>
 <rect x="27" y="27" width="1026" height="1866" rx="56" fill="none" stroke="${C.char}" stroke-width="7"/>
 <path d="M140 16 H940" stroke="#ffffff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
 <rect x="1058" y="620" width="14" height="680" rx="7" fill="${C.purple}"/>
 <g stroke="${C.char}" stroke-width="4" stroke-linecap="round"><path d="M470 8 h40 M530 8 h40 M470 18 h40 M530 18 h40"/></g>
 <circle cx="470" cy="1905" r="7" fill="${C.lime}" stroke="${C.char}" stroke-width="2"/><circle cx="496" cy="1905" r="7" fill="${C.lime}" stroke="${C.char}" stroke-width="2"/>
 <circle class="br-led" cx="610" cy="1905" r="6" fill="#39ff6a"/>
</g>
<g class="br-place"><g class="br-motion"><g class="br-face">${FACE}</g></g></g>
<rect class="br-static" x="0" y="0" width="1080" height="1920" fill="#ffffff"/>
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
  host.innerHTML = `${BYTERIDER_SVG}<div class="br-bubble" hidden></div><div class="br-screen-text" aria-hidden="true"></div><div class="br-zzz" aria-hidden="true"><i>Z</i><i>Z</i><i>z</i></div><div class="br-fx" aria-hidden="true"></div>`;
  const bubble = host.querySelector('.br-bubble'), fx = host.querySelector('.br-fx'), screenText = host.querySelector('.br-screen-text'), placeG = host.querySelector('.br-place');
  const machine = createMascotMachine({ sleepAfterMs });
  let shown = '', screenTimer = null;
  const burst = (colors, n = 14) => {
    fx.replaceChildren();
    for (let i = 0; i < n; i++) { const p = document.createElement('i'); const a = (i / n) * Math.PI * 2; p.style.setProperty('--dx', Math.round(Math.cos(a) * (260 + (i % 3) * 90)) + 'px'); p.style.setProperty('--dy', Math.round(Math.sin(a) * (240 + (i % 4) * 70)) + 'px'); p.style.background = colors[i % colors.length]; fx.append(p); }
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
      if (cur.state === 'jackpot') burst(['#b6ff3a', '#7b3fe4', '#22e6ff', '#ffe23d'], 22);
      if (cur.state === 'celebrating') burst(['#b6ff3a', '#7b3fe4'], 20);
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
    // Where his face sits (its center, in the 1080 x 1920 frame), how big
    // (percent), whether the bezel shows, and whether a faint face stays
    // up between reactions.
    place({ y = 900, scale = 100, border = true, idleFace = false } = {}) {
      const s = Math.max(0.3, Math.min(1.6, scale / 100));
      placeG.setAttribute('transform', `translate(540 ${Math.round(y)}) scale(${s})`);
      host.style.setProperty('--br-face-y', Math.round(y) + 'px');
      host.style.setProperty('--br-face-s', s);
      host.classList.toggle('br-no-border', !border);
      host.classList.toggle('br-idle-face', !!idleFace);
    },
    destroy() { clearInterval(loop); clearInterval(eggs); clearTimeout(screenTimer); host.replaceChildren(); },
  };
}
