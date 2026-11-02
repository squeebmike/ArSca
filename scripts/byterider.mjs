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
  'smug', 'wink', 'love', 'dizzy', 'angry', 'sad', 'laughing', 'thinking',
  // From the store's ByteRider_97 Overlay Face Pack (2026-11-02).
  'excited', 'cool', 'shocked', 'suspicious', 'error', 'loading', 'processing', 'remind'];
// How long a one-off reaction plays before going back to idle (ms).
const LENGTH = { happy: 1800, talking: 2200, surprised: 1400, jackpot: 3200, glitch: 1300, alert: 2200, countdown: 5000, celebrating: 2800, disappearing: 2000, sleeping: 0, idle: 0,
  smug: 2000, wink: 1400, love: 2200, dizzy: 2200, angry: 1800, sad: 2200, laughing: 2200, thinking: 2400,
  excited: 2000, cool: 2200, shocked: 1800, suspicious: 2200, error: 1800, loading: 1800, processing: 2400, remind: 1800 };
// Higher goes first when several are waiting.
const PRIORITY = { jackpot: 5, celebrating: 4, disappearing: 4, alert: 3, countdown: 3, love: 3, shocked: 3, excited: 2, surprised: 2, happy: 2, dizzy: 2, laughing: 2, smug: 2, angry: 2, cool: 2,
  talking: 1, glitch: 1, wink: 1, sad: 1, thinking: 1, suspicious: 1, error: 1, loading: 1, processing: 1, remind: 1 };
// SHATTERKID easter eggs: rare, small, never the plot.
export const EASTER_EGGS = ['RE:MIND', 'PRIMARY USER', 'SYSTEM REWIND', '1997'];
export const BOOT_LINES = ['BYTE-BIOS v1.997', 'MEMORY CHECK ... OK', 'PRIMARY USER: FOUND', 'LOADING BYTERIDER_97'];

