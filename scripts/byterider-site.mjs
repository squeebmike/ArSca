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
import { shouldAsk, matchTheme, choiceLabel, readCatalog, applyChoice, ASK_KEY, IDLE_MS } from './byterider-theme.mjs';

const BASE = new URL('..', import.meta.url).href;
const LINES = ['PSST. NEW STUFF DROPS EVERY WEEK.', 'I LIVE IN THE ARCADE SYSTEM. DON\'T TELL ANYONE.', 'THAT ONE\'S A GOOD PULL.', 'CATCH US LIVE ON WHATNOT!', 'BUILT IN 1997. STILL RUNNING.', 'NEAR MINT? I\'LL ALLOW IT.'];
const safe = fn => { try { return fn(); } catch { return null; } };
// The Worker: the same site when it serves the page, else its own address.
// Always the worker: the website itself is served by Webflow, which
// answers a POST to /public/... with 405.
const WORKER = 'https://still-resonance-4f87.swarnerauto.workers.dev';
export const ASK_URL = WORKER + '/public/byterider/ask';
// The visitor's first name, from their own website sign-in (account.js keeps
// the session here). Read in their browser only; nothing but the first name
// is ever sent, and only with their own question.
export function signedInFirstName() {
  const s = safe(() => JSON.parse(localStorage.getItem('mp-foc-session-v1') || 'null')) || null;
  const meta = s?.user?.user_metadata || {};
  const w = String(meta.full_name || meta.name || meta.first_name || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÀ-ÿ'-]{1,20}$/.test(w) ? w[0].toUpperCase() + w.slice(1) : '';
}
const SUGGESTIONS = ['Suggest a Pokémon gift under $25', 'What preorders are coming up?', 'Do you have any Charizard?', 'How do I sign in and pick a theme?', 'Magic: can I respond to [[Lightning Bolt]]?'];
// The chat: built from DOM nodes and textContent only (nothing a visitor or
// the answer types is ever read as HTML).
// Phones and tablets: never pop the keyboard by itself (it covers his answer).
const touchScreen = () => safe(() => matchMedia('(pointer: coarse)').matches) || false;
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
  const ask = q => { input.value = q; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); };
  const chipButton = q => { const c = document.createElement('button'); c.type = 'button'; c.textContent = q;
    Object.assign(c.style, { padding: '5px 8px', borderRadius: '999px', border: '1px solid #b4ff3a88', background: 'transparent', color: '#eaffd6', font: '12px system-ui, sans-serif', cursor: 'pointer' });
    c.onclick = () => ask(q); return c; };
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
  for (const q of SUGGESTIONS) chips.append(chipButton(q));
  const who = signedInFirstName();
  bubble((who ? 'Hey ' + who + "! " : "Hi! I'm ByteRider_97. ") + "I can find stuff in stock, suggest gifts, tell you what comics are coming (and what to read), help with your account and theme -- and I'm your Magic rules helper. Name a card like [[Lightning Bolt]].", 'br');
  log.append(chips);
  // Questions to tap under his last message.
  const showFollowUps = (list = []) => { if (!list.length) return; const f = document.createElement('div'); f.className = 'br-followups'; Object.assign(f.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
    for (const q2 of list.slice(0, 4)) f.append(chipButton(String(q2).slice(0, 60))); log.append(f); log.scrollTop = log.scrollHeight; };
  // He speaks first (the theme question): his line and taps to answer.
  const say = (text, list = []) => { chips.remove(); log.querySelectorAll('.br-followups').forEach(n => n.remove()); bubble(text, 'br'); showFollowUps(list); };
  let busy = false;
  form.onsubmit = async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    busy = true; chips.remove(); log.querySelectorAll('.br-followups').forEach(n => n.remove()); input.value = ''; if (touchScreen()) input.blur(); bubble(q, 'you');
    const wait = bubble('…', 'br');
    try { const r = await onAsk(q); wait.remove(); const b = bubble(r.text, 'br', r.items);
      showFollowUps(r.followUps); b.scrollIntoView?.({ block: 'start' }); }
    catch { wait.remove(); bubble('My circuits glitched. Try again!', 'br'); }
    busy = false; if (!touchScreen()) input.focus();
  };
  return { box, open: () => { box.style.display = 'flex'; document.getElementById('byterider-site')?.classList.add('br-chat-open'); if (!touchScreen()) setTimeout(() => input.focus(), 50); }, close: () => { box.style.display = 'none'; document.getElementById('byterider-site')?.classList.remove('br-chat-open'); }, get isOpen() { return box.style.display !== 'none'; }, x, say };
}

