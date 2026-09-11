import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Store report: five straight rounds of "still broken" turned out to be
// the same real fix shipping every time, just never reaching the phone --
// the <script src="scripts/research-loupe.js?v=..."> tag's version string
// was hand-typed once and never bumped again on any later edit, so the
// browser kept serving its very first cached copy of the file forever.
//
// Rather than trust a human (or a future edit) to remember to bump a
// hand-typed date string, the query string IS the file's own content
// hash -- so it's *impossible* to edit research-loupe.js without this
// test failing until dashboard.html's script tag is updated to match,
// which is exactly the update that makes the browser actually fetch the
// new file. Whoever's running this test next time either updates the
// hash (and ships a real cache-bust) or the test tells them why not to skip it.

const scriptSrc = fs.readFileSync('scripts/research-loupe.js', 'utf8');
const expectedHash = crypto.createHash('sha1').update(scriptSrc).digest('hex').slice(0, 10);

const dashboardSrc = fs.readFileSync('dashboard.html', 'utf8');
const tagMatch = dashboardSrc.match(/<script src="scripts\/research-loupe\.js\?v=([^"]+)" defer><\/script>/);
assert.ok(tagMatch, 'expected to find the research-loupe.js script tag in dashboard.html');

assert.equal(
  tagMatch[1],
  expectedHash,
  `dashboard.html's research-loupe.js cache-buster (?v=${tagMatch[1]}) does not match the file's current content hash (${expectedHash}) -- ` +
  `scripts/research-loupe.js changed since the script tag was last updated, so browsers with an old cached copy will NOT see this change. ` +
  `Update the ?v= in dashboard.html to ${expectedHash} before shipping.`
);

console.log('Research Loupe cache-bust checks passed');
