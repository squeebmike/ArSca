import assert from 'node:assert/strict';

// The www routes are prefix wildcards, so Webflow pages that share a prefix
// (/preorders under /preorder*, /books under /book*, /mtg-new-releases under
// /mtg*) reach the Worker. Anything it doesn't serve must go on to Webflow.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const origin = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async input => {
  const url = String(input.url || input);
  if (url === 'https://www.themanapocket.com/privacy-policy') return new Response('<html><body>no nav</body></html>', { headers: { 'Content-Type': 'text/html' } }); // the real-nav source (site-chrome test)
  if (url.startsWith('https://www.themanapocket.com/')) { origin.push(url); return new Response('<html>webflow page</html>', { headers: { 'Content-Type': 'text/html' } }); }
  return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
};
const edge = { waitUntil: () => {} };
try {
  for (const path of ['/preorders', '/books', '/mtg-new-releases', '/mtg-ai-deck-builder']) {
    const res = await api.fetch(new Request('https://www.themanapocket.com' + path), {}, edge);
    assert.equal(res.status, 200, `${path} reaches Webflow`);
    assert.equal(await res.text(), '<html>webflow page</html>');
    assert.equal(origin.pop(), 'https://www.themanapocket.com' + path);
  }
  const post = await api.fetch(new Request('https://www.themanapocket.com/preorders', { method: 'POST' }), {}, edge);
  assert.equal(post.status, 404, 'only page loads fall through');
  const other = await api.fetch(new Request('https://still-resonance-4f87.swarnerauto.workers.dev/preorders'), {}, edge);
  assert.equal(other.status, 404, 'the workers.dev host still answers its own 404');
  assert.equal(origin.length, 0);
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('www Webflow passthrough checks passed');
