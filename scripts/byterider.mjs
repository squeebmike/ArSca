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

export const MASCOT_STATES = ['idle', 'happy', 'talking', 'surprised', 'jackpot', 'glitch', 'sleeping', 'alert', 'countdown', 'celebrating', 'disappearing',
  // Added 2026-11-02 (store: "Add more reactions?").
  'smug', 'wink', 'love', 'dizzy', 'angry', 'sad', 'laughing', 'thinking'];
// How long a one-off reaction plays before going back to idle (ms).
const LENGTH = { happy: 1800, talking: 2200, surprised: 1400, jackpot: 3200, glitch: 1300, alert: 2200, countdown: 5000, celebrating: 2800, disappearing: 2000, sleeping: 0, idle: 0,
  smug: 2000, wink: 1400, love: 2200, dizzy: 2200, angry: 1800, sad: 2200, laughing: 2200, thinking: 2400 };
// Higher goes first when several are waiting.
const PRIORITY = { jackpot: 5, celebrating: 4, disappearing: 4, alert: 3, countdown: 3, love: 3, surprised: 2, happy: 2, dizzy: 2, laughing: 2, smug: 2, angry: 2, talking: 1, glitch: 1, wink: 1, sad: 1, thinking: 1 };
// SHATTERKID easter eggs: rare, small, never the plot.
export const EASTER_EGGS = ['RE:MIND', 'PRIMARY USER', 'SYSTEM REWIND', '1997'];
export const BOOT_LINES = ['BYTE-BIOS v1.997', 'MEMORY CHECK ... OK', 'PRIMARY USER: FOUND', 'LOADING BYTERIDER_97'];