// Border: the Mana Pocket logo's bright green and purple (store: "The border
// should be the mana pocket colors purple and green. They are bright like in
// the logo"). Cyan/magenta only in the glitch's RGB split.
const C = { green: '#5cff1f', purple: '#b026ff', cyan: '#29e6ff', magenta: '#ff3fd2', char: '#1f2529', lime: '#b6ff3a', screen: '#05080a' };
// His faces, after the store's ByteRider_97 Overlay Face Pack: neon-lime
// line art on a black CRT screen -- block eyes under short brows, a wide
// shallow smile; ^ ^ when happy; > < laughing; pixel shades when cool; a
// spinner loading; a progress bar processing; RE:MIND in brackets. Drawn
// around (0,0), about 760 x 560.
const W = 34;
const ln = (d, w = W) => `<path d="${d}" fill="none" stroke="${C.lime}" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"/>`;
const box = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const ring = (cx, cy, r, w = 26) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.lime}" stroke-width="${w}"/>`;
const rays = (cx, cy, r1, r2, degs, w = 18) => ln(degs.map(d => { const a = d * Math.PI / 180; return `M${Math.round(cx + Math.cos(a) * r1)} ${Math.round(cy + Math.sin(a) * r1)} L${Math.round(cx + Math.cos(a) * r2)} ${Math.round(cy + Math.sin(a) * r2)}`; }).join(' '), w);
const star = (cx, cy, r) => `<path d="M${[...Array(10)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; return `${Math.round(cx + Math.cos(a) * rr)} ${Math.round(cy + Math.sin(a) * rr)}`; }).join(' L')} Z"/>`;
const heart = (cx, cy, s) => `<path d="M${cx} ${cy + 0.8 * s} C${cx - 1.25 * s} ${cy} ${cx - 0.75 * s} ${cy - 0.95 * s} ${cx} ${cy - 0.35 * s} C${cx + 0.75 * s} ${cy - 0.95 * s} ${cx + 1.25 * s} ${cy} ${cx} ${cy + 0.8 * s} Z"/>`;
const brows = box(-300, -215, 150, 22) + box(150, -215, 150, 22);
const blocks = box(-290, -160, 130, 95) + box(160, -160, 130, 95);
const EYES = {
  neutral: brows + blocks,
  happy: ln('M-300 -70 Q-225 -190 -150 -70') + ln('M150 -70 Q225 -190 300 -70'),
  excited: brows + blocks + rays(-225, -112, 120, 165, [160, 180, 200]) + rays(225, -112, 120, 165, [-20, 0, 20]),
  laugh: ln('M-300 -175 L-170 -115 L-300 -55') + ln('M300 -175 L170 -115 L300 -55') + rays(-235, 60, 140, 185, [150, 170, 190]) + rays(235, 60, 140, 185, [-10, 10, 30]),
  wink: box(-290, -170, 125, 110) + ln('M150 -100 Q225 -170 300 -105') + ln('M300 -105 L325 -90', 22),
  cool: box(-340, -200, 680, 26) + `<path d="M-325 -174 L-55 -174 L-85 -60 L-295 -60 Z M55 -174 L325 -174 L295 -60 L85 -60 Z" fill="none" stroke="${C.lime}" stroke-width="24" stroke-linejoin="miter"/>` + ln('M-260 -90 L-200 -150 M-200 -90 L-140 -150 M140 -90 L200 -150 M200 -90 L260 -150', 16),
  surprised: ring(-200, -110, 70) + ring(200, -110, 70) + `<circle cx="-200" cy="-110" r="30"/><circle cx="200" cy="-110" r="30"/>` + rays(-200, -110, 105, 150, [-140, -120]) + rays(200, -110, 105, 150, [-40, -60]),
  shocked: ring(-190, -120, 90, 24) + ring(190, -120, 90, 24) + ln('M-330 40 L-300 80 M330 40 L300 80', 18),
  thinking: box(-305, -205, 150, 22) + box(-290, -150, 120, 75) + ln('M140 -205 Q220 -265 300 -215', 22) + box(165, -170, 120, 110),
  suspicious: box(-330, -150, 230, 24) + box(-300, -115, 180, 30) + box(100, -165, 230, 24) + box(130, -130, 180, 30),
  smirk: box(-330, -150, 230, 24) + box(-290, -115, 130, 45) + ln('M140 -200 Q220 -260 310 -225', 22) + box(165, -160, 120, 100),
  alert: ln('M-320 -215 L-160 -165', 24) + ln('M320 -215 L160 -165', 24) + box(-300, -140, 130, 95) + box(170, -140, 130, 95) + box(330, -200, 26, 110) + box(330, -70, 26, 26),
  angry: `<path d="M-320 -190 L-130 -100 L-140 -40 L-300 -40 Z"/><path d="M320 -190 L130 -100 L140 -40 L300 -40 Z"/>` + ln('M300 -260 L330 -230 M345 -275 L345 -235 M360 -255 L390 -270', 14),
  glitch: `<g fill="${C.magenta}" opacity=".75">${box(-305, -165, 130, 95)}${box(145, -165, 130, 95)}</g><g fill="${C.cyan}" opacity=".75">${box(-275, -155, 130, 95)}${box(175, -155, 130, 95)}</g>` + blocks + `<g fill="${C.magenta}" opacity=".6">${box(-380, -190, 120, 14)}${box(260, -40, 140, 14)}${box(-120, 20, 90, 12)}</g>`,
  x: ln('M-290 -180 L-160 -60 M-160 -180 L-290 -60') + ln('M160 -180 L290 -60 M290 -180 L160 -60'),
  loading: `<g class="br-spinner">${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<circle cx="${Math.round(Math.cos(a) * 130)}" cy="${Math.round(Math.sin(a) * 130)}" r="${16 + i * 3}" opacity="${0.35 + i * 0.09}"/>`; }).join('')}</g>`,
  processing: `<rect x="-310" y="-50" width="620" height="100" rx="28" fill="none" stroke="${C.lime}" stroke-width="22"/>` + [0, 1, 2, 3, 4].map(i => `<rect class="br-bar" x="${-280 + i * 96}" y="-25" width="80" height="50"/>`).join(''),
  dollar: `<g font-family="'Press Start 2P',monospace" font-size="190" text-anchor="middle"><text x="-210" y="-30">$</text><text x="210" y="-30">$</text></g>` + rays(-210, -110, 150, 205, [180, 210, 240, 150]) + rays(210, -110, 150, 205, [0, -30, -60, 30]),
  countdown: `<text class="br-count" x="0" y="40" text-anchor="middle" font-family="'Press Start 2P',monospace" font-size="64">3...2...1...</text>`,
  star: star(-200, -110, 105) + star(200, -110, 105) + rays(-200, -110, 140, 195, [180, 210, 240, 150]) + rays(200, -110, 140, 195, [0, -30, -60, 30]),
  hearts: heart(-200, -110, 100) + heart(200, -110, 100) + heart(-370, -230, 34) + heart(370, -240, 34),
  closed: ln('M-300 -100 Q-225 -40 -150 -100') + ln('M150 -100 Q225 -40 300 -100'),
  sad: box(-300, -215, 150, 22) + box(150, -215, 150, 22) + ln('M-300 -150 L-150 -190', 22) + ln('M300 -150 L150 -190', 22) + box(-290, -140, 130, 80) + box(160, -140, 130, 80),
  remind: `<text x="0" y="-60" text-anchor="middle" font-family="'Press Start 2P',monospace" font-size="92">RE:MIND</text>` + ln('M-370 -170 L-370 -230 L-310 -230 M370 -170 L370 -230 L310 -230 M-370 50 L-370 110 L-310 110 M370 50 L370 110 L310 110', 18),
};
const MOUTHS = {
  smile: ln('M-220 60 Q0 175 220 60'),
  grin: `<path d="M-180 40 Q0 270 180 40 Z"/>`,
  laughOpen: `<path d="M-180 40 Q0 270 180 40 Z" fill="none" stroke="${C.lime}" stroke-width="26" stroke-linejoin="round"/>` + `<path d="M-90 175 Q0 120 90 175 Q0 215 -90 175 Z"/>`,
  small: ln('M-130 80 Q0 165 130 80'),
  talk: `<g class="br-talk-a"><ellipse cx="0" cy="120" rx="110" ry="30" fill="none" stroke="${C.lime}" stroke-width="22"/></g><g class="br-talk-b"><ellipse cx="0" cy="120" rx="100" ry="60" fill="none" stroke="${C.lime}" stroke-width="22"/></g><g class="br-talk-c"><ellipse cx="0" cy="120" rx="70" ry="45" fill="none" stroke="${C.lime}" stroke-width="22"/></g>` + rays(150, 110, 70, 115, [-30, 0, 30], 16),
  o: `<ellipse cx="0" cy="130" rx="42" ry="56" fill="none" stroke="${C.lime}" stroke-width="22"/>`,
  shock: `<path d="M-95 170 L-95 110 Q-95 50 0 50 Q95 50 95 110 L95 170 Z" fill="none" stroke="${C.lime}" stroke-width="24"/>`,
  think: ln('M-150 120 Q-80 70 -10 105', 24) + box(40, 100, 24, 24) + box(90, 100, 24, 24) + box(140, 100, 24, 24),
  slant: ln('M-80 120 L90 90', 24),
  smirk: ln('M-150 110 Q60 140 220 40'),
  zigzag: ln('M-190 120 L-140 70 L-90 120 L-40 70 L10 120 L60 70 L110 120 L160 70 L200 110', 22),
  flat: ln('M-90 110 L90 110', 26),
  sleep: ln('M-55 120 L55 120', 26),
  frown: ln('M-150 140 Q0 60 150 140'),
  none: '',
};
// Which eyes and mouth each reaction wears.
export const FACE_FOR = {
  idle: ['neutral', 'smile'], happy: ['happy', 'grin'], excited: ['excited', 'grin'], laughing: ['laugh', 'laughOpen'], wink: ['wink', 'small'],
  cool: ['cool', 'small'], talking: ['neutral', 'talk'], surprised: ['surprised', 'o'], shocked: ['shocked', 'shock'], thinking: ['thinking', 'think'],
  suspicious: ['suspicious', 'slant'], smug: ['smirk', 'smirk'], alert: ['alert', 'none'], angry: ['angry', 'zigzag'], glitch: ['glitch', 'flat'],
  error: ['x', 'zigzag'], dizzy: ['x', 'zigzag'], loading: ['loading', 'none'], processing: ['processing', 'none'], jackpot: ['dollar', 'grin'],
  countdown: ['countdown', 'none'], celebrating: ['star', 'grin'], love: ['hearts', 'small'], sleeping: ['closed', 'sleep'], remind: ['remind', 'small'],
  sad: ['sad', 'frown'], disappearing: ['glitch', 'flat'],
};
// The neon border: logo green, or logo purple for these.
export const MAGENTA = new Set(['happy', 'laughing', 'cool', 'shocked', 'suspicious', 'alert', 'angry', 'processing', 'countdown', 'love', 'remind']);
const FACE = `<g fill="${C.lime}">` +
  Object.entries(EYES).map(([k, v]) => `<g class="br-eyes" data-eyes="${k}">${v}</g>`).join('') +
  Object.entries(MOUTHS).map(([k, v]) => `<g class="br-mouth" data-mouth="${k}">${v}</g>`).join('') + `</g>`;
const DEFS = `<defs>
 <pattern id="br-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000000" opacity=".22"/></pattern>
 <radialGradient id="br-fuzz" cx="50%" cy="50%" r="75%"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
