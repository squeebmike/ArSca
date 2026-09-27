import assert from 'node:assert/strict';
import { extractSiteChrome, balancedDiv, SITE_CHROME_SOURCE } from '../scripts/site-chrome.mjs';

// A published Webflow page, shaped like /privacy-policy.
const webflowPage = `<!DOCTYPE html><!-- This site was created in Webflow. --><html data-wf-domain="www.themanapocket.com" data-wf-page="6a8398b40776ff0dd81c82d1" data-wf-site="65b15ee0228d06647ca7e4ce" lang="en"><head><meta charset="utf-8"/><title>Privacy Policy | The Mana Pocket</title><meta content="How we protect you" name="description"/><meta content="width=device-width, initial-scale=1" name="viewport"/><link href="https://www.themanapocket.com/privacy-policy" rel="canonical"/><link href="https://cdn.prod.website-files.com/65b15ee0228d06647ca7e4ce/css/the-mana-pocket.webflow.shared.css" rel="stylesheet" type="text/css"/><script type="text/javascript">!function(o,c){var n=c.documentElement,t=" w-mod-";n.className+=t+"js"}(window,document);</script><script type="application/ld+json">{"@type":"WebPage"}</script><link href="https://cdn.prod.website-files.com/x/favicon.png" rel="shortcut icon" type="image/x-icon"/><style>.site-head{color:red}</style></head>
<body><div data-animation="default" data-collapse="medium" role="banner" class="navbar6_component w-nav" id="navbarID" fs-scrolldisable-element="smart-nav"><div class="navbar6_container"><a href="/" class="navbar6_logo-link w-nav-brand"><img src="logo.png" class="navbar6_logo"/></a><nav role="navigation" class="navbar6_menu w-nav-menu"><div class="navbar6_menu-left"><a href="/shop" class="navbar6_link w-nav-link">Shop</a><div data-hover="false" class="navbar6_menu-dropdown w-dropdown"><div class="navbar6_dropdown-toggle w-dropdown-toggle"><div>Cool Stuff</div></div><nav class="navbar6_dropdown-list w-dropdown-list"><a href="/preorders" class="navbar6_dropdown-link w-dropdown-link">Comic Preorders</a></nav></div></div></nav><div class="navbar6_menu-right"></div><a href="#" class="wo-team-btn w-inline-block" data-wo-theme="true"><div>My Pocket</div></a><div class="navbar6_menu-button w-nav-button"><div class="menu-icon"></div></div></div></div><section class="tmp-legal-section"><div class="tmp-legal-wrap"><h1>Privacy Policy</h1><div class="footer-section-note">not the footer</div></div></section><div class="footer-section"><div class="footer"><a href="https://www.instagram.com/shopthemanapocket">IG</a></div></div><script src="https://d3e54v103j8qbb.cloudfront.net/js/jquery-3.5.1.min.dc5e7f18c8.js?site=65b15ee0228d06647ca7e4ce" type="text/javascript"></script><script src="https://cdn.prod.website-files.com/65b15ee0228d06647ca7e4ce/js/webflow.js" type="text/javascript"></script><style>#navbarID{position:fixed}</style><script defer src="https://cdn.jsdelivr.net/gh/squeebmike/wo-scripts@a4277ed/wo-ui.js"></script></body></html>`;