const C = { teal: '#2bd4c6', purple: '#7b3fe4', char: '#1f2529', lime: '#b6ff3a', screen: '#05080a' };
// His face is built from chunky pixels (store: "Better more recognizable less
// generic face"). His look: one eye half-lidded and bored, the other wide
// open under a raised brow, a lopsided smirk with one pixel fang, and his
// _97 tag with a blinking cursor. A digital troublemaker, not a smiley.
const P = 34; // one face pixel
const grid = (rows, x0, y0, cls = '') => rows.map((r, y) => [...r].map((c, x) => c === '#' ? `<rect${cls ? ` class="${cls}"` : ''} x="${x0 + x * P}" y="${y0 + y * P}" width="${P - 2}" height="${P - 2}"/>` : '').join('')).join('');
const EYES = {
  // Signature: left eye half-lidded under a flat brow; right eye wide with a
  // pupil and a raised, skeptical brow.
  sig: grid(['#####', '.....', '.....', '#####', '#####', '#####'], -320, -330) + grid(['...###', '###...', '......', '#####', '#####', '##.##', '#####', '#####'], 140, -400),
  half: grid(['#####', '.....', '.....', '#####', '#####'], -320, -330) + grid(['....##', '..##..', '##....', '.....', '#####', '#####'], 140, -400),
  wink: grid(['.....', '.....', '.....', '.....', '#####', '.###.'], -320, -330) + grid(['...###', '###...', '......', '#####', '#####', '##.##', '#####', '#####'], 140, -400),
  happy: grid(['.###.', '#...#', '#...#'], -320, -220) + grid(['.###.', '#...#', '#...#'], 150, -220),
  wide: grid(['.###.', '#####', '##.##', '#####', '.###.'], -320, -300) + grid(['.###.', '#####', '##.##', '#####', '.###.'], 150, -300),
  closed: grid(['#####'], -320, -150) + grid(['#####'], 150, -150),
  love: grid(['.#.#.', '#####', '#####', '.###.', '..#..'], -320, -300) + grid(['.#.#.', '#####', '#####', '.###.', '..#..'], 150, -300),
  x: grid(['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], -320, -300) + grid(['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], 150, -300),
  angry: grid(['##...', '.##..', '.....', '##...', '####.', '#####'], -320, -330) + grid(['...##', '..##.', '.....', '...##', '.####', '#####'], 150, -330),
  sad: grid(['...##', '.##..', '.....', '#####', '#####', '#####'], -320, -300) + grid(['##...', '..##.', '.....', '#####', '#####', '#####'], 150, -300),
  laugh: grid(['#....', '.##..', '...##', '.##..', '#....'], -320, -300) + grid(['....#', '..##.', '##...', '..##.', '....#'], 150, -300),
  think: grid(['#####', '##.##', '#####', '#####'], -320, -330) + grid(['#####', '##.##', '#####', '#####'], 150, -330) + grid(['#.#.#'], 120, -480, 'br-think-dots'),
};
const MOUTHS = {
  smirk: grid(['..........##', '.........##.', '#.......##..', '.########...', '...#........'], -200, 90),
  grin: grid(['#.........#', '##.......##', '.#########.', '..#######..'], -185, 90),
  o: grid(['.##.', '#..#', '#..#', '.##.'], -68, 110),
  flat: grid(['#######'], -119, 170),
  talk: `<g class="br-talk-a">${grid(['########'], -136, 170)}</g><g class="br-talk-b">${grid(['.######.', '#......#', '#......#', '.######.'], -136, 110)}</g><g class="br-talk-c">${grid(['.####.', '#....#', '.####.'], -102, 130)}</g>`,
  teeth: grid(['#.#.#.#.#', '.#.#.#.#.'], -153, 150),
  frown: grid(['.#######.', '#.......#'], -153, 160),
  wavy: grid(['.##..##..##', '#..##..##..'], -187, 150),
};
// Which eyes and mouth each reaction wears.
export const FACE_FOR = {
  idle: ['sig', 'smirk'], happy: ['happy', 'grin'], talking: ['sig', 'talk'], surprised: ['wide', 'o'], jackpot: ['dollar', 'grin'],
  glitch: ['sig', 'smirk'], sleeping: ['closed', 'flat'], alert: ['wide', 'flat'], countdown: ['wide', 'o'], celebrating: ['happy', 'grin'],
  disappearing: ['sig', 'smirk'], smug: ['half', 'smirk'], wink: ['wink', 'smirk'], love: ['love', 'grin'], dizzy: ['x', 'wavy'],
  angry: ['angry', 'teeth'], sad: ['sad', 'frown'], laughing: ['laugh', 'grin'], thinking: ['think', 'flat'],
};
const FACE = `<g fill="${C.lime}">` +
  Object.entries(EYES).map(([k, v]) => `<g class="br-eyes" data-eyes="${k}">${v}</g>`).join('') +
  `<g class="br-eyes" data-eyes="dollar" font-family="'Press Start 2P',monospace" font-size="210" text-anchor="middle"><text x="-235" y="-60">$</text><text x="235" y="-60">$</text></g>` +
  Object.entries(MOUTHS).map(([k, v]) => `<g class="br-mouth" data-mouth="${k}">${v}</g>`).join('') +
  `<g class="br-tag"><text x="110" y="335" font-family="'Press Start 2P',monospace" font-size="42">_97</text><rect class="br-cursor" x="262" y="300" width="26" height="38"/></g></g>`;