</defs>`;
// On stream: the phone screen is his CRT; the neon border runs round it.
const FRAME = `<g class="br-frame">
 <rect class="br-scanlines" x="0" y="0" width="1080" height="1920" fill="url(#br-scan)"/>
 <rect class="br-vignette" x="0" y="0" width="1080" height="1920" fill="url(#br-fuzz)"/>
 <rect class="br-bezel" x="14" y="14" width="1052" height="1892" rx="80" fill="none" stroke="${C.green}" stroke-width="20"/>
 <rect class="br-bezel-inner" x="30" y="30" width="1020" height="1860" rx="66" fill="none" stroke="${C.purple}" stroke-opacity=".8" stroke-width="6"/>
</g>`;
export const BYTERIDER_SVG = `<svg class="br-svg" viewBox="0 0 1080 1920" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
${DEFS}${FRAME}
<g class="br-place"><g class="br-motion"><g class="br-face">${FACE}</g></g></g>
<rect class="br-static" x="0" y="0" width="1080" height="1920" fill="#ffffff"/>
</svg>`;
// Anywhere smaller (dashboard, website): one of the pack's screens -- a
// rounded black CRT with a glowing neon border, his face on it.
export const BYTERIDER_BADGE_SVG = `<svg class="br-svg" viewBox="-470 -360 940 720" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
${DEFS}
<rect class="br-bezel" x="-440" y="-330" width="880" height="660" rx="110" fill="${C.screen}" stroke="${C.green}" stroke-width="30"/>
<rect x="-420" y="-310" width="840" height="620" rx="92" fill="url(#br-scan)"/>
<g class="br-place" transform="translate(0 40) scale(.92)"><g class="br-motion"><g class="br-face">${FACE}</g></g></g>
<rect class="br-static" x="-420" y="-310" width="840" height="620" rx="92" fill="#ffffff"/>
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
      host.classList.toggle('br-magenta', MAGENTA.has(cur.state));
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
    const egg = EASTER_EGGS[Math.floor(random() * EASTER_EGGS.length)];
    if (egg === 'RE:MIND') { render(machine.play('remind', { ms: 1600 })); return; }
    render(machine.play('glitch', { ms: 1400 }));
    flashScreen([egg], 1200);
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
