// NO CANCELLATIONS ON PRESALES (store, 2026-11-17: buyers cancel presales on FOC day after the copy is ordered for them,
// and eBay sided with one. "We need to put the line no cancellations in the listing from now on.")
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const fn = (src, name) => { const start = src.indexOf('function ' + name + '('); let depth = 0, i = src.indexOf('{', src.indexOf(')', start)); for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && !--depth) break; } return src.slice(start, i + 1); };
const ctx = {};
vm.runInNewContext([
  "const COMIC_SHIPPING_NOTE = 'Bagged & boarded and shipped in a Gemini mailer.';",
  worker.match(/const COMIC_PRESALE_BAR_RE = [^\n]+/)[0], worker.match(/const COMIC_PRESALE_NO_CANCEL = [^\n]+/)[0],
  ...['comicPresaleNotice', 'truncateHtmlSafely', 'stripCutPresaleBarTail', 'shortenHtmlToFit', 'withComicListingNotices'].map(n => fn(worker, n)),
  'this.api = { withComicListingNotices, comicPresaleNotice };',
].join('\n'), ctx);
const { withComicListingNotices, comicPresaleNotice } = ctx.api;
const LINE = 'no cancellations after purchase';
assert.ok(comicPresaleNotice('December 23, 2026').includes(LINE), 'the presale notice says it');
// Every kind of presale description gets it once: a plain one, an HTML template, one with an older bar, one with a PRESALE line already.
for (const d of [
  'Amazing Spider-Man #1006 Mark Spears Virgin 1:100.',
  '<div>SHIPPING</div><p>Template</p>',
  '<p>Book</p><div style="max-width:760px;margin:8px auto 0;background:#ffd166;color:#171717">PRESALE -- This comic has not been released yet and is not currently in stock. Expected on-sale/ship date: December 23, 2026.</div>',
  'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nSynopsis...',
]) {
  const out = withComicListingNotices(d, { presale: true, onSaleLabel: 'December 23, 2026' });
  assert.equal((out.match(new RegExp(LINE, 'g')) || []).length, 1, 'once: ' + d.slice(0, 30));
  assert.ok(out.length <= 4000);
}
assert.ok(!withComicListingNotices('In stock book.', { presale: false }).includes(LINE), 'not on in-stock listings');
assert.ok(app.includes('Presale copies are ordered from the distributor for you at FOC -- no cancellations after purchase.'), 'the dashboard\'s own bar says it too');
console.log('Presale no-cancellations line: passed');
