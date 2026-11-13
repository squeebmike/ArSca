// More than one show (store, 2026-11-13: "how to add to more than one show from the dashboard after I import the
// slip? I should be able to select more than 1 show"): the picker lists every upcoming show with a checkbox (the next
// one ticked) and adds the same books to each one picked, one show after another, reporting per show.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const i = app.indexOf('async function openWhatnotShowPicker('), fn = app.slice(i, app.indexOf('window.openWhatnotShowPicker = openWhatnotShowPicker;', i));
assert.ok(i > 0);
assert.ok(fn.includes('<input type="checkbox" value="\' + escHtml(sh.id) + \'"\' + (k === 0 ? \' checked\' : \'\')'), 'a checkbox per show, the next one ticked');
assert.ok(fn.includes("const showIds = [...m.querySelectorAll('#wn-show-pick input:checked')].map(x => x.value)"));
assert.ok(fn.includes("if(!showIds.length){ status.textContent = 'Pick at least one show.'; return; }"));
assert.ok(fn.includes('for(const showId of showIds){') && fn.includes("body:JSON.stringify({ itemIds:ids.slice(i, i + 25), showId })"), 'each show, 25 at a time');
assert.ok(!fn.includes('<select id="wn-show-pick"'), 'no single-show dropdown');
console.log('Add to more than one Whatnot show: passed');
