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
  // ── The shed's own bosses (2026-11-12: "the bosses are lame"). Each has a
  // special MOVE it pulls when it gets angry (at 2/3 and 1/3 HP) -- all show,
  // nothing about the sale changes.
  mimic: { name: 'THE LONG BOX MIMIC', taunt: 'NOTHING IN HERE BUT TEETH!', move: 'chomp', svg: svg(
    // A comic long box, its lid snapping open on rows of teeth.
    `<rect x="6" y="32" width="52" height="24" rx="2" fill="#efe9d8" ${ink}/><rect x="12" y="40" width="18" height="8" fill="#fff" ${ink}/><path d="M14 44 H28" stroke="${K}" stroke-width="2"/>` +
    `<path d="M10 34 L32 44 L54 34 Z" fill="#b3122e" ${ink}/><path d="M24 40 Q32 46 40 40 Q32 42 24 40 Z" fill="#ff6b8b"/>` +
    `<path d="M6 32 L10 12 L58 8 L58 32 Z" fill="#ddd5bf" ${ink}/>` +
    `<path d="M10 32 L14 38 L18 32 L22 38 L26 32 L30 38 L34 32 L38 38 L42 32 L46 38 L50 32 L54 38 L58 32" fill="#fff" ${ink}/>` +
    `<path d="M8 32 L12 26 L16 31 L20 25 L24 31 L28 25 L32 31 L36 25 L40 31 L44 25 L48 31 L52 25 L56 31" fill="#fff" ${ink}/>` +
    eye(24, 18, true) + eye(42, 17, true)) },
  golem: { name: 'THE PRICE GUN GOLEM', taunt: "EVERYTHING'S $99.99 NOW!", move: 'barrage', svg: svg(
    // A lumpy stone giant with a price gun for a hand, stickers stuck all over.
    `<rect x="14" y="26" width="34" height="30" rx="5" fill="#8b8f99" ${ink}/><rect x="20" y="8" width="24" height="20" rx="4" fill="#9aa0aa" ${ink}/>` +
    eye(27, 17, true) + eye(38, 17, true) + `<path d="M26 24 H40" ${ink}/>` +
    `<rect x="46" y="30" width="14" height="10" rx="2" fill="#f97316" ${ink}/><rect x="52" y="40" width="5" height="10" fill="#f97316" ${ink}/><rect x="58" y="32" width="5" height="4" fill="#fde047" ${ink}/>` +
    `<rect x="4" y="30" width="10" height="20" rx="3" fill="#8b8f99" ${ink}/><rect x="18" y="56" width="10" height="6" fill="#6b7280" ${ink}/><rect x="34" y="56" width="10" height="6" fill="#6b7280" ${ink}/>` +
    `<rect x="18" y="32" width="10" height="6" fill="#fde047" ${ink}/><rect x="32" y="42" width="10" height="6" fill="#fb923c" ${ink}/><rect x="22" y="47" width="8" height="5" fill="#fde047" ${ink}/>`) },
  kraken: { name: 'THE LEAKY ROOF KRAKEN', taunt: 'YOUR LONG BOXES ARE SOAKED!', move: 'flood', svg: svg(
    // A purple sea beast out of a puddle, tentacles everywhere, drips from above.
    `<path d="M2 58 Q32 50 62 58 L62 64 L2 64 Z" fill="#38bdf8" ${ink}/>` +
    `<path d="M10 56 Q4 40 12 34" fill="none" stroke="#7c3aed" stroke-width="6" stroke-linecap="round"/><path d="M54 56 Q62 42 52 32" fill="none" stroke="#7c3aed" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M20 58 Q16 48 22 44" fill="none" stroke="#6d28d9" stroke-width="5" stroke-linecap="round"/><path d="M44 58 Q48 48 42 44" fill="none" stroke="#6d28d9" stroke-width="5" stroke-linecap="round"/>` +
    `<ellipse cx="32" cy="32" rx="16" ry="20" fill="#8b5cf6" ${ink}/><circle cx="25" cy="22" r="3" fill="#c4b5fd"/><circle cx="38" cy="40" r="2.5" fill="#c4b5fd"/>` +
    eye(26, 32, true) + eye(38, 32, true) + `<path d="M26 42 Q32 46 38 42" fill="none" ${ink}/>` +
    `<path d="M12 4 Q14 9 12 10 Q10 9 12 4 Z" fill="#7dd3fc" ${ink}/><path d="M50 2 Q52 7 50 8 Q48 7 50 2 Z" fill="#7dd3fc" ${ink}/>`) },
  lich: { name: 'THE BARGAIN BIN LICH', taunt: 'EVERY BOOK... A DOLLAR... FOREVER...', move: 'curse', svg: svg(
    // A skull in a tattered green hood, a glowing $1 bin in its bony hands.
    `<path d="M10 62 L18 26 Q32 18 46 26 L54 62 Z" fill="#14532d" ${ink}/><path d="M18 30 Q16 6 32 5 Q48 6 46 30 Q32 24 18 30 Z" fill="#166534" ${ink}/>` +
    `<ellipse cx="32" cy="22" rx="10" ry="11" fill="#f5f5dc" ${ink}/><circle cx="28" cy="21" r="3.2" fill="#4ade80"/><circle cx="36" cy="21" r="3.2" fill="#4ade80"/><path d="M27 29 H37 M30 27 V31 M34 27 V31" ${ink}/>` +
    `<rect x="16" y="40" width="32" height="16" rx="2" fill="#a16207" ${ink}/><rect x="20" y="36" width="5" height="8" fill="#ef4444" ${ink}/><rect x="27" y="35" width="5" height="9" fill="#3b82f6" ${ink}/><rect x="34" y="36" width="5" height="8" fill="#eab308" ${ink}/>` +
    `<rect x="22" y="46" width="20" height="7" fill="#4ade80" ${ink}/><text x="32" y="52" font-size="6" font-weight="900" text-anchor="middle" fill="${K}">$1</text>`) },
  raccoonking: { name: 'THE RACCOON KING', taunt: 'THIS SHED IS MY KINGDOM NOW!', move: 'trash', svg: svg(
    // A raccoon in a crown on a throne of greasy pizza boxes.
    `<rect x="8" y="48" width="48" height="6" fill="#c98a3c" ${ink}/><rect x="10" y="54" width="44" height="6" fill="#b07a3c" ${ink}/><circle cx="18" cy="51" r="1.5" fill="#b91c1c"/><circle cx="44" cy="57" r="1.5" fill="#b91c1c"/>` +
    `<ellipse cx="32" cy="38" rx="14" ry="12" fill="#6b7280" ${ink}/><path d="M46 42 Q58 40 58 30" fill="none" stroke="#374151" stroke-width="6" stroke-linecap="round"/><path d="M52 39 L55 32" stroke="#d1d5db" stroke-width="3"/>` +
    `<circle cx="32" cy="22" r="12" fill="#9ca3af" ${ink}/><path d="M20 14 L22 6 L27 12 Z M44 14 L42 6 L37 12 Z" fill="#6b7280" ${ink}/>` +
    `<path d="M21 20 Q32 16 43 20 Q43 27 32 26 Q21 27 21 20 Z" fill="#1f2937"/>` + eye(27, 21) + eye(37, 21) + `<circle cx="32" cy="29" r="2" fill="${K}"/>` +
    `<path d="M22 10 L24 2 L28 7 L32 1 L36 7 L40 2 L42 10 Z" fill="#facc15" ${ink}/>`) },
  lowballer: { name: 'THE LOWBALLER', taunt: "I'LL GIVE YOU $2 FOR THE WHOLE BOX.", move: 'snatch', svg: svg(
    // A smug guy in a polo, phone calculator out, holding up a tiny $2 sign.
    `<path d="M14 62 L18 36 Q32 30 46 36 L50 62 Z" fill="#0ea5e9" ${ink}/><path d="M28 34 L32 40 L36 34" fill="#fff" ${ink}/>` +
    `<ellipse cx="32" cy="22" rx="11" ry="12" fill="#f1c27d" ${ink}/><path d="M21 16 Q32 4 43 16 Q38 12 32 13 Q26 12 21 16 Z" fill="#78350f" ${ink}/>` +
    `<path d="M25 20 H30 M34 20 H39" ${ink}/><path d="M27 29 Q33 31 38 27" fill="none" ${ink}/>` +
    `<rect x="44" y="36" width="12" height="18" rx="2" fill="#1f2937" ${ink}/><rect x="46" y="38" width="8" height="5" fill="#a3e635"/>` +
    `<rect x="4" y="30" width="14" height="10" fill="#fff" ${ink}/><text x="11" y="38" font-size="7" font-weight="900" text-anchor="middle" fill="#dc2626">$2</text><path d="M11 40 V50" ${ink}/>`) },
  dragon: { name: 'THE GRAIL DRAGON', taunt: 'THE GRAILS ARE MINE!', move: 'fire', svg: svg(
    // A red dragon curled on a hoard of slabbed books and gold.
    `<path d="M4 60 L12 50 L22 54 L30 46 L40 52 L50 46 L60 58 L60 62 L4 62 Z" fill="#facc15" ${ink}/><rect x="16" y="46" width="8" height="12" fill="#dbeafe" ${ink}/><rect x="40" y="44" width="8" height="12" fill="#dbeafe" ${ink}/>` +
    `<path d="M14 48 Q8 28 24 22 Q40 18 46 30 Q52 42 40 48 Z" fill="#dc2626" ${ink}/><path d="M24 26 L18 10 L30 20 Z M34 22 L40 6 L42 22 Z" fill="#7f1d1d" ${ink}/>` +
    `<path d="M40 30 Q54 24 60 30 Q56 36 44 38 Z" fill="#ef4444" ${ink}/><circle cx="52" cy="29" r="1.6" fill="${K}"/>` + eye(46, 26, true) +
    `<path d="M60 31 L63 28 M60 33 L64 34" stroke="#fb923c" stroke-width="2.5" stroke-linecap="round"/><path d="M22 34 Q28 30 32 36 Q28 40 22 34 Z" fill="#fca5a5"/>`) },
  hydra: { name: 'THE TOPLOADER HYDRA', taunt: 'THREE HEADS, ZERO PENNY SLEEVES!', move: 'barrage', svg: svg(
    // Three snake heads, each a clear top loader with a card glaring out.
    `<ellipse cx="32" cy="54" rx="20" ry="9" fill="#0f766e" ${ink}/>` +
    `<path d="M20 50 Q12 36 14 24" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round"/><path d="M32 48 Q32 30 32 18" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round"/><path d="M44 50 Q52 36 50 24" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round"/>` +
    [[14, 16], [32, 8], [50, 16]].map(([x, y]) => `<rect x="${x - 7}" y="${y - 6}" width="14" height="18" rx="2" fill="#e0f2fe" fill-opacity=".8" ${ink}/><rect x="${x - 5}" y="${y - 4}" width="10" height="12" fill="#f43f5e"/>` + `<circle cx="${x - 2}" cy="${y + 1}" r="1.6" fill="#fff"/><circle cx="${x + 2}" cy="${y + 1}" r="1.6" fill="#fff"/>`).join('')) },
};
// Which boss guards which floor: each shed its own, then all of them in turn.
export const BOSS_ORDER = ['mimic', 'golem', 'kraken', 'lich', 'raccoonking', 'lowballer', 'dragon', 'hydra', 'scalper', 'flipper', 'grader', 'dinged', 'shipping'];
// What each of the first five does when it gets angry.
for (const [id, move] of [['scalper', 'snatch'], ['flipper', 'barrage'], ['dinged', 'chomp'], ['grader', 'curse'], ['shipping', 'trash']]) BOSSES[id].move = move;
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
