// ByteRider_97 on the website (store, 2026-11-02: "do 5" -- ByteRider beyond
// the stream). A drop-in: one script tag on any page puts him in the
// bottom-left corner on a little screen of his own.
//
//   <script type="module" src="https://squeebmike.github.io/ArSca/scripts/byterider-site.mjs"></script>
//
// What he does here:
//  - greets a visitor once a visit (a quick boot, then a line);
//  - reacts when someone presses an add-to-cart / preorder / checkout button
//    (found by the button's words, so it works on any page);
//  - naps after five quiet minutes, wakes on a tap, and a tap gets a line;
//  - the X hides him for this visitor.
// Any page can make him react on purpose (what Codex's website code can use):
//   window.dispatchEvent(new CustomEvent('byterider', { detail: { state: 'jackpot', text: 'ORDER PLACED!' } }))
import { createByteRider, MASCOT_STATES } from './byterider.mjs';

const BASE = new URL('..', import.meta.url).href;
const LINES = ['PSST. NEW STUFF DROPS EVERY WEEK.', 'I LIVE IN THE ARCADE SYSTEM. DON\'T TELL ANYONE.', 'THAT ONE\'S A GOOD PULL.', 'CATCH US LIVE ON WHATNOT!', 'BUILT IN 1997. STILL RUNNING.', 'NEAR MINT? I\'LL ALLOW IT.'];
const safe = fn => { try { return fn(); } catch { return null; } };

export function mountSiteByteRider({ size = 76, corner = 'left' } = {}) {
  if (document.getElementById('byterider-site') || safe(() => localStorage.getItem('byterider-hidden') === '1')) return null;
  if (!document.querySelector('link[data-byterider]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = BASE + 'assets/byterider.css'; css.dataset.byterider = '1';
    document.head.append(css);
  }
  const wrap = document.createElement('div');
  wrap.id = 'byterider-site';
  wrap.setAttribute('role', 'complementary'); wrap.setAttribute('aria-label', 'ByteRider_97, The Mana Pocket mascot');
  Object.assign(wrap.style, { position: 'fixed', bottom: '14px', [corner]: '14px', zIndex: '2147483000', pointerEvents: 'auto', cursor: 'pointer' });
  const host = document.createElement('div');
  host.style.setProperty('--br-size', size + 'px');
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Hide ByteRider');
  Object.assign(close.style, { position: 'absolute', top: '-6px', [corner === 'left' ? 'right' : 'left']: '-6px', width: '20px', height: '20px', borderRadius: '50%', border: '2px solid #0b0612', background: '#fff6d8', font: '700 13px/14px sans-serif', cursor: 'pointer', padding: '0', zIndex: '2' });
  wrap.append(host, close);
  document.body.append(wrap);
  const br = createByteRider(host, { mode: 'badge', sleepAfterMs: 5 * 60000 });
  if (corner === 'right') host.classList.add('br-anchor-right');
  let line = 0;
  close.onclick = e => { e.stopPropagation(); safe(() => localStorage.setItem('byterider-hidden', '1')); br.destroy(); wrap.remove(); };
  host.onclick = () => { br.wake(); br.play('wink', { text: LINES[line++ % LINES.length] }); };
  // Hello, once a visit.
  if (!safe(() => sessionStorage.getItem('byterider-hello'))) {
    safe(() => sessionStorage.setItem('byterider-hello', '1'));
    br.play('disappearing', { boot: true });
    br.play('talking', { text: 'WELCOME TO THE POCKET, PRIMARY USER.' });
  }
  // Buttons that put something in the cart, or check out.
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('button,a,input[type=submit]');
    if (!b || wrap.contains(b)) return;
    const words = (b.textContent || b.value || b.getAttribute('aria-label') || '').toLowerCase();
    if (/check\s*out|place order|pay now/.test(words)) br.play('jackpot', { text: 'LET\'S GOOO!' });
    else if (/pre-?order/.test(words)) br.play('love', { text: 'LOCKED IN. GOOD CALL.' });
    else if (/add to (cart|bag)|buy now/.test(words)) br.play('happy', { text: 'GOOD PICK!' });
  }, true);
  // The website's own code can make him react.
  window.addEventListener('byterider', e => {
    const { state = 'happy', text = '' } = e.detail || {};
    if (MASCOT_STATES.includes(state)) br.play(state, { text: String(text).slice(0, 120) });
  });
  return br;
}
// A script tag mounts him once the page is ready.
if (typeof document !== 'undefined' && !import.meta.url.includes('#nomount')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountSiteByteRider());
  else mountSiteByteRider();
}
