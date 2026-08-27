import fs from 'node:fs';
import assert from 'node:assert/strict';

const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report: importing a fresh FOC cycle (243 SKUs / 125 title families
// per the import report) showed only 2 title families on the wall, with
// every filter dropdown visually reading "All". Root cause: openCycle
// never reset state.query/publisher/flag/ebay, so a filter set while
// browsing an EARLIER cycle silently kept narrowing the newly-opened one --
// and the flag/eBay <select> markup never re-marked the matching option as
// selected on re-render, so a stale non-"all" filter LOOKED like "All" was
// selected while still actively excluding almost everything.
const openCycleStart = focDash.indexOf('async function openCycle(id){');
const openCycleEnd = focDash.indexOf('\n}', openCycleStart) + 2;
const openCycleBody = focDash.slice(openCycleStart, openCycleEnd);
assert.match(openCycleBody, /state\.query='';state\.publisher='all';state\.flag='all';state\.ebay='all';/,
  'openCycle must reset every family-list filter before loading a (possibly different) cycle');
// The reset must happen before the families actually load, not after --
// otherwise a slow request could still race a filter click into applying
// to families that hadn't loaded yet.
assert(openCycleBody.indexOf("state.ebay='all';") < openCycleBody.indexOf('await api('),
  'the filter reset must happen before the cycle data is fetched, not after');

// Defense in depth: even if some other future code path left a stale
// filter set, the dropdowns themselves must now honestly reflect state on
// every render, instead of only the search box and (when the value existed
// in the new cycle's publisher list) the publisher select doing so.
const renderCycleStart = focDash.indexOf('function renderCycle(){');
const renderCycleEnd = focDash.indexOf('\n}', renderCycleStart) + 2;
const renderCycleBody = focDash.slice(renderCycleStart, renderCycleEnd);
assert.match(renderCycleBody, /<option value="all" '\+\(state\.publisher==='all'\?'selected':''\)\+'>All publishers<\/option>/,
  'the "All publishers" option must be explicitly marked selected when state.publisher is "all", not rely on browser default-first-option behavior');
assert.match(renderCycleBody, /<option value="all" '\+\(state\.flag==='all'\?'selected':''\)\+'>All comics<\/option>/,
  'the comic-flag select must reflect state.flag on every option, not just default to "All comics" visually regardless of the real filter');
assert.match(renderCycleBody, /<option value="ELIGIBLE_NOW" '\+\(state\.ebay==='ELIGIBLE_NOW'\?'selected':''\)\+'>Eligible, not listed<\/option>/,
  'the eBay-status select must reflect state.ebay on every option');

console.log('FOC cycle filter-reset contract checks passed');