// After his × he waits as a small tab in the corner; a tap brings him back.
function showReturnTab(opts) {
  if (document.getElementById('byterider-return')) return null;
  const corner = opts.corner || 'left';
  const tab = document.createElement('button');
  tab.id = 'byterider-return'; tab.type = 'button'; tab.textContent = '▶ BYTERIDER';
  tab.setAttribute('aria-label', 'Bring back ByteRider');
  Object.assign(tab.style, { position: 'fixed', bottom: '14px', [corner]: '14px', zIndex: '2147483000', padding: '6px 10px', borderRadius: '999px', border: '2px solid #b4ff3a', background: '#160a2b', color: '#b4ff3a', font: '700 11px/1 system-ui, sans-serif', letterSpacing: '1px', cursor: 'pointer', opacity: '0.85' });
  tab.onclick = () => { safe(() => localStorage.removeItem('byterider-hidden')); tab.remove(); mountSiteByteRider(opts); };
  document.body.append(tab);
  return null;
}

export function mountSiteByteRider(opts = {}) {
  const { size = 76, corner = 'left' } = opts;
  if (document.getElementById('byterider-site')) return null;
  if (safe(() => localStorage.getItem('byterider-hidden') === '1')) return showReturnTab(opts);
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
  // The theme: "Seahawks", "Pikachu", "Izzet" -- set right here, no server.
  let themeAsking = false;
  const store = { get: k => safe(() => localStorage.getItem(k)), set: (k, v) => safe(() => localStorage.setItem(k, v)) };
  const themeReply = q => {
    const asked = /\b(theme|colou?rs?)\b/i.test(q);
    if (!themeAsking && !asked) return null;
    if (themeAsking && /^(no|nope|nah|no thanks?|not now|maybe later|skip)\b/i.test(q.trim())) { themeAsking = false; store.set(ASK_KEY, 'no'); return { text: 'No problem! You can pick one anytime from My Pocket (top right).' }; }
    const catalog = readCatalog();
    if (!catalog.length) return null;
    const { match, choices } = matchTheme(q, catalog);
    if (match && applyChoice(match)) { themeAsking = false; store.set(ASK_KEY, 'no'); br.play('jackpot', { text: match.n.toUpperCase() + ' MODE: ON!' }); return { text: 'Done! The site is in ' + match.n + ' colors now. Change it anytime from My Pocket (top right).' }; }
    if (choices.length) { themeAsking = true; return { text: 'Which one did you mean?', followUps: choices.map(choiceLabel) }; }
    // Not a name he knows: a real question goes to his normal answers.
    if (!themeAsking || /\?|\b(how|what|where|when|why|do you|can you)\b/i.test(q)) return null;
    return { text: "Hmm, I don't have that one. Try a team (Seahawks), a Pokémon (Pikachu) or a Magic color (Blue, Izzet) -- or tap My Pocket to see them all.", followUps: ['Seahawks', 'Pikachu', 'No thanks'] };
  };
  const chat = buildChat(corner, async q => {
    br.wake();
    const local = themeReply(q);
    if (local) { history.push({ role: 'user', content: q }, { role: 'assistant', content: local.text }); return { text: local.text, items: [], followUps: local.followUps || [] }; }
    br.play('thinking', { ms: 1200 });
    const res = await fetch(ASK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history: history.slice(-6), page: location.pathname, name: signedInFirstName() }) });
    const d = await res.json().catch(() => ({}));
    const text = d.ok ? String(d.answer || '') : String(d.error || 'Hmm, try that again?');
    history.push({ role: 'user', content: q }, { role: 'assistant', content: text });
    br.play(d.ok ? 'talking' : 'sad', { text: text.length > 90 ? text.slice(0, 88) + '…' : text });
    return { text, items: d.ok ? d.items || [] : [], followUps: d.ok ? d.followUps || [] : [] };
  });
  document.body.append(chat.box);
  chat.x.onclick = () => chat.close();
  close.onclick = e => { e.stopPropagation(); stopIdle(); safe(() => localStorage.setItem('byterider-hidden', '1')); br.destroy(); wrap.remove(); chat.box.remove(); showReturnTab(opts); };
  // On the frame round him (it takes the taps, not the face inside).
  wrap.onclick = e => { if (close.contains(e.target)) return; br.wake(); if (chat.isOpen) { chat.close(); br.play('wink', { text: LINES[line++ % LINES.length] }); } else { chat.open(); br.play('happy', { text: 'ASK ME ANYTHING!' }); } };
  // Hello, once a visit.
  if (!safe(() => sessionStorage.getItem('byterider-hello'))) {
    safe(() => sessionStorage.setItem('byterider-hello', '1'));
    br.play('disappearing', { boot: true });
    const who = signedInFirstName();
    br.play('talking', { text: who ? 'WELCOME BACK, ' + who.toUpperCase() + '!' : 'WELCOME TO THE POCKET, PRIMARY USER.' });
  }
  // No theme yet: after a quiet half minute he says hi and asks (twice a
  // device at most; "No thanks" ends it).
  let idle = null;
  const askTheme = () => {
    if (!wrap.isConnected || !shouldAsk({ store, path: location.pathname, chatOpen: chat.isOpen, modalOpen: !!document.querySelector('[aria-modal="true"]:not([inert]), #mp-theme-nudge') })) return;
    store.set(ASK_KEY, String((Number(store.get(ASK_KEY)) || 0) + 1));
    themeAsking = true; chat.open(); br.wake(); br.play('happy', { text: 'HEY! WHO\'S YOUR TEAM?' });
    const who = signedInFirstName();
    chat.say((who ? 'Hey ' + who + '! ' : 'Hi there! ') + "Want the site in your colors? Tell me your favorite team, Pokémon or Magic color -- like Seahawks, Pikachu or Blue -- and I'll set it.", ['Seahawks', 'Pikachu', 'Izzet (Magic)', 'No thanks']);
    stopIdle();
  };
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(askTheme, IDLE_MS); };
  const IDLE_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
  const stopIdle = () => { clearTimeout(idle); for (const ev of IDLE_EVENTS) window.removeEventListener(ev, resetIdle, true); };
  if (shouldAsk({ store, path: location.pathname })) { for (const ev of IDLE_EVENTS) window.addEventListener(ev, resetIdle, { capture: true, passive: true }); resetIdle(); }
  // Buttons that put something in the cart, or check out.
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('button,a,input[type=submit]');
    if (!b || !wrap.isConnected || wrap.contains(b)) return;
    const words = (b.textContent || b.value || b.getAttribute('aria-label') || '').toLowerCase();
    if (/check\s*out|place order|pay now/.test(words)) br.play('jackpot', { text: 'LET\'S GOOO!' });
    else if (/pre-?order/.test(words)) br.play('love', { text: 'LOCKED IN. GOOD CALL.' });
    else if (/add to (cart|bag)|buy now/.test(words)) br.play('happy', { text: 'GOOD PICK!' });
  }, true);
  // The website's own code can make him react.
  window.addEventListener('byterider', e => {
    if (!wrap.isConnected) return;
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