const FRAME = `<g class="br-frame">
 <rect class="br-scanlines" x="0" y="0" width="1080" height="1920" fill="url(#br-scan)"/>
 <rect class="br-vignette" x="0" y="0" width="1080" height="1920" fill="url(#br-fuzz)"/>
 <rect class="br-bezel" x="12" y="12" width="1056" height="1896" rx="70" fill="none" stroke="${C.teal}" stroke-opacity=".78" stroke-width="24"/>
 <rect x="27" y="27" width="1026" height="1866" rx="56" fill="none" stroke="${C.char}" stroke-width="7"/>
 <path d="M140 16 H940" stroke="#ffffff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
 <rect x="1058" y="620" width="14" height="680" rx="7" fill="${C.purple}"/>
 <g stroke="${C.char}" stroke-width="4" stroke-linecap="round"><path d="M470 8 h40 M530 8 h40 M470 18 h40 M530 18 h40"/></g>
 <circle cx="470" cy="1905" r="7" fill="${C.lime}" stroke="${C.char}" stroke-width="2"/><circle cx="496" cy="1905" r="7" fill="${C.lime}" stroke="${C.char}" stroke-width="2"/>
 <circle class="br-led" cx="610" cy="1905" r="6" fill="#39ff6a"/>
</g>`;
const DEFS = `<defs>
 <pattern id="br-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000000" opacity=".22"/></pattern>
 <radialGradient id="br-fuzz" cx="50%" cy="50%" r="75%"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
</defs>`;
// On stream: the whole frame is his monitor; his face pops onto it.
export const BYTERIDER_SVG = `<svg class="br-svg" viewBox="0 0 1080 1920" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
${DEFS}${FRAME}
<g class="br-place"><g class="br-motion"><g class="br-face">${FACE}</g></g></g>
<rect class="br-static" x="0" y="0" width="1080" height="1920" fill="#ffffff"/>
</svg>`;
// Anywhere smaller (dashboard, website): a little screen, and again its
// border is his border -- the same bezel, his face always on.
export const BYTERIDER_BADGE_SVG = `<svg class="br-svg" viewBox="-470 -560 940 1060" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
${DEFS}
<rect class="br-bezel" x="-440" y="-530" width="880" height="1000" rx="130" fill="${C.screen}" stroke="${C.teal}" stroke-opacity=".9" stroke-width="44"/>
<rect x="-410" y="-500" width="820" height="940" rx="104" fill="none" stroke="${C.char}" stroke-width="12"/>
<rect x="-410" y="-500" width="820" height="940" rx="104" fill="url(#br-scan)"/>
<rect x="436" y="-200" width="22" height="380" rx="11" fill="${C.purple}"/>
<circle cx="-60" cy="470" r="14" fill="${C.lime}"/><circle cx="-14" cy="470" r="14" fill="${C.lime}"/><circle class="br-led" cx="120" cy="470" r="12" fill="#39ff6a"/>
<g class="br-place"><g class="br-motion"><g class="br-face">${FACE}</g></g></g>
<rect class="br-static" x="-410" y="-500" width="820" height="940" rx="104" fill="#ffffff"/>
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
// mode: 'screen' (the stream: the whole frame is his monitor) or 'badge'
// (a little screen of his own, for the dashboard and website).
export function createByteRider(host, { mode = 'screen', sleepAfterMs = 5 * 60000, eggEveryMs = 60000, eggChance = 1 / 45, random = Math.random } = {}) {
  host.classList.add('byterider', mode === 'badge' ? 'br-badge' : 'br-screen');
  host.innerHTML = `${mode === 'badge' ? BYTERIDER_BADGE_SVG : BYTERIDER_SVG}<div class="br-bubble" hidden></div><div class="br-screen-text" aria-hidden="true"></div><div class="br-zzz" aria-hidden="true"><i>Z</i><i>Z</i><i>z</i></div><div class="br-fx" aria-hidden="true"></div>`;
  const bubble = host.querySelector('.br-bubble'), fx = host.querySelector('.br-fx'), screenText = host.querySelector('.br-screen-text'), placeG = host.querySelector('.br-place');
  const machine = createMascotMachine({ sleepAfterMs });
  let shown = '', screenTimer = null;
  const burst = (colors, n = 14) => {
    fx.replaceChildren();
    for (let i = 0; i < n; i++) { const p = document.createElement('i'); const a = (i / n) * Math.PI * 2, k = mode === 'badge' ? 0.3 : 1; p.style.setProperty('--dx', Math.round(Math.cos(a) * (260 + (i % 3) * 90) * k) + 'px'); p.style.setProperty('--dy', Math.round(Math.sin(a) * (240 + (i % 4) * 70) * k) + 'px'); p.style.background = colors[i % colors.length]; fx.append(p); }
    setTimeout(() => fx.replaceChildren(), 1400);
  };
  const flashScreen = (lines, each = 420) => {
    clearTimeout(screenTimer);
    let i = 0;
    const step = () => { screenText.textContent = lines[i] || ''; host.classList.toggle('br-screen-on', i < lines.length); if (i++ < lines.length) screenTimer = setTimeout(step, each); };
    step();
  };
  const parts = [...host.querySelectorAll('.br-eyes,.br-mouth')];
  const wear = state => {
    const [eyes, mouth] = FACE_FOR[state] || FACE_FOR.idle;
    for (const g of parts) g.style.display = (g.dataset.eyes ? g.dataset.eyes === eyes : g.dataset.mouth === mouth) ? '' : 'none';
  };
  const render = cur => {
    if (cur.state !== shown) {
      host.classList.remove(...MASCOT_STATES.map(s => 'br-' + s));
      host.classList.add('br-' + cur.state);
      wear(cur.state);
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
      if (mode === 'badge') return;
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
