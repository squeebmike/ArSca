import fs from 'node:fs';
import assert from 'node:assert/strict';

// Live bug: sharing a comic preorder always landed on Webflow's own 404 page
// ("Not Found" -- the exact title of the site's built-in 404 page) instead of
// the new server-rendered /preorder/{skuId} share page. The route handler
// itself was correct and deployed fine -- the actual cause was that this
// Worker is only bound, at the Cloudflare zone level, to intercept requests
// matching the routes listed in wrangler.deploy.jsonc. Only "/mtg*" was
// listed, so themanapocket.com/preorder/{id} never reached the Worker at
// all; it fell straight through to whatever else serves the domain
// (Webflow), which has no page at that path.

const config = JSON.parse(
  fs.readFileSync('wrangler.deploy.jsonc', 'utf8')
    // wrangler.deploy.jsonc has no comments today, but stay JSONC-safe
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
);

assert.ok(Array.isArray(config.routes) && config.routes.length, 'wrangler.deploy.jsonc must declare routes');

const preorderRoute = config.routes.find(r => /preorder/.test(r.pattern || ''));
assert.ok(preorderRoute, 'a route pattern covering /preorder* must be bound, or GET /preorder/{skuId} never reaches this Worker on themanapocket.com');
assert.equal(preorderRoute.zone_name, 'themanapocket.com', 'the /preorder* route must be bound to the real production zone, not just workers.dev');
assert.match(preorderRoute.pattern, /^themanapocket\.com\/preorder\*$/, 'the pattern must actually cover every /preorder/{id} path, mirroring the existing /mtg* binding');

const mtgRoute = config.routes.find(r => /mtg/.test(r.pattern || ''));
assert.ok(mtgRoute, 'the pre-existing /mtg* route binding must not have been removed');

console.log('wrangler.deploy.jsonc /preorder* route binding contract check passed');
