// THE VENDING MACHINE (store, 2026-11-13: "polish up the vending machine ...
// full screen ... integrate the Whatnot app UI as part of it, like the bid
// button is the buy button on the machine ... for surprise sets, most things
// will be an item ... a break with 75 character spots"). One machine, drawn on
// the green screen (behind the hosts) or on the overlay (in front, full screen).
// Its slots: the items (or spots) in rows, scrolling; the one UP NOW glows with
// its BID button lit; what's gone is stamped SOLD. Our own neon design -- the
// BID pill is a generic auction button, no one's logo.
export const VENDING_CSS = `
.vm{position:absolute;display:flex;flex-direction:column;box-sizing:border-box;padding:16px;background:linear-gradient(#3b1670,#1d0b3a);border:10px solid #0b0612;border-radius:28px;box-shadow:inset 0 0 0 6px #ff3fd2,0 0 50px #ff3fd277;font-family:system-ui,sans-serif;color:#fff;z-index:20}
.vm[hidden]{display:none}
.vm.panel{left:170px;top:150px;width:740px;height:680px}
.vm.full{left:20px;top:20px;width:1040px;height:1880px;padding:26px}
.vm-head{display:flex;justify-content:space-between;align-items:center;gap:14px;background:#0b0612;border:4px solid #ffd84a;border-radius:14px;padding:12px 18px}
.vm-head .vm-live{background:#ff2a4f;color:#fff;font:900 20px system-ui;padding:4px 10px;border-radius:8px;animation:vm-blink 1.4s infinite}
.vm-head .vm-title{flex:1;font:900 34px/1 system-ui;color:#ffd84a;letter-spacing:2px;text-shadow:0 0 12px #ffd84a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vm.full .vm-head .vm-title{font-size:54px}
.vm-head .vm-count{font:800 22px system-ui;color:#9dff6a;white-space:nowrap}
.vm-bar{height:14px;background:#0b0612;border-radius:8px;margin:10px 0;overflow:hidden;border:2px solid #6b3fbf}
.vm-bar i{display:block;height:100%;background:linear-gradient(90deg,#9dff6a,#ffd84a);transition:width .6s}
.vm-up{display:none;align-items:center;gap:16px;background:#0b0612;border:4px solid #9dff6a;border-radius:16px;padding:12px;margin-bottom:12px;box-shadow:0 0 24px #9dff6a66}
.vm.has-up .vm-up{display:flex}
.vm-up img{width:110px;height:110px;object-fit:contain}
.vm.full .vm-up img{width:180px;height:180px}
.vm-up .vm-up-t{flex:1;min-width:0}
.vm-up .vm-up-t small{display:block;color:#9dff6a;font:900 18px system-ui;letter-spacing:3px}
.vm-up .vm-up-t b{display:block;font:900 30px/1.1 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vm.full .vm-up .vm-up-t b{font-size:46px}
.vm-glass{flex:1;overflow:hidden;border-radius:14px;background:linear-gradient(115deg,#ffffff1c 0 18%,#0000 18% 100%),#120726;border:5px solid #0b0612;padding:12px;box-shadow:inset 0 0 30px #000}
.vm-rows{display:grid;grid-template-columns:repeat(var(--vm-cols,3),1fr);gap:14px;will-change:transform}
.vm-slot{position:relative;height:var(--vm-h,190px);background:#1d0b3a;border:3px solid #6b3fbf;border-radius:12px;display:flex;flex-direction:column;align-items:center;padding:6px;box-sizing:border-box}
.vm-slot.up{border-color:#9dff6a;box-shadow:0 0 18px #9dff6a,inset 0 0 12px #9dff6a55;animation:vm-pulse 1.2s infinite}
.vm-pic{flex:1;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0}
.vm-pic img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 4px 6px #000)}
.vm-pic .vm-spot{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;border-radius:8px;background:radial-gradient(circle at 30% 25%,#ff3fd2,#3b1670 70%)}
.vm-pic .vm-spot em{font:900 38px system-ui;color:#ffd84a;font-style:normal;text-shadow:0 3px 0 #0b0612}
.vm-pic .vm-spot span{font:800 15px/1.1 system-ui;text-align:center;padding:0 6px;max-height:2.3em;overflow:hidden}
.vm-coil{width:90%;height:7px;background:repeating-linear-gradient(90deg,#c8c8d0 0 6px,#6a6a76 6px 12px);border-radius:4px;margin:4px 0}
.vm-buy{display:flex;align-items:center;gap:6px;width:100%}
.vm-buy b{color:#ffd84a;font:900 15px system-ui}
.vm-bid{flex:1;text-align:center;font:900 16px system-ui;color:#1b1300;background:linear-gradient(#ffe766,#f7c600);border-radius:999px;padding:5px 8px;box-shadow:0 3px 0 #a07a00}
.vm-slot.sold .vm-bid{background:#4a2a3a;color:#ff8a9a;box-shadow:none}
.vm-stamp{display:none;position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-10deg);font:900 28px system-ui;color:#fff;background:#e0213a;border:3px solid #fff;border-radius:8px;padding:4px 12px;box-shadow:0 0 18px #ff2a4f;font-style:normal}
.vm-slot.sold{border-color:#4a2a2a}
.vm-slot.sold img,.vm-slot.sold .vm-spot{filter:grayscale(1) brightness(.4)}
.vm-slot.sold .vm-stamp{display:block}
.vm-tray{display:flex;align-items:center;gap:16px;margin-top:12px;background:#0b0612;border-radius:14px;border:4px solid #6b3fbf;padding:10px 16px}
.vm-tray .vm-bigbid{font:900 30px system-ui;color:#1b1300;background:linear-gradient(#ffe766,#f7c600);border-radius:999px;padding:10px 36px;box-shadow:0 5px 0 #a07a00;animation:vm-pulse 1.2s infinite}
.vm.full .vm-tray .vm-bigbid{font-size:44px;padding:16px 60px}
.vm-tray span{flex:1;color:#cfc3ff;font:800 20px system-ui}
.vm-head .vm-count.low{color:#ff5a6e;animation:vm-blink .8s infinite}
.vm-last{display:none;position:absolute;left:50%;top:-26px;transform:translateX(-50%) rotate(-3deg);background:#ff2a4f;color:#fff;font:900 30px system-ui;padding:6px 22px;border-radius:12px;border:4px solid #fff;box-shadow:0 0 24px #ff2a4f;white-space:nowrap;animation:vm-pulse .9s infinite}
.vm.low .vm-last{display:block}
.vm-drop{position:absolute;z-index:3;pointer-events:none;display:flex;flex-direction:column;align-items:center;animation:vm-fall 1.5s cubic-bezier(.55,0,.8,.4) forwards}
.vm-drop img,.vm-drop .vm-spot{width:100%;height:100%;object-fit:contain;border-radius:8px}
.vm-drop b{position:absolute;top:-34px;font:900 28px system-ui;color:#ffd84a;text-shadow:0 3px 0 #0b0612;white-space:nowrap}
.vm-tray.got{animation:vm-thud .5s 1.3s}
@keyframes vm-fall{0%{transform:translateY(0) rotate(0)}15%{transform:translateY(-14px) rotate(-4deg)}100%{transform:translateY(var(--fall,600px)) rotate(14deg);opacity:.2}}
@keyframes vm-thud{30%{transform:translateY(6px);box-shadow:0 0 30px #ffd84a}}
/* Beasts mode: the same machine in the Game Boy's four greens. */
.vm.gb{background:#306230;border-color:#0f380f;box-shadow:inset 0 0 0 6px #8bac0f,0 0 0 #0000;font-family:ui-monospace,Menlo,monospace}
.vm.gb .vm-head,.vm.gb .vm-up,.vm.gb .vm-tray{background:#0f380f;border-color:#8bac0f;box-shadow:none}
.vm.gb .vm-head .vm-title{color:#9bbc0f;text-shadow:none;font-family:inherit}
.vm.gb .vm-head .vm-count,.vm.gb .vm-up .vm-up-t small,.vm.gb .vm-tray span{color:#9bbc0f}
.vm.gb .vm-head .vm-live,.vm.gb .vm-last{background:#9bbc0f;color:#0f380f;border-color:#0f380f;box-shadow:none}
.vm.gb .vm-glass{background:#0f380f;border-color:#0f380f}
.vm.gb .vm-slot{background:#306230;border-color:#8bac0f}
.vm.gb .vm-slot.up{border-color:#9bbc0f;box-shadow:0 0 0 4px #9bbc0f}
.vm.gb .vm-pic .vm-spot{background:#8bac0f}.vm.gb .vm-pic .vm-spot em{color:#0f380f;text-shadow:none}.vm.gb .vm-pic .vm-spot span{color:#0f380f}
.vm.gb .vm-bid,.vm.gb .vm-tray .vm-bigbid{background:#9bbc0f;color:#0f380f;box-shadow:0 3px 0 #0f380f}
.vm.gb .vm-buy b{color:#9bbc0f}.vm.gb .vm-bar i{background:#9bbc0f}.vm.gb .vm-bar{border-color:#8bac0f;background:#0f380f}
.vm.gb .vm-stamp{background:#0f380f;color:#9bbc0f;border-color:#9bbc0f;box-shadow:none}
.vm.gb img{filter:grayscale(1) sepia(1) hue-rotate(40deg) saturate(2.2) brightness(.85)}
@keyframes vm-pulse{50%{filter:brightness(1.25)}}
@keyframes vm-blink{50%{opacity:.55}}
`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const code = i => String.fromCharCode(65 + Math.floor(i / 3) % 26) + (i % 3 + 1);
const money = v => Number(v) > 0 ? '$' + (Number(v) % 1 ? Number(v).toFixed(2) : Number(v).toFixed(0)) : '';
// Which slot is up: the one the host set, else the first not sold.
export function upIndex(mc) { if (!mc?.items?.length) return -1; if (Number.isInteger(mc.up) && mc.items[mc.up] && !mc.items[mc.up].sold) return mc.up; return mc.items.findIndex(i => !i.sold); }
// Make a machine in this document; img(url) proxies photos. Returns draw(machine, { where }).
export function createVending(doc, { img = u => u, where = 'green' } = {}) {
  if (!doc.getElementById('vm-css')) { const st = doc.createElement('style'); st.id = 'vm-css'; st.textContent = VENDING_CSS; doc.head.append(st); }
  const vm = doc.createElement('div'); vm.className = 'vm panel'; vm.hidden = true; doc.body.append(vm);
  vm.innerHTML = '<b class="vm-last"></b><div class="vm-head"><span class="vm-live">LIVE</span><b class="vm-title"></b><span class="vm-count"></span></div><div class="vm-bar"><i></i></div><div class="vm-up"><img alt=""><div class="vm-up-t"><small>UP NOW</small><b></b></div><span class="vm-bid vm-up-bid"></span></div><div class="vm-glass"><div class="vm-rows"></div></div><div class="vm-tray"><span class="vm-bigbid">BID</span><span class="vm-hint"></span></div>';
  let key = '', y = 0, last = 0, wasSold = null, listKey = '';
  (function scroll(now) { requestAnimationFrame(scroll); if (vm.hidden) return; const rows = vm.querySelector('.vm-rows'), glass = vm.querySelector('.vm-glass'), half = rows.scrollHeight / 2; if (!rows.dataset.loop) { rows.style.transform = ''; return; } y += (now - (last || now)) / 1000 * (vm.classList.contains('full') ? 34 : 26); last = now; if (y >= half) y -= half; rows.style.transform = 'translateY(' + (-y) + 'px)'; if (glass.clientHeight > half) { rows.style.transform = ''; } })(0);
  // A slot just sold: its item drops off the coil into the tray, VEND! (2026-11-13: more features).
  const drop = (it, i) => { const glass = vm.querySelector('.vm-glass'), tray = vm.querySelector('.vm-tray'), box = vm.getBoundingClientRect(), g = glass.getBoundingClientRect(); let at = null; for (const el of vm.querySelectorAll('.vm-slot[data-i="' + i + '"]')) { const r = el.getBoundingClientRect(); if (r.bottom > g.top && r.top < g.bottom) { at = r; break; } } const w = at ? at.width * 0.8 : 160, h = at ? (at.height - 50) : 160, x = at ? at.left - box.left + at.width * 0.1 : (box.width - w) / 2, top = at ? at.top - box.top + 6 : g.top - box.top + 10; const d = doc.createElement('div'); d.className = 'vm-drop'; Object.assign(d.style, { left: x + 'px', top: top + 'px', width: w + 'px', height: h + 'px' }); d.style.setProperty('--fall', Math.max(80, tray.getBoundingClientRect().top - box.top - top - h * 0.4) + 'px'); d.innerHTML = (it.image ? '<img alt="" src="' + esc(img(it.image)) + '">' : '<div class="vm-spot"><em>' + (i + 1) + '</em></div>') + '<b>' + code(i) + ' VEND!</b>'; vm.append(d); tray.classList.remove('got'); void tray.offsetWidth; tray.classList.add('got'); setTimeout(() => d.remove(), 1600); };
  return function draw(mc, { theme = '' } = {}) {
    // Where it shows: 'panel' and 'full' on the green screen; 'front' on the overlay (full screen, in front).
    const mode = mc?.mode || 'panel', mine = where === 'overlay' ? mode === 'front' : mode !== 'front';
    vm.hidden = !(mc && mc.on && mc.items?.length && mine); if (vm.hidden) return;
    const full = mode !== 'panel', k = JSON.stringify([mc, full, theme]); if (k === key) return; key = k;
    vm.className = 'vm ' + (full ? 'full' : 'panel') + (theme === 'gb' ? ' gb' : '');
    const n = mc.items.length, sold = mc.items.filter(i => i.sold).length, up = upIndex(mc), cols = full ? (n > 40 ? 5 : 4) : 3;
    vm.style.setProperty('--vm-cols', cols); vm.style.setProperty('--vm-h', (full ? (n > 40 ? 230 : 280) : 190) + 'px');
    vm.querySelector('.vm-title').textContent = mc.title || 'MANA POCKET VENDING';
    const left = n - sold, cnt = vm.querySelector('.vm-count'); cnt.textContent = left + ' / ' + n + ' LEFT'; cnt.classList.toggle('low', left > 0 && left <= 5);
    // The last few: LAST 3 SPOTS! (only when there were more than ten to begin with).
    vm.classList.toggle('low', n > 10 && left > 0 && left <= 5); vm.querySelector('.vm-last').textContent = left === 1 ? 'LAST ONE!' : 'LAST ' + left + (mc.kind === 'spots' ? ' SPOTS!' : ' LEFT!');
    vm.querySelector('.vm-bar i').style.width = (n ? (sold / n) * 100 : 0) + '%';
    vm.classList.toggle('has-up', up >= 0);
    if (up >= 0) { const it = mc.items[up], im = vm.querySelector('.vm-up img'); im.hidden = !it.image; if (it.image) im.src = img(it.image); vm.querySelector('.vm-up-t b').textContent = code(up) + '  ' + it.title; vm.querySelector('.vm-up-bid').textContent = 'BID ' + (money(it.price) || ''); }
    vm.querySelector('.vm-hint').textContent = up >= 0 ? 'SLOT ' + code(up) + ' IS UP -- TAP BID IN THE APP' : 'SOLD OUT -- THANK YOU!';
    const slot = (it, i) => '<div data-i="' + i + '" class="vm-slot' + (it.sold ? ' sold' : '') + (i === up ? ' up' : '') + '"><div class="vm-pic">' + (it.image ? '<img alt="" src="' + esc(img(it.image)) + '">' : '<div class="vm-spot"><em>' + (i + 1) + '</em><span>' + esc(it.title) + '</span></div>') + '</div><div class="vm-coil"></div><div class="vm-buy"><b>' + code(i) + '</b><span class="vm-bid">' + (it.sold ? 'SOLD' : 'BID ' + money(it.price)) + '</span></div><em class="vm-stamp">SOLD</em></div>';
    // Which slots just sold (the same list, one more SOLD): drop them after the slots repaint.
    const lk = mc.items.map(i => i.title).join('\u0001'), fresh = wasSold && lk === listKey ? mc.items.map((it, i) => it.sold && !wasSold[i] ? i : -1).filter(i => i >= 0).slice(0, 2) : [];
    wasSold = mc.items.map(i => !!i.sold); const keepY = lk === listKey; listKey = lk;
    const html = mc.items.map(slot).join(''), rows = vm.querySelector('.vm-rows'), loop = n > (full ? cols * 5 : 9);
    rows.innerHTML = html + (loop ? html : ''); if (loop) rows.dataset.loop = '1'; else delete rows.dataset.loop; if (!keepY) y = 0;
    for (const i of fresh) drop(mc.items[i], i);
  };
}
// SPOTS for a break or a surprise set (no inventory): "75 spots at $5", or one name a line.
export function makeSpots({ count = 0, price = 0, names = '', prefix = 'SPOT' } = {}) {
  const list = String(names || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 120), n = list.length || Math.max(0, Math.min(120, Math.floor(Number(count) || 0)));
  return Array.from({ length: n }, (_, i) => ({ title: (list[i] || (String(prefix || 'SPOT').trim().toUpperCase() + ' ' + (i + 1))).slice(0, 90), price: Number(price) > 0 ? Math.round(Number(price) * 100) / 100 : 0, sold: false }));
}
