// FOC SHOW MODE (store, 2026-11-14: "share the FOC tab of the dashboard. Don't show my tabs and the settings up top.
// But be able to scroll on it and they see the books, prices and all that. Clicking the book cover would open it and
// show the synopsis or any info we have on it").
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync('scripts/foc-dashboard.js', 'utf8'), ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
const show = src.slice(src.indexOf('// FOC SHOW MODE'), src.lastIndexOf('})();'));
assert.ok(src.includes('onclick="openFocShow()">📺 SHOW MODE</button>'), 'the button on the FOC wall');
for (const fn of ['openFocShow', 'closeFocShow', 'openFocShowCover', 'closeFocShowCover', 'focShowShare']) assert.ok(src.includes('window.' + fn + '=' + fn), fn + ' is reachable from onclick');
// Over everything (the tabs and settings hidden), scrollable, only what customers see.
assert.ok(show.includes('#foc-show{position:fixed;inset:0;z-index:2147483000') && show.includes('overflow-y:auto'));
assert.ok(show.includes("v.customerEnabled!==false") && show.includes('visibleFamilies()'), 'only covers shown to customers, with the filters that are on');
for (const secret of ['storeQuantity', 'safetyStockQty', 'customerQty', 'waitlistRequests', 'Cost', 'ebay', 'securedQuantity']) assert.ok(!show.includes(secret), 'show mode never shows ' + secret);
// A cover opens its details: big cover, credits, dates, price, the synopsis, the other covers.
for (const k of ["['WRITER',", "['ARTIST',", "['COVER',v.coverArtist]", "['ON SALE',", "v.description||f.description", 'No synopsis from the publisher yet.', 'fs-others']) assert.ok(show.includes(k), k);
assert.ok(show.includes("document.addEventListener('keydown',focShowKey)") && show.includes("e.key!=='Escape'"), 'Esc closes');
// SHARE TO STREAM: this tab to the overlay through the Live Studio screen share.
assert.ok(show.includes("window.manaStudioShareScreen({title:'NEW COMICS -- FOC '") && show.includes("currentTab:true"));
assert.ok(ctl.includes('window.manaStudioShareScreen=(o={})=>shareScreen(') && ctl.includes("preferCurrentTab:true"));
console.log('FOC show mode: passed');
