import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report (screenshot of Judge Dredd/Biker Mice from Mars #1 Cover H):
// a presale listing showed an empty yellow bar -- no PRESALE notice, no date
// -- with the Gemini line stuck under it. The store's Comic template plus a
// long synopsis plus the yellow bar ran past eBay's 4000 characters, and the
// description was cut from the end: through the bar, after the shipping
// section. The synopsis is shortened now; the bar and shipping stay whole.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' must exist');
  let depth = 0, i = src.indexOf('{', src.indexOf(')', start));
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const barRe = worker.match(/const COMIC_PRESALE_BAR_RE = [^\n]+/)[0];
const ctx = {};
vm.runInNewContext([
  fn(app, 'escHtml'), fn(app, 'comicPresaleBannerText'), fn(app, 'comicPresaleBannerHtml'),
  "const COMIC_SHIPPING_NOTE = 'Bagged & boarded and shipped in a Gemini mailer.';",
  "const COMIC_IN_STOCK_SHIPPING = 'In stock and ships within 1 business day with tracking.';",
  barRe, ...['comicPresaleNotice', 'truncateHtmlSafely', 'stripCutPresaleBarTail', 'shortenHtmlToFit', 'withComicListingNotices', 'comicPresaleToInStockDescription'].map(n => fn(worker, n)),
  'this.api = { comicPresaleBannerHtml, withComicListingNotices, comicPresaleToInStockDescription };',
].join('\n'), ctx);
const { comicPresaleBannerHtml, withComicListingNotices, comicPresaleToInStockDescription } = ctx.api;

const label = 'November 25, 2026';
const synopsis = 'Vinnie, and Modo, the extraterrestrial antiheroes known as the BIKER MICE FROM MARS, would dare to foil their latest cross-dimensional conquest. '.repeat(12).trim();
const section = (h, t) => `<div style="background:#fff;padding:0 16px 12px;border-left:1px solid #ddd;border-right:1px solid #ddd;font-size:13px">\n<div style="background:#6535a5;color:#fff;padding:6px 8px;font-weight:900;margin-bottom:4px">${h}</div>${t}</div>\n`;
const template = '<div style="max-width:760px;margin:0 auto;font-family:Arial,Helvetica,sans-serif">\n'
  + section('COMIC DETAILS', '<div>Release date: ' + label + '</div>' + '<div>Writer: Someone</div>'.repeat(30))
  + section('SYNOPSIS', synopsis)
  + section('WHY THIS COMIC BELONGS IN THE COLLECTION', '<b>Judge Dredd/Biker Mice from Mars #1 Cover H David Finch B&amp;W 1:50 Var</b>')
  + '<div style="background:#171717;color:#fff;padding:14px 16px;font-size:12px">\n<div style="color:#c391ff;font-weight:900;margin-bottom:4px">FAST, SECURE SHIPPING</div>\nWe pack every comic to arrive protected. Bagged &amp; boarded and shipped in a Gemini mailer.\n\nFor presale comics, orders ship promptly once the title reaches its official release date.\n</div>\n'
  + '<div style="background:#8dff2a;color:#171717;padding:12px 16px;text-align:center">Another comic for the collection is another perfectly reasonable excuse for needing a bigger shelf.</div>\n</div>\n';
const fromDashboard = template + comicPresaleBannerHtml(label);
assert.ok(fromDashboard.length > 4000, 'the case from the report: over eBay\'s cap');

{
  const out = withComicListingNotices(fromDashboard, { presale: true, onSaleLabel: label });
  assert.ok(out.length <= 4000, 'fits eBay');
  assert.ok(out.endsWith(comicPresaleBannerHtml(label)), 'the yellow bar arrives whole, with the date, at the very bottom');
  assert.match(out, /Expected release\/ship date: November 25, 2026\./);
  assert.match(out, /FAST, SECURE SHIPPING<\/div>\nWe pack every comic to arrive protected\. Bagged &amp; boarded and shipped in a Gemini mailer\./, 'the shipping section stays whole');
  assert.equal((out.match(/Gemini/g) || []).length, 1, 'no extra Gemini line at the bottom');
  assert.match(out, /needing a bigger shelf\.<\/div>\n<\/div>\n?<div style="max-width:760px;margin:8px auto 0;background:#ffd166/, 'the tagline is kept, the bar right after it');
  assert.match(out, /SYNOPSIS<\/div>[^<]*…<\/div>/, 'the synopsis is what got shortened');
  assert.equal((out.match(/background:#ffd166/g) || []).length, 1);
}

// Listings already cut by the old code: the broken bar is replaced.
{
  const cutInText = template.slice(0, 3000) + '</div>' + '<div style="max-width:760px;margin:8px auto 0;background:#ffd166;color:#171717;border:2px solid #171717;padding:12px 16px">PRESALE -- This';
  const out = withComicListingNotices(cutInText, { presale: true, onSaleLabel: label });
  assert.ok(!out.includes('PRESALE -- This<') && !out.endsWith('PRESALE -- This'), 'the cut-off bar is gone');
  assert.match(out, /PRESALE -- This comic has not been released yet and is not currently in stock\. Expected on-sale\/ship date: November 25, 2026\.[^<]*<\/div>$/, 'and a whole one is at the bottom');
  const cutInTag = template.slice(0, 3000) + '</div><div style="max-width:760px;margin:8px au';
  const out2 = withComicListingNotices(cutInTag, { presale: true, onSaleLabel: label });
  assert.ok(!out2.includes('margin:8px au<') && !/margin:8px au(?!to)/.test(out2), 'a tag cut in half is gone too');
  assert.match(out2, /November 25, 2026\.[^<]*<\/div>$/);
}

// A bar from an earlier run anywhere in the description moves to the bottom,
// once; a bar without the date gets the date.
{
  const out = withComicListingNotices(comicPresaleBannerHtml('') + '<p>Short description. Bagged &amp; boarded and shipped in a Gemini mailer.</p>', { presale: true, onSaleLabel: label });
  assert.equal((out.match(/background:#ffd166/g) || []).length, 1);
  assert.ok(out.startsWith('<p>Short description.'));
  assert.match(out, /November 25, 2026/);
}

// Not a presale: nothing added; in-stock conversion drops a cut bar.
assert.equal(withComicListingNotices('<p>Hi. Gemini mailer.</p>', { presale: false }), '<p>Hi. Gemini mailer.</p>');
{
  const out = comicPresaleToInStockDescription('<p>Hi. Bagged &amp; boarded and shipped in a Gemini mailer.</p><div style="max-width:760px;margin:8px auto 0;background:#ffd166;color:#171717">PRESALE -- This');
  assert.ok(!/PRESALE|ffd166/.test(out), out);
}

// The routes no longer cut the client's description at 4000 before the
// notices are added (that cut is what took the bar off).
assert.doesNotMatch(worker, /body\.description\.trim\(\)\.substring\(0, 4000\)/);
assert.equal((worker.match(/body\.description\.trim\(\)\.substring\(0, 20000\)/g) || []).length, 2);
// A multi-cover listing's cover list is HTML for an HTML template, and goes
// above the bar (withComicListingNotices moves the bar to the end).
assert.match(worker, /const coversListPart = \/<\\\/\?\[a-z\]\[\\s\\S\]\*>\/i\.test\(descriptionBase\)/);
console.log('Presale bar survives the length cap checks passed');