const chrome = extractSiteChrome(webflowPage);
assert.ok(chrome, 'navbar found');
assert.equal(chrome.htmlAttrs, ' data-wf-domain="www.themanapocket.com" data-wf-page="6a8398b40776ff0dd81c82d1" data-wf-site="65b15ee0228d06647ca7e4ce"');
assert.match(chrome.nav, /^<div data-animation="default"[^>]*id="navbarID"/, 'starts at the navbar root');
assert.match(chrome.nav, /Comic Preorders<\/a><\/nav><\/div><\/div><\/nav>.*<\/div><\/div><\/div>$/, 'ends where the navbar closes');
assert.doesNotMatch(chrome.nav, /tmp-legal/, 'no page content');
assert.equal(chrome.footer, '<div class="footer-section"><div class="footer"><a href="https://www.instagram.com/shopthemanapocket">IG</a></div></div>', 'the footer, not a lookalike class');
assert.match(chrome.bodyEnd, /jquery-3\.5\.1[\s\S]*webflow\.js[\s\S]*#navbarID\{position:fixed\}[\s\S]*wo-ui\.js/);
assert.match(chrome.head, /webflow\.shared\.css/);
assert.match(chrome.head, /w-mod-/);
assert.match(chrome.head, /shortcut icon/);
assert.doesNotMatch(chrome.head, /<title|<meta|rel="canonical"|ld\+json/, 'the Worker page keeps its own title, meta, canonical and JSON-LD');
assert.equal(extractSiteChrome('<html><body><p>no nav</p></body></html>'), null);
assert.equal(balancedDiv('<div><div></div>', 0), null, 'an unclosed navbar is rejected');
assert.equal(SITE_CHROME_SOURCE, 'https://www.themanapocket.com/privacy-policy');
console.log('Site chrome extraction checks passed');

// --- Worker pages use it --------------------------------------------------------
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const store = new Map();
globalThis.caches = { default: { match: async k => store.get(k.url)?.clone() || null, put: async (k, r) => { store.set(k.url, r); } } };
let sourceUp = false, sourceHits = 0;
globalThis.fetch = async input => {
  const url = String(input.url || input);
  if (url === SITE_CHROME_SOURCE) { sourceHits++; return sourceUp ? new Response(webflowPage, { headers: { 'Content-Type': 'text/html' } }) : new Response('down', { status: 503 }); }
  return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
};
const waits = [];
const edge = { waitUntil: p => waits.push(p) };
try {
  // Webflow unreachable: the hand-built header, and the page still renders.
  let res = await api.fetch(new Request('https://www.themanapocket.com/faq'), {}, edge);
  let html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /id="mp-nav-toggle"/, 'fallback header when the real nav is unavailable');
  assert.match(html, /#navbarID\.navbar6_component\{position:fixed/);

  // Retries after a minute, then the real nav.
  sourceUp = true;
  const realNow = Date.now;
  Date.now = () => realNow() + 61 * 1000;
  try {
    res = await api.fetch(new Request('https://www.themanapocket.com/faq'), {}, edge);
    html = await res.text();
  } finally { Date.now = realNow; }
  await Promise.all(waits);
  assert.match(html, /<html lang="en" data-wf-domain="www\.themanapocket\.com" data-wf-page="6a8398b40776ff0dd81c82d1"/);
  assert.match(html, /id="navbarID" fs-scrolldisable-element="smart-nav"/, 'the real Webflow navbar');
  assert.doesNotMatch(html, /mp-nav-toggle|#navbarID\.navbar6_component\{position:fixed;top:0/, 'no hand-built nav or its CSS');
  assert.match(html, /<div class="footer-section">/, 'the real footer');
  assert.match(html, /webflow\.js[\s\S]*wo-scripts@a4277ed\/wo-ui\.js[\s\S]*<\/body><\/html>$/, 'Webflow runtime and site footer code');
  assert.doesNotMatch(html, /wo-scripts@08bbbfc/, 'no second, older copy of wo-ui.js');
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /<title>Frequently Asked Questions \| The Mana Pocket<\/title>/, 'the page keeps its own title');
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(html.indexOf('webflow.shared.css') < html.indexOf('<style>*{box-sizing'), 'page styles load after Webflow CSS so they win');

  // Cached: the next page doesn't go back to Webflow.
  const hits = sourceHits;
  await api.fetch(new Request('https://www.themanapocket.com/faq'), {}, edge);
  assert.equal(sourceHits, hits);
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('Worker pages use the real Webflow nav checks passed');
