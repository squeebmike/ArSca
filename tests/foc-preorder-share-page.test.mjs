import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');

// Store report: sharing a comic preorder to Facebook always showed the
// generic /shop or /preorders page preview -- title "Shop Sports Cards, TCG
// & Comics", no item image -- because those pages are 100% client-rendered.
// Facebook's link-preview scraper never executes JS, so it only ever sees
// whatever static <meta> tags are already in the initial HTTP response, and
// there was only one, sitewide, non-item-specific set of those. This adds a
// real server-rendered GET /preorder/{skuId} route with THIS cover's own
// og:title/og:description/og:image baked into the response.

assert.match(worker, /url\.pathname\.startsWith\('\/preorder\/'\)/,
  'the Worker\'s router must dispatch /preorder/{id} requests to the FOC handler');

assert.match(foc, /if\(path\.startsWith\('\/preorder\/'\)&&request\.method==='GET'\)\{/,
  'handleFocRequest must own the /preorder/{id} route');
assert.match(foc, /async function preorderDetailPage\(env, deps, skuId\) \{/,
  'missing preorderDetailPage');
assert.match(foc, /function notFoundPreorderPage\(\) \{/,
  'missing notFoundPreorderPage for an unknown/disabled sku');

{
  const fnStart = foc.indexOf('async function preorderDetailPage(env, deps, skuId) {');
  const fnEnd = foc.indexOf('\n}', fnStart) + 2;
  const fn = foc.slice(fnStart, fnEnd);
  assert.match(fn, /comic_skus\?id=eq\.\$\{encodeURIComponent\(skuId\)\}&customer_enabled=eq\.true&select=\*&limit=1/,
    'must look up the real sku row, and only a customer-enabled one');
  assert.match(fn, /comic_title_families\?id=eq\.\$\{encodeURIComponent\(skuRow\.family_id\)\}&select=\*&limit=1/,
    'must look up the sku\'s title family for series name/publisher/synopsis');
  assert.match(fn, /foc_cycles\?id=eq\.\$\{encodeURIComponent\(skuRow\.cycle_id\)\}&select=\$\{catalogCycleSelect\(\)\}&limit=1/,
    'must look up the FOC cycle for the real preorder deadline');
  assert.match(fn, /if \(!skuRow\) return notFoundPreorderPage\(\);/, 'a missing/disabled sku must 404, not crash or leak an empty page');
  assert.match(fn, /if \(!familyRow \|\| !cycleRow\) return notFoundPreorderPage\(\);/, 'a dangling family/cycle reference must also 404');
  assert.match(fn, /<meta property="og:title" content="\$\{escapeHtml\(title\)\}">/, 'must send a real per-cover og:title');
  assert.match(fn, /<meta property="og:description" content="\$\{escapeHtml\(description\)\}">/, 'must send a real per-cover og:description');
  assert.match(fn, /image \? `<meta property="og:image" content="\$\{escapeHtml\(image\)\}">/, 'must send the cover art as og:image when one exists');
  assert.match(fn, /location\.replace\(\$\{JSON\.stringify\(appUrl\)\}\)/, 'a real visitor (with JS) must be bounced into the interactive /preorders?sku= view, not stranded on the static share page');
  assert.match(fn, /appUrl = `https:\/\/themanapocket\.com\/preorders\?sku=\$\{encodeURIComponent\(skuId\)\}`/, 'the Worker-hosted preview must redirect visitors back to the branded preorder app and exact sku');
  assert.match(fn, /shareUrl = `https:\/\/still-resonance-4f87\.swarnerauto\.workers\.dev\/preorder\/\$\{encodeURIComponent\(skuId\)\}`/, 'the canonical share URL must use the host that reaches the Worker instead of Webflow\'s 404');
}

console.log('preorderDetailPage contract checks passed');
