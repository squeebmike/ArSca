// Disposable diagnostic worker -- proves or disproves the Orange-to-Orange
// theory for why themanapocket.com's Workers Routes (bound to specific
// paths like /mtg*, /book*, /preorder*) never actually invoke the real
// Worker in production, despite being correctly configured (see the
// storefront-routing-check.yml investigation). Cloudflare's own docs and a
// known workers-sdk issue say a target-hostname-scoped route can fail to
// fire when that hostname is orange-cloud proxied in front of another
// Cloudflare-fronted origin (Webflow, here) -- only a zone-wide */* route
// reliably intercepts. This worker is bound to */* ONLY for the duration
// of this one diagnostic run (see .github/workflows/o2o-diagnostic.yml,
// which tears the route and this worker down again immediately after).
//
// Every path except the one unique test path below passes straight through
// to the real origin unchanged, so real site visitors never see this
// worker at all while the route is briefly live.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/mp-o2o-diagnostic-test-92841') {
      return new Response('MANA POCKET O2O WORKER TEST', {
        headers: {
          'content-type': 'text/plain',
          'x-mana-worker-test': 'YES',
          'cache-control': 'no-store',
        },
      });
    }
    return fetch(request);
  },
};
