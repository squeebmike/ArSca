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
//  - ASK BYTERIDER (2026-11-05: "Can you ask him questions? Like clippy?"):
//    a tap opens a little chat; he answers from the store's facts and
//    what's in stock now (Worker: POST /public/byterider/ask), with links.
// Any page can make him react on purpose (what Codex's website code can use):
//   window.dispatchEvent(new CustomEvent('byterider', { detail: { state: 'jackpot', text: 'ORDER PLACED!' } }))
import { createByteRider, MASCOT_STATES } from './byterider.mjs';

const BASE = new URL('..', import.meta.url).href;
const LINES = ['PSST. NEW STUFF DROPS EVERY WEEK.', 'I LIVE IN THE ARCADE SYSTEM. DON\'T TELL ANYONE.', 'THAT ONE\'S A GOOD PULL.', 'CATCH US LIVE ON WHATNOT!', 'BUILT IN 1997. STILL RUNNING.', 'NEAR MINT? I\'LL ALLOW IT.'];
const safe = fn => { try { return fn(); } catch { return null; } };
// The Worker: the same site when it serves the page, else its own address.
const WORKER = /(^|\.)themanapocket\.com$/.test(typeof location !== 'undefined' ? location.hostname : '') ? '' : 'https://still-resonance-4f87.swarnerauto.workers.dev';
export const ASK_URL = WORKER + '/public/byterider/ask';
const SUGGESTIONS = ['When do new comics come out?', 'Do you have any Charizard?', 'Do you ship?', 'When is the next Whatnot show?'];
// The chat: built from DOM nodes and textContent only (nothing a visitor or
// the answer types is ever read as HTML).
function buildChat(corner, onAsk) {
  const box = document.createElement('div');
  box.id = 'byterider-chat';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Ask ByteRider');
  Object.assign(box.style, { position: 'fixed', bottom: '108px', [corner]: '14px', width: 'min(320px, calc(100vw - 28px))', maxHeight: 'min(60vh, 460px)', display: 'none', flexDirection: 'column',
    background: '#160a2b', color: '#eaffd6', border: '3px solid #b4ff3a', borderRadius: '14px', boxShadow: '0 8px 30px #000a, 0 0 18px #b4ff3a55', zIndex: '2147483001', font: '14px/1.4 system-ui, sans-serif', overflow: 'hidden' });
  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#0b0612', font: '700 12px/1 "Press Start 2P", monospace', color: '#b4ff3a' });
  head.textContent = 'ASK BYTERIDER_97';
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Close');
  Object.assign(x.style, { background: 'none', border: 0, color: '#fff', fontSize: '20px', cursor: 'pointer', lineHeight: '1' });
  head.append(x);
  const log = document.createElement('div');
  Object.assign(log.style, { flex: '1', overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' });
  const form = document.createElement('form');
  Object.assign(form.style, { display: 'flex', gap: '6px', padding: '8px', borderTop: '2px solid #2a1550' });
  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = 300; input.placeholder = 'Ask me anything…'; input.setAttribute('aria-label', 'Your question');
  Object.assign(input.style, { flex: '1', minWidth: '0', padding: '8px 10px', borderRadius: '8px', border: '2px solid #4a2a7a', background: '#0b0612', color: '#fff', font: 'inherit' });
  const send = document.createElement('button'); send.type = 'submit'; send.textContent = 'ASK';
  Object.assign(send.style, { padding: '8px 12px', borderRadius: '8px', border: 0, background: '#b4ff3a', color: '#0b0612', fontWeight: '800', cursor: 'pointer' });
  form.append(input, send);
  box.append(head, log, form);
  const bubble = (text, who, items = []) => {
    const b = document.createElement('div');
    Object.assign(b.style, { alignSelf: who === 'you' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '8px 10px', borderRadius: '10px',
      background: who === 'you' ? '#3a1d66' : '#0b0612', border: who === 'you' ? '0' : '1px solid #b4ff3a55', whiteSpace: 'pre-wrap', wordBreak: 'break-word' });
    b.textContent = text;
    for (const it of items) {
      if (!/^\//.test(it.url || '') && !/^https:\/\//.test(it.url || '')) continue;
      const a = document.createElement('a'); a.href = it.url; a.textContent = '▸ ' + it.name + (it.price ? ' — $' + Number(it.price).toFixed(2) : '');
      Object.assign(a.style, { display: 'block', marginTop: '6px', color: '#b4ff3a', textDecoration: 'underline' });
      b.append(a);
    }
    log.append(b); log.scrollTop = log.scrollHeight;
    return b;
  };
  const chips = document.createElement('div');
  Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  for (const q of SUGGESTIONS) {
    const c = document.createElement('button'); c.type = 'button'; c.textContent = q;
    Object.assign(c.style, { padding: '5px 8px', borderRadius: '999px', border: '1px solid #b4ff3a88', background: 'transparent', color: '#eaffd6', font: '12px system-ui, sans-serif', cursor: 'pointer' });
    c.onclick = () => { input.value = q; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); };
    chips.append(c);
  }
  bubble("Hi! I'm ByteRider_97. Ask me about the shop, new comics, shipping -- or if we've got a card in stock.", 'br');
  log.append(chips);
  let busy = false;
  form.onsubmit = async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    busy = true; chips.remove(); input.value = ''; bubble(q, 'you');
    const wait = bubble('…', 'br');
    try { const r = await onAsk(q); wait.remove(); bubble(r.text, 'br', r.items); }
    catch { wait.remove(); bubble('My circuits glitched. Try again!', 'br'); }
    busy = false; input.focus();
  };
  return { box, open: () => { box.style.display = 'flex'; document.getElementById('byterider-site')?.classList.add('br-chat-open'); setTimeout(() => input.focus(), 50); }, close: () => { box.style.display = 'none'; document.getElementById('byterider-site')?.classList.remove('br-chat-open'); }, get isOpen() { return box.style.display !== 'none'; }, x };
}

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
  // Ask ByteRider: the chat, and his face says the answer too.
  const history = [];
  const chat = buildChat(corner, async q => {
    br.wake(); br.play('thinking', { ms: 1200 });
    const res = await fetch(ASK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history: history.slice(-6), page: location.pathname }) });
    const d = await res.json().catch(() => ({}));
    const text = d.ok ? String(d.answer || '') : String(d.error || 'Hmm, try that again?');
    history.push({ role: 'user', content: q }, { role: 'assistant', content: text });
    br.play(d.ok ? 'talking' : 'sad', { text: text.length > 90 ? text.slice(0, 88) + '…' : text });
    return { text, items: d.ok ? d.items || [] : [] };
  });
  document.body.append(chat.box);
  chat.x.onclick = () => chat.close();
  close.onclick = e => { e.stopPropagation(); safe(() => localStorage.setItem('byterider-hidden', '1')); br.destroy(); wrap.remove(); chat.box.remove(); };
  // On the frame round him (it takes the taps, not the face inside).
  wrap.onclick = e => { if (close.contains(e.target)) return; br.wake(); if (chat.isOpen) { chat.close(); br.play('wink', { text: LINES[line++ % LINES.length] }); } else { chat.open(); br.play('happy', { text: 'ASK ME ANYTHING!' }); } };
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
