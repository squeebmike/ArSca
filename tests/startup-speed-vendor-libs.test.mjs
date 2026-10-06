import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Speed: the big add-on libraries no longer block startup. They load in the
// background after the page is up (vendorReady); the phone SDK only when the
// phone is turned on; anything that needs one early waits for it.
const d = fs.readFileSync('dashboard.html', 'utf8');
for (const lib of ['xlsx.full.min.js', 'jszip.min.js', 'html2canvas.min.js', 'JsBarcode.all.min.js', 'twilio.min.js']) {
  assert.ok(!new RegExp('<script src="[^"]*' + lib.replace(/\./g, '\\.') + '"').test(d), lib + ' must not be a startup script tag');
}
assert.match(d, /\['JsBarcode','XLSX','JSZip','html2canvas'\]\.forEach/, 'prefetched after load (not Twilio)');
assert.match(d, /<link rel="preconnect" href="https:\/\/vroknjrxubsqyexngwus\.supabase\.co" crossorigin>/);
// Every use waits for its library first.
assert.match(d, /if\(typeof XLSX === 'undefined'\) await window\.vendorReady\('XLSX'\)/);
assert.match(d, /if\(!window\.html2canvas\) await window\.vendorReady\('html2canvas'\)/);
assert.equal((d.match(/if\(typeof JsBarcode === 'undefined'\) await window\.vendorReady\('JsBarcode'\)/g) || []).length, 2);
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.equal((foc.match(/await window\.vendorReady\('XLSX'\)/g) || []).length, 2);
assert.match(foc, /await window\.vendorReady\('JSZip'\)/);
assert.match(fs.readFileSync('scripts/backlist-dashboard.js', 'utf8'), /await window\.vendorReady\('XLSX'\)/);

// The loader: one download per library, resolved once it's there, retried after a failure.
const src = d.match(/\(function\(\)\{\n  var LIBS = \{[\s\S]*?\n\}\)\(\);/)[0];
const appended = [];
const win = { addEventListener:() => {} };
const ctx = { window:win, Promise, Error, document:{ createElement:() => ({ remove(){} }), head:{ appendChild:t => { appended.push(t); } } } };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const a = win.vendorReady('XLSX'), b = win.vendorReady('XLSX');
assert.equal(appended.length, 1, 'one download even when asked twice');
win.XLSX = {}; appended[0].onload();
assert.equal(await a, win.XLSX); assert.equal(await b, win.XLSX);
const f = win.vendorReady('JSZip'); appended[1].onerror();
await assert.rejects(f, /failed to load/);
win.vendorReady('JSZip'); assert.equal(appended.length, 3, 'a failed library is retried next time');
await assert.rejects(win.vendorReady('Nope'), /Unknown library/);
console.log('Startup speed (background libraries) checks passed');
