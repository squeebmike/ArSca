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
.vm-slot:not([data-i]) .vm-spot{background:#2a1450;opacity:.6}
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
/* THE KIOSK LOOK (store, 2026-11-13: "like that" -- the store's touch-screen vending kiosks and the app's buy bar):
   a tall white screen in a black bezel, photos in rows of three, a black SOLD OUT band across what's gone, the name and
   price under each; the item UP NOW as an app-style card, a LEFT pill and a big yellow BID NOW button. Our own design. */
.vm-tab,.vm-sub,.vm-name,.vm-price,.vm-left,.vm-up-d,.vm-up-p{display:none}
.vm.kiosk{background:#e9edf3;border:18px solid #111;border-radius:34px;box-shadow:0 0 0 4px #333,0 20px 40px #0009;color:#1a1d24;padding:14px 14px 16px}
.vm.kiosk .vm-tab{display:flex;position:absolute;top:14px;width:30px;height:150px;background:#d8262c;color:#fff;font:900 14px system-ui;letter-spacing:2px;writing-mode:vertical-rl;align-items:center;justify-content:center;font-style:normal;border-radius:4px}
.vm.kiosk .vm-tab-l{left:14px;transform:rotate(180deg)}.vm.kiosk .vm-tab-r{right:14px}
.vm.kiosk .vm-head{background:#fff;border:0;border-radius:8px;margin:0 36px;flex-direction:column;gap:4px;padding:10px 14px;box-shadow:0 2px 6px #0002}
.vm.kiosk .vm-head-t{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0;width:100%}
.vm.kiosk .vm-head .vm-title{color:#1a1d24;text-shadow:none;font-size:32px;letter-spacing:1px;max-width:100%}
.vm.full.kiosk .vm-head .vm-title{font-size:48px}
.vm.kiosk .vm-sub{display:block;color:#d8262c;font:800 15px system-ui;letter-spacing:.5px}
.vm.kiosk .vm-head .vm-count{color:#1a1d24;font-size:18px}
.vm.kiosk .vm-head .vm-count.low{color:#d8262c}
.vm.kiosk .vm-bar{display:none}
.vm.kiosk .vm-glass{background:#f6f8fb;border:0;border-radius:8px;margin-top:12px;box-shadow:inset 0 0 0 1px #d5dbe5}
.vm.kiosk .vm-slot{background:transparent;border:0;border-radius:6px;padding:4px}
.vm.kiosk .vm-slot.up{box-shadow:0 0 0 4px #ffd400,0 0 18px #ffd40099;animation:none;background:#fffbe0}
.vm.kiosk .vm-pic img{filter:drop-shadow(0 6px 6px #0004)}
.vm.kiosk .vm-pic .vm-spot{background:linear-gradient(160deg,#fff,#dfe5ee);border:2px solid #c9d1dd}
.vm.kiosk .vm-pic .vm-spot em{color:#1a1d24;text-shadow:none}.vm.kiosk .vm-pic .vm-spot span{color:#555}
.vm.kiosk .vm-name{display:block;width:100%;text-align:center;font:700 14px/1.15 system-ui;color:#2a2f3a;max-height:2.3em;overflow:hidden;margin-top:4px}
.vm.full.kiosk .vm-name{font-size:18px}
.vm.kiosk .vm-price{display:block;font:900 16px system-ui;color:#e06a00}
.vm.full.kiosk .vm-price{font-size:22px}
.vm.kiosk .vm-coil,.vm.kiosk .vm-buy{display:none}
.vm.kiosk .vm-stamp{top:34%;left:0;right:0;transform:none;background:#111;border:0;border-radius:0;box-shadow:none;text-align:center;font:900 22px system-ui;letter-spacing:1px;padding:5px 0}
.vm.kiosk .vm-slot.sold img,.vm.kiosk .vm-slot.sold .vm-spot{filter:grayscale(.2) brightness(.95);opacity:.75}
.vm.kiosk .vm-slot.sold{border:0}
.vm.kiosk .vm-up{order:5;background:#1b1d22;border:0;border-radius:16px;margin:12px 0 0;box-shadow:0 4px 12px #0005;color:#fff}
.vm.kiosk .vm-up img{border-radius:8px;background:#fff}
.vm.kiosk .vm-up .vm-up-t small{color:#ffd400}
.vm.kiosk .vm-up-d{display:block;font:600 18px system-ui;color:#cfd3dc;font-style:normal}
.vm.kiosk .vm-up-p{display:block;font:900 34px system-ui;color:#fff;white-space:nowrap}
.vm.kiosk .vm-up-bid{display:none}
.vm.kiosk .vm-tray{order:6;background:transparent;border:0;padding:12px 0 0;gap:12px}
.vm.kiosk .vm-left{display:block;background:#ffd400;color:#111;font:900 22px system-ui;border-radius:999px;padding:10px 20px;white-space:nowrap}
.vm.kiosk .vm-tray .vm-hint{color:#4a5160;font-size:16px}
.vm.kiosk .vm-tray .vm-bigbid{background:#ffd400;color:#111;border:4px solid #111;box-shadow:0 0 0 3px #ffd400;animation:vm-pulse 1.4s infinite;white-space:nowrap}
.vm.kiosk .vm-last{background:#d8262c}
/* THE BREAK BOARD: who has the spot (only sent with SHOW BUYER NAMES on). */
.vm-who{position:absolute;top:calc(34% + 34px);left:4px;right:4px;text-align:center;font:900 15px system-ui;font-style:normal;color:#fff;background:#d8262c;border-radius:6px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vm.gb .vm-who{background:#0f380f;color:#9bbc0f}
/* POLISH (store, 2026-11-14: "do all new vending machine ideas and polish"): a shine sweeping the glass, each slot's
   number lit while it's open, the SOLD OUT sign lighting up, the big button pressing in on a vend, the slots filling in
   one by one on a restock (the coils turning), CHANGE RETURN -- a free giveaway for everyone every N sold. */
.vm-glass{position:relative}
.vm-glass::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(105deg,#0000 35%,#ffffff2a 45%,#ffffff10 50%,#0000 60%);background-size:250% 100%;animation:vm-shine 6s linear infinite}
@keyframes vm-shine{from{background-position:120% 0}to{background-position:-120% 0}}
.vm-num{position:absolute;top:6px;left:6px;z-index:2;font:900 14px system-ui;font-style:normal;color:#1b1300;background:#ffd84a;border-radius:6px;padding:1px 6px;box-shadow:0 0 10px #ffd84a}
.vm-slot.sold .vm-num{background:#555;color:#bbb;box-shadow:none}
.vm.gb .vm-num{background:#9bbc0f;color:#0f380f;box-shadow:none}
.vm-out{display:none;position:absolute;right:26px;top:-24px;font:900 24px system-ui;color:#fff;background:#111;border:3px solid #ff2a4f;border-radius:10px;padding:4px 14px;box-shadow:0 0 20px #ff2a4f;animation:vm-blink 1s infinite}
.vm.out .vm-out{display:block}
.vm-bigbid.press{animation:vm-press .5s 2 !important}
@keyframes vm-press{40%{transform:translateY(6px) scale(.96);box-shadow:0 0 0 #0000}}
.vm.restock .vm-slot{animation:vm-in .5s backwards}
@keyframes vm-in{from{opacity:0;transform:translateY(-30px) rotate(-6deg)}}
.vm.restock .vm-coil{animation:vm-coil .4s 3 linear}
@keyframes vm-coil{to{background-position:24px 0}}
.vm-change{display:none;position:absolute;left:50%;bottom:120px;transform:translateX(-50%) rotate(-2deg);z-index:5;background:#ffd84a;color:#1b1300;border:5px solid #111;border-radius:16px;padding:10px 26px;font:900 34px/1.05 system-ui;text-align:center;box-shadow:0 0 40px #ffd84a;white-space:nowrap}
.vm-change small{display:block;font:800 18px system-ui}
.vm.change .vm-change{display:block;animation:vm-pop .5s cubic-bezier(.2,1.6,.4,1)}
@keyframes vm-pop{from{transform:translateX(-50%) scale(.3) rotate(-12deg)}}
/* THEMES: the same machine in a comic shop's red and yellow, a card shop's red and white, or a dark purple and gold. */
.vm.kiosk.t-comics{background:#fff6d6;border-color:#c8102e}.vm.kiosk.t-comics .vm-tab{background:#ffd200;color:#c8102e}.vm.kiosk.t-comics .vm-glass,.vm.kiosk.t-comics .vm-shelf{background:repeating-radial-gradient(circle at 0 0,#ffe9a8 0 2px,#fff6d6 2px 7px)}.vm.kiosk.t-comics .vm-head .vm-title{color:#c8102e}
.vm.kiosk.t-cards{background:#f4f4f4;border-color:#d81e2a}.vm.kiosk.t-cards .vm-tab{background:#1a1a1a}.vm.kiosk.t-cards .vm-head{border-bottom:6px solid #d81e2a}
.vm.kiosk.t-arcane{background:#1c1330;border-color:#0b0612;color:#efe6ff}.vm.kiosk.t-arcane .vm-tab{background:#c9a227;color:#1c1330}.vm.kiosk.t-arcane .vm-head{background:#2a1d48}.vm.kiosk.t-arcane .vm-head .vm-title{color:#e9c95a}.vm.kiosk.t-arcane .vm-glass,.vm.kiosk.t-arcane .vm-shelf{background:#241a3c}.vm.kiosk.t-arcane .vm-name,.vm.kiosk.t-arcane .vm-cn,.vm.kiosk.t-arcane .vm-shelf h4{color:#e6dcff}
/* THE SHOWCASE (store, 2026-11-14: "the vending machine on the lower half during the pre-release shows ... the books for
   pre-bid, the new releases, and the stuff that's in the bin rotating through, with the price showing"): two shelves --
   NEW RELEASES (pre-order, with the FOC or on-sale date) and IN THE BIN (buy it now, the price big) -- turning a page
   every few seconds. */
.vm.lower{left:20px;top:1000px;width:1040px;height:880px}
.vm.showcase .vm-glass,.vm.showcase .vm-up,.vm.showcase .vm-tray,.vm.showcase .vm-bar{display:none !important}
.vm-shelves{display:none;flex:1;flex-direction:column;gap:14px;margin-top:12px;min-height:0}
.vm.showcase .vm-shelves{display:flex}
.vm-shelf{flex:1;display:flex;flex-direction:column;min-height:0;background:#f6f8fb;border-radius:12px;box-shadow:inset 0 0 0 1px #d5dbe5;padding:10px 12px;overflow:hidden;position:relative}
.vm-shelf[hidden]{display:none}
.vm-shelf h4{margin:0 0 8px;font:900 26px system-ui;letter-spacing:1px;color:#1a1d24;display:flex;align-items:center;gap:10px}
.vm-shelf h4 i{font-style:normal;background:#d8262c;color:#fff;border-radius:999px;font-size:16px;padding:3px 12px}
.vm-shelf[data-shelf=bin] h4 i{background:#13a05f}
.vm-track{flex:1;display:flex;gap:14px;transition:transform .9s cubic-bezier(.6,0,.2,1);min-height:0}
.vm-card{flex:0 0 calc((100% - 56px) / 5);display:flex;flex-direction:column;align-items:center;min-height:0;position:relative}
.vm-card .vm-pic img{filter:drop-shadow(0 6px 6px #0004)}
.vm-card .vm-cn{font:700 15px/1.15 system-ui;color:#2a2f3a;text-align:center;max-height:2.3em;overflow:hidden;margin-top:4px}
.vm-card .vm-cp{font:900 24px system-ui;color:#e06a00;margin-top:2px}
.vm-card .vm-cb{position:absolute;top:2px;left:2px;font:900 13px system-ui;background:#111;color:#ffd400;border-radius:6px;padding:2px 7px}
.vm-shelf[data-shelf=bin] .vm-card .vm-cp{color:#13a05f;font-size:28px}
.vm-dots{position:absolute;right:14px;top:16px;font:900 16px system-ui;color:#6b7383}
/* FLASH SALE (store, 2026-11-14: "flash the stuff on flash sales, with crossed out prices"): the old price struck through,
   the new one big, a flashing FLASH SALE tag on each, and a banner counting down across the top. */
.vm-was{text-decoration:line-through;text-decoration-thickness:3px;text-decoration-color:#e0213a;color:#8a8f99;font-weight:800;margin-right:6px;font-size:.8em}
.vm-slot.flash,.vm-card.flash{animation:vm-flash .7s steps(2) infinite}
@keyframes vm-flash{50%{box-shadow:0 0 0 4px #ff2a4f,0 0 26px #ff2a4f;background:#fff0f2}}
.vm-ftag{position:absolute;top:4px;right:4px;z-index:3;font:900 13px system-ui;font-style:normal;background:#ff2a4f;color:#fff;border-radius:6px;padding:2px 7px;animation:vm-blink .6s infinite}
.vm-flashbar{display:none;margin:8px 36px 0;background:linear-gradient(90deg,#ff2a4f,#ff8a00,#ff2a4f);background-size:200% 100%;animation:vm-shine 2s linear infinite;color:#fff;font:900 30px system-ui;text-align:center;border-radius:12px;padding:6px 10px;letter-spacing:2px;text-shadow:0 2px 0 #0006}
.vm.flashing .vm-flashbar{display:block}
@keyframes vm-pulse{50%{filter:brightness(1.25)}}
@keyframes vm-blink{50%{opacity:.55}}
`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const code = i => '#' + (i + 1); // the spot's number (the same on every size of machine)
// A flash sale on an item (until its time runs out): the old price crossed out before the new one.
const onFlash = it => Number(it?.wasPrice) > Number(it?.price) && (!it.flashUntil || Date.now() < it.flashUntil);
const priceHtml = it => onFlash(it) ? '<span class="vm-was">' + money(it.wasPrice) + '</span>' + money(it.price) : money(onFlash(it) || !it?.flashUntil ? it?.price : (it.wasPrice || it.price));
const money = v => Number(v) > 0 ? '$' + (Number(v) % 1 ? Number(v).toFixed(2) : Number(v).toFixed(0)) : '';
// Which slot is up: the one the host set, else the first not sold.
export function upIndex(mc) { if (!mc?.items?.length) return -1; if (Number.isInteger(mc.up) && mc.items[mc.up] && !mc.items[mc.up].sold) return mc.up; return mc.items.findIndex(i => !i.sold); }
// Make a machine in this document; img(url) proxies photos. Returns draw(machine, { where }).
export function createVending(doc, { img = u => u, where = 'green' } = {}) {
  if (!doc.getElementById('vm-css')) { const st = doc.createElement('style'); st.id = 'vm-css'; st.textContent = VENDING_CSS; doc.head.append(st); }
  const vm = doc.createElement('div'); vm.className = 'vm panel'; vm.hidden = true; doc.body.append(vm);
  vm.innerHTML = '<b class="vm-last"></b><b class="vm-out">SOLD OUT</b><div class="vm-change">CHANGE RETURN!<small>A FREE GIVEAWAY FOR EVERYONE WATCHING</small></div><i class="vm-tab vm-tab-l">MANA POCKET</i><i class="vm-tab vm-tab-r">MANA POCKET</i><div class="vm-head"><span class="vm-live">LIVE</span><div class="vm-head-t"><b class="vm-title"></b><small class="vm-sub">STOCK UPDATES LIVE · ONE PER WIN · BID IN THE APP</small></div><span class="vm-count"></span></div><div class="vm-flashbar"></div><div class="vm-bar"><i></i></div><div class="vm-up"><img alt=""><div class="vm-up-t"><small>UP NOW</small><b></b><em class="vm-up-d"></em></div><b class="vm-up-p"></b><span class="vm-bid vm-up-bid"></span></div><div class="vm-glass"><div class="vm-rows"></div></div><div class="vm-shelves"><div class="vm-shelf" data-shelf="pre"><h4>NEW RELEASES <i>PRE-ORDER NOW</i></h4><b class="vm-dots"></b><div class="vm-track"></div></div><div class="vm-shelf" data-shelf="bin"><h4>IN THE BIN <i>BUY IT NOW</i></h4><b class="vm-dots"></b><div class="vm-track"></div></div></div><div class="vm-tray"><span class="vm-left"></span><span class="vm-hint"></span><span class="vm-bigbid">BID NOW ››</span></div>';
  let key = '', y = 0, last = 0, wasSold = null, listKey = '';
  (function scroll(now) { requestAnimationFrame(scroll); if (vm.hidden) return; const rows = vm.querySelector('.vm-rows'), glass = vm.querySelector('.vm-glass'), half = rows.scrollHeight / 2; if (!rows.dataset.loop) { rows.style.transform = ''; return; } y += (now - (last || now)) / 1000 * (vm.classList.contains('full') ? 34 : 26); last = now; if (y >= half) y -= half; rows.style.transform = 'translateY(' + (-y) + 'px)'; if (glass.clientHeight > half) { rows.style.transform = ''; } })(0);
  // The showcase's shelves turn a page every 5 seconds (5 to a page), each on its own clock.
  const pages = { pre: 0, bin: 0 };
  setInterval(() => { if (vm.hidden || !vm.classList.contains('showcase')) return; for (const sh of vm.querySelectorAll('.vm-shelf')) { const k = sh.dataset.shelf, n = sh.querySelectorAll('.vm-card').length, pn = Math.max(1, Math.ceil(n / 5)); pages[k] = (pages[k] + 1) % pn; const tr = sh.querySelector('.vm-track'); tr.style.transform = 'translateX(calc(' + (-pages[k] * 100) + '% - ' + (pages[k] * 14) + 'px))'; sh.querySelector('.vm-dots').textContent = pn > 1 ? (pages[k] + 1) + ' / ' + pn : ''; } }, 5000);
  // The vend's sounds: a coin in, the coil's whirr, the thud in the tray (where the browser lets a page play sound).
  let ac = null; const beep = (f, d, type = 'square', at = 0, vol = 0.05) => { try { ac ||= new (doc.defaultView.AudioContext || doc.defaultView.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + at; o.type = type; o.frequency.setValueAtTime(f, t0); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + d); } catch {} };
  const vendSound = () => { beep(1568, 0.08, 'square', 0); beep(2093, 0.12, 'square', 0.08); for (let k = 0; k < 6; k++) beep(180 + k * 12, 0.07, 'sawtooth', 0.25 + k * 0.07, 0.03); beep(70, 0.25, 'sine', 1.35, 0.12); };
  let changeAt = 0, soldBefore = -1, flashEnd = 0, lastMc = null;
  // The flash sale's countdown ticks every second; when it runs out the machine redraws at the old prices.
  const clock = ms => { const sx = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(sx / 60) + ':' + String(sx % 60).padStart(2, '0'); };
  setInterval(() => { if (vm.hidden || !flashEnd) return; const bar = vm.querySelector('.vm-flashbar'); if (Date.now() >= flashEnd) { flashEnd = 0; key = ''; if (lastMc) drawFn(lastMc.mc, lastMc.o); return; } bar.textContent = bar.textContent.replace(/ENDS IN [0-9:]+/, 'ENDS IN ' + clock(flashEnd - Date.now())); }, 1000);
  // A slot just sold: its item drops off the coil into the tray, VEND! (2026-11-13: more features).
  const drop = (it, i) => { const glass = vm.querySelector('.vm-glass'), tray = vm.querySelector('.vm-tray'), box = vm.getBoundingClientRect(), g = glass.getBoundingClientRect(); let at = null; for (const el of vm.querySelectorAll('.vm-slot[data-i="' + i + '"]')) { const r = el.getBoundingClientRect(); if (r.bottom > g.top && r.top < g.bottom) { at = r; break; } } const w = at ? at.width * 0.8 : 160, h = at ? (at.height - 50) : 160, x = at ? at.left - box.left + at.width * 0.1 : (box.width - w) / 2, top = at ? at.top - box.top + 6 : g.top - box.top + 10; const d = doc.createElement('div'); d.className = 'vm-drop'; Object.assign(d.style, { left: x + 'px', top: top + 'px', width: w + 'px', height: h + 'px' }); d.style.setProperty('--fall', Math.max(80, tray.getBoundingClientRect().top - box.top - top - h * 0.4) + 'px'); d.innerHTML = (it.image ? '<img alt="" src="' + esc(img(it.image)) + '">' : '<div class="vm-spot"><em>' + (i + 1) + '</em></div>') + '<b>' + code(i) + ' VEND!</b>'; vm.append(d); tray.classList.remove('got'); void tray.offsetWidth; tray.classList.add('got'); setTimeout(() => d.remove(), 1600); };
  const drawFn = function draw(mc, { theme = '' } = {}) {
    lastMc = { mc, o: { theme } };
    const sc = mc?.kind === 'showcase';
    // Where it shows: 'panel' and 'full' on the green screen; 'front' on the overlay (full screen, in front).
    const mode = mc?.mode || (sc ? 'lower' : 'panel'), mine = where === 'overlay' ? mode === 'front' : mode !== 'front';
    // On with nothing in it yet: it still shows, empty, saying how to stock it (2026-11-13: "I click and see nothing").
    vm.hidden = !(mc && mc.on && mine); if (vm.hidden) return; if (!Array.isArray(mc.items)) mc = { ...mc, items: [] };
    const full = mode !== 'panel', k = JSON.stringify([mc, full, theme]); if (k === key) return; key = k;
    const restock = listKey !== mc.items.map(i => i.title).join('\u0001') && mc.items.length > 0;
    vm.className = 'vm ' + (mode === 'lower' ? 'lower' : full ? 'full' : 'panel') + (theme === 'gb' ? ' gb' : ' kiosk') + (mc.theme && theme !== 'gb' ? ' t-' + mc.theme : '') + (sc ? ' showcase' : '') + (restock ? ' restock' : '');
    const n = mc.items.length, sold = mc.items.filter(i => i.sold).length, up = upIndex(mc), cols = full ? (n > 40 ? 5 : 4) : 3;
    vm.style.setProperty('--vm-cols', cols); vm.style.setProperty('--vm-h', (full ? (n > 40 ? 270 : 330) : 220) + 'px');
    vm.querySelector('.vm-title').textContent = mc.title || 'MANA POCKET VENDING';
    vm.querySelector('.vm-sub').textContent = sc ? 'PRE-ORDER THE NEW BOOKS · THE BIN IS BUY IT NOW · IN THE APP' : 'STOCK UPDATES LIVE · ONE PER WIN · BID IN THE APP';
    const left = n - sold, cnt = vm.querySelector('.vm-count'); cnt.textContent = left + ' / ' + n + ' LEFT'; cnt.classList.toggle('low', left > 0 && left <= 5);
    // The last few: LAST 3 SPOTS! (only when there were more than ten to begin with).
    vm.classList.toggle('low', n > 10 && left > 0 && left <= 5); vm.querySelector('.vm-last').textContent = left === 1 ? 'LAST ONE!' : 'LAST ' + left + (mc.kind === 'spots' ? ' SPOTS!' : ' LEFT!');
    vm.querySelector('.vm-bar i').style.width = (n ? (sold / n) * 100 : 0) + '%';
    vm.classList.toggle('out', n > 0 && sold === n && !sc);
    const flashing = mc.items.filter(it => onFlash(it) && !it.sold); vm.classList.toggle('flashing', flashing.length > 0); flashEnd = Math.max(0, ...flashing.map(it => Number(it.flashUntil) || 0));
    vm.querySelector('.vm-flashbar').textContent = flashing.length ? '⚡ FLASH SALE ⚡ ' + flashing.length + ' ITEM' + (flashing.length > 1 ? 'S' : '') + (flashEnd ? ' · ENDS IN ' + clock(flashEnd - Date.now()) : '') : '';
    // CHANGE RETURN: every N sold (the host's number), a free giveaway for everyone watching -- shown for 9 seconds.
    const every = Number(mc.giveEvery) || 0; if (every > 0 && soldBefore >= 0 && Math.floor(sold / every) > Math.floor(soldBefore / every)) changeAt = Date.now(); soldBefore = sold;
    vm.classList.toggle('change', Date.now() - changeAt < 9000); if (Date.now() - changeAt < 9000) setTimeout(() => { key = ''; vm.classList.remove('change'); }, 9100 - (Date.now() - changeAt));
    // THE SHOWCASE: the two shelves.
    if (sc) { listKey = mc.items.map(i => i.title).join('\u0001'); for (const sh of vm.querySelectorAll('.vm-shelf')) { const k = sh.dataset.shelf, list = mc.items.filter(it => (it.shelf || 'bin') === k); sh.hidden = !list.length; sh.querySelector('.vm-track').innerHTML = list.map(it => '<div class="vm-card' + (onFlash(it) ? ' flash' : '') + '"><i class="vm-num">' + (mc.items.indexOf(it) + 1) + '</i><div class="vm-pic">' + (it.image ? '<img alt="" src="' + esc(img(it.image)) + '">' : '') + '</div>' + (it.badge ? '<b class="vm-cb">' + esc(it.badge) + '</b>' : '') + '<div class="vm-cn">' + esc(it.title) + '</div><b class="vm-cp">' + (money(it.price) || '') + '</b></div>').join(''); } vm.querySelector('.vm-count').textContent = mc.items.filter(i => i.shelf === 'pre').length + ' NEW · ' + mc.items.filter(i => (i.shelf || 'bin') === 'bin').length + ' IN THE BIN'; return; }
    vm.classList.toggle('has-up', up >= 0);
    if (up >= 0) { const it = mc.items[up], im = vm.querySelector('.vm-up img'); im.hidden = !it.image; if (it.image) im.src = img(it.image); vm.querySelector('.vm-up-t b').textContent = code(up) + '  ' + it.title; vm.querySelector('.vm-up-bid').textContent = 'BID ' + (money(it.price) || ''); vm.querySelector('.vm-up-d').textContent = it.detail || (mc.kind === 'spots' ? 'SPOT ' + (up + 1) + ' OF ' + n : ''); vm.querySelector('.vm-up-p').innerHTML = priceHtml(it); }
    vm.querySelector('.vm-left').textContent = n ? (n - sold) + ' LEFT' : 'STOCKING';
    vm.querySelector('.vm-hint').textContent = !n ? 'STOCKING UP -- BACK IN A SEC!' : up >= 0 ? 'SLOT ' + code(up) + ' IS UP -- TAP BID IN THE APP' : 'SOLD OUT -- THANK YOU!';
    const slot = (it, i) => '<div data-i="' + i + '" class="vm-slot' + (it.sold ? ' sold' : '') + (onFlash(it) && !it.sold ? ' flash' : '') + (i === up ? ' up' : '') + '"><i class="vm-num">' + (i + 1) + '</i><div class="vm-pic">' + (it.image ? '<img alt="" src="' + esc(img(it.image)) + '">' : '<div class="vm-spot"><em>' + (i + 1) + '</em><span>' + esc(it.title) + '</span></div>') + '</div><div class="vm-name">' + esc(it.title) + '</div><b class="vm-price">' + (priceHtml(it) || '&nbsp;') + '</b>' + (onFlash(it) && !it.sold ? '<i class="vm-ftag">⚡ FLASH SALE</i>' : '') + '<div class="vm-coil"></div><div class="vm-buy"><b>' + code(i) + '</b><span class="vm-bid">' + (it.sold ? 'SOLD' : 'BID ' + money(it.price)) + '</span></div><em class="vm-stamp">SOLD</em>' + (it.buyer ? '<em class="vm-who">@' + esc(it.buyer) + '</em>' : '') + '</div>';
    // Which slots just sold (the same list, one more SOLD): drop them after the slots repaint.
    const lk = mc.items.map(i => i.title).join('\u0001'), fresh = wasSold && lk === listKey ? mc.items.map((it, i) => it.sold && !wasSold[i] ? i : -1).filter(i => i >= 0).slice(0, 2) : [];
    wasSold = mc.items.map(i => !!i.sold); const keepY = lk === listKey; listKey = lk;
    const empty = '<div class="vm-slot"><div class="vm-pic"><div class="vm-spot"><span>EMPTY</span></div></div><div class="vm-coil"></div></div>';
    const html = n ? mc.items.map(slot).join('') : empty.repeat(full ? cols * 3 : 6), rows = vm.querySelector('.vm-rows'), loop = n > (full ? cols * 5 : 9);
    rows.innerHTML = html + (loop ? html : ''); if (loop) rows.dataset.loop = '1'; else delete rows.dataset.loop; if (!keepY) y = 0;
    for (const i of fresh) drop(mc.items[i], i);
    if (fresh.length) { vendSound(); const bb = vm.querySelector('.vm-bigbid'); bb.classList.remove('press'); void bb.offsetWidth; bb.classList.add('press'); }
    if (restock) setTimeout(() => vm.classList.remove('restock'), 2600);
  };
  return drawFn;
}
// READY-MADE SPOT LISTS (2026-11-13): one tap fills the names (teams, characters).
export const SPOT_PRESETS = {"nfl":["Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers","Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs","Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins","Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants","New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers","Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders"],"mlb":["Arizona Diamondbacks","Athletics","Atlanta Braves","Baltimore Orioles","Boston Red Sox","Chicago Cubs","Chicago White Sox","Cincinnati Reds","Cleveland Guardians","Colorado Rockies","Detroit Tigers","Houston Astros","Kansas City Royals","Los Angeles Angels","Los Angeles Dodgers","Miami Marlins","Milwaukee Brewers","Minnesota Twins","New York Mets","New York Yankees","Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres","San Francisco Giants","Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays","Texas Rangers","Toronto Blue Jays","Washington Nationals"],"nba":["Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets","Chicago Bulls","Cleveland Cavaliers","Dallas Mavericks","Denver Nuggets","Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers","LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat","Milwaukee Bucks","Minnesota Timberwolves","New Orleans Pelicans","New York Knicks","Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers","Phoenix Suns","Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors","Utah Jazz","Washington Wizards"],"nhl":["Anaheim Ducks","Boston Bruins","Buffalo Sabres","Calgary Flames","Carolina Hurricanes","Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets","Dallas Stars","Detroit Red Wings","Edmonton Oilers","Florida Panthers","Los Angeles Kings","Minnesota Wild","Montreal Canadiens","Nashville Predators","New Jersey Devils","New York Islanders","New York Rangers","Ottawa Senators","Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks","Seattle Kraken","St. Louis Blues","Tampa Bay Lightning","Toronto Maple Leafs","Utah Mammoth","Vancouver Canucks","Vegas Golden Knights","Washington Capitals","Winnipeg Jets"],"marvel":["Spider-Man","Iron Man","Captain America","Thor","Hulk","Black Widow","Hawkeye","Wolverine","Deadpool","Venom","Daredevil","Punisher","Black Panther","Doctor Strange","Scarlet Witch","Captain Marvel","Ms. Marvel","Moon Knight","Ghost Rider","Silver Surfer","Fantastic Four","X-Men","Storm","Cyclops","Jean Grey","Magneto","Thanos","Doctor Doom","Loki","Miles Morales"],"dc":["Batman","Superman","Wonder Woman","The Flash","Green Lantern","Aquaman","Cyborg","Martian Manhunter","Green Arrow","Nightwing","Robin","Batgirl","Supergirl","Shazam","Harley Quinn","Joker","Catwoman","Poison Ivy","Swamp Thing","Constantine","Lex Luthor","Darkseid","Black Adam","Teen Titans","Justice League"],"image":["Spawn","Invincible","Saga","The Walking Dead","Witchblade","Savage Dragon","Radiant Black","Something Is Killing the Children","Monstress","Ice Cream Man"]};
// SPOTS for a break or a surprise set (no inventory): "75 spots at $5", or one name a line.
export function makeSpots({ count = 0, price = 0, names = '', prefix = 'SPOT' } = {}) {
  const list = String(names || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 120), n = list.length || Math.max(0, Math.min(120, Math.floor(Number(count) || 0)));
  return Array.from({ length: n }, (_, i) => ({ title: (list[i] || (String(prefix || 'SPOT').trim().toUpperCase() + ' ' + (i + 1))).slice(0, 90), price: Number(price) > 0 ? Math.round(Number(price) * 100) / 100 : 0, sold: false }));
}
