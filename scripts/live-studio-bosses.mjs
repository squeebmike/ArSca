// Live Studio bosses: original villains of the collectibles hobby (store,
// 2026-11-02: "I like the original bosses. The scalpers. The flipper. The
// dinged corner... With original artwork"). Each is a small cartoon drawn
// here, shrunk onto a 48 px canvas and shown big with pixelated scaling, so
// it reads as 8-bit sprite art without hand-placing pixels. All original.
const K = '#0b0612';
const ink = `stroke="${K}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const eye = (x, y, mad = false) => `<circle cx="${x}" cy="${y}" r="4" fill="#fff" ${ink}/><circle cx="${x + (mad ? 1 : 0)}" cy="${y + 1}" r="1.8" fill="${K}"/>` + (mad ? `<path d="M${x - 5} ${y - 6} L${x + 4} ${y - 3}" ${ink}/>` : '');
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

export const BOSSES = {
  scalper: { name: 'THE SCALPER', taunt: 'LIMIT ONE? NOT FOR ME!', svg: svg(
    // Trench coat, hood, shades, grin, an armful of sealed boxes.
    `<path d="M14 62 L18 34 Q32 28 46 34 L50 62 Z" fill="#3b1b5e" ${ink}/>` +
    `<path d="M17 30 Q16 8 32 7 Q48 8 47 30 Q40 36 32 36 Q24 36 17 30 Z" fill="#2a123f" ${ink}/>` +
    `<ellipse cx="32" cy="24" rx="11" ry="10" fill="#f1c27d" ${ink}/>` +
    `<rect x="21" y="18" width="22" height="6" rx="2" fill="${K}"/><rect x="24" y="19" width="4" height="2" fill="#9ff"/>` +
    `<path d="M25 28 Q32 34 39 28 Z" fill="#fff" ${ink}/>` +
    `<rect x="8" y="40" width="20" height="9" fill="#c98a3c" ${ink}/><rect x="10" y="48" width="20" height="9" fill="#b07a3c" ${ink}/><rect x="9" y="31" width="18" height="9" fill="#d9a24c" ${ink}/>` +
    `<rect x="40" y="40" width="16" height="10" rx="2" fill="#ffe23d" ${ink}/><text x="48" y="48" font-size="8" font-weight="900" text-anchor="middle" fill="${K}">$$$</text>`) },
  flipper: { name: 'THE FLIPPER', taunt: 'BOUGHT IT FOR $1, LIST IT FOR $100!', svg: svg(
    // Backwards cap, smug grin, spatula flipping a comic in the air.
    `<path d="M18 62 L20 40 Q32 34 44 40 L46 62 Z" fill="#2fbf71" ${ink}/>` +
    `<circle cx="32" cy="26" r="12" fill="#f1c27d" ${ink}/>` +
    `<path d="M19 22 Q20 10 32 10 Q44 10 45 22 Z" fill="#ff2a4f" ${ink}/><path d="M19 21 L10 23" stroke="#ff2a4f" stroke-width="5" stroke-linecap="round"/>` +
    eye(27, 26) + eye(37, 26) + `<path d="M26 32 Q33 37 39 31" fill="none" ${ink}/>` +
    `<path d="M46 50 L56 30" ${ink}/><rect x="51" y="20" width="10" height="9" rx="1" transform="rotate(25 56 24)" fill="#ccc" ${ink}/>` +
    `<rect x="44" y="2" width="12" height="15" transform="rotate(-20 50 9)" fill="#22e6ff" ${ink}/><path d="M46 6 L54 6" stroke="#ff3fd2" stroke-width="2"/>`) },
  dinged: { name: 'THE DINGED CORNER', taunt: 'NEAR MINT? NOT ANYMORE!', svg: svg(
    // A comic book with a bent corner, angry eyes, fangs, little legs.
    `<path d="M14 8 L44 8 L52 16 L52 56 L14 56 Z" fill="#ff3fd2" ${ink}/>` +
    `<path d="M44 8 L44 16 L52 16 Z" fill="#fff6d8" ${ink}/>` +
    `<rect x="18" y="12" width="22" height="7" fill="#ffe23d" ${ink}/>` +
    eye(25, 30, true) + eye(41, 30, true) +
    `<path d="M24 42 Q33 36 42 42 L42 46 L24 46 Z" fill="${K}"/><path d="M27 42 L29 46 L31 42 M35 42 L37 46 L39 42" fill="#fff"/>` +
    `<path d="M20 56 L18 62 M46 56 L48 62" ${ink}/><path d="M14 36 L6 40 M52 36 L60 32" ${ink}/>`) },
  grader: { name: 'THE HARSH GRADER', taunt: 'THAT SPINE TICK? 4.0.', svg: svg(
    // A plastic slab with a red label that reads 4.0, frowning.
    `<rect x="12" y="4" width="40" height="56" rx="4" fill="#dfe7ee" ${ink}/>` +
    `<rect x="15" y="7" width="34" height="13" fill="#ff2a4f" ${ink}/><text x="32" y="18" font-size="11" font-weight="900" text-anchor="middle" fill="#fff">4.0</text>` +
    `<rect x="18" y="24" width="28" height="32" fill="#7b5cff" ${ink}/>` +
    eye(26, 36, true) + eye(38, 36, true) + `<path d="M25 49 Q32 44 39 49" fill="none" ${ink}/>`) },
  shipping: { name: 'THE SHIPPING DELAY', taunt: 'YOUR PACKAGE? 3-5 WEEKS!', svg: svg(
    // A cardboard box with snapping flaps, tape, a red LATE stamp.
    `<path d="M10 24 L54 24 L54 58 L10 58 Z" fill="#c98a3c" ${ink}/>` +
    `<path d="M10 24 L2 12 L28 16 L32 24 Z" fill="#b07a3c" ${ink}/><path d="M54 24 L62 12 L36 16 L32 24 Z" fill="#b07a3c" ${ink}/>` +
    `<rect x="28" y="24" width="8" height="34" fill="#e8d3a0" ${ink}/>` +
    eye(20, 36, true) + eye(44, 36, true) +
    `<rect x="14" y="46" width="18" height="8" fill="none" stroke="#ff2a4f" stroke-width="2.5" transform="rotate(-8 23 50)"/><text x="23" y="53" font-size="6.5" font-weight="900" text-anchor="middle" fill="#ff2a4f" transform="rotate(-8 23 50)">LATE</text>`) },
};
export const BOSS_IDS = Object.keys(BOSSES);
export const DEFAULT_BOSS = 'scalper';
export const bossById = id => BOSSES[id] || BOSSES[DEFAULT_BOSS];

// Draws a boss as 8-bit art: the cartoon onto a tiny canvas, shown big with
// pixelated scaling (CSS image-rendering: pixelated on the canvas).
export function drawBoss(canvas, id, { size = 48 } = {}) {
  if (!canvas?.getContext) return Promise.resolve(false);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { ctx.clearRect(0, 0, size, size); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0, size, size); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bossById(id).svg);
  });
}
