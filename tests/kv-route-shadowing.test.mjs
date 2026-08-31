import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ROOT CAUSE of "cart/buy tray/cash bag/shows don't sync across devices" --
// a real bug that survived several earlier client-side-only fixes. The
// generic `if (url.pathname.startsWith('/kv/')) {...}` handler used to sit
// BEFORE the four specific /kv/... index routes in the same if-chain. Every
// one of those four routes shares the '/kv/' prefix, so the generic handler
// matched and returned first on every request to them -- with a real 200
// {ok:true}, but writing the body into a mangled fallback key instead of
// the shared *_index key the client's join/switcher UI actually polls.
// Carts/trays/shows all pushed their own data fine; devices just could
// never discover each other's, because nothing ever wrote the index they
// searched. This test asserts the specific routes are matched before the
// generic startsWith('/kv/') fallback, the only thing that actually
// determines which one wins in a real if-chain (existing tests only assert
// the route source text exists, which passes even on unreachable code).

const genericIdx = worker.indexOf("if (url.pathname.startsWith('/kv/')) {");
assert.ok(genericIdx !== -1, 'missing the generic /kv/ fallback route');

const specificRoutes = [
  ["url.pathname === '/kv/sale-cart-index/upsert'", 'sale-cart-index'],
  ["url.pathname === '/kv/buy-trays-index/upsert'", 'buy-trays-index'],
  ["url.pathname === '/kv/show-sessions-index/upsert'", 'show-sessions-index'],
  ["url.pathname === '/kv/inventory-lifecycle/merge'", 'inventory-lifecycle'],
];

for (const [needle, label] of specificRoutes) {
  const idx = worker.indexOf(needle);
  assert.ok(idx !== -1, `missing the ${label} route`);
  assert.ok(idx < genericIdx,
    `the ${label} route must be checked BEFORE the generic startsWith('/kv/') fallback, or the fallback shadows it and it never runs -- this is exactly the bug that broke cross-device sync`);
}

// And there must be exactly one generic fallback -- if a second copy ever
// gets reintroduced above the specific routes (e.g. by a bad merge), the
// index-based check above wouldn't catch it.
const genericCount = worker.match(/if \(url\.pathname\.startsWith\('\/kv\/'\)\) \{/g)?.length || 0;
assert.equal(genericCount, 1, 'there must be exactly one generic /kv/ fallback route -- a second one above the specific routes would silently reintroduce the shadowing bug');

console.log('KV route shadowing regression check passed');
