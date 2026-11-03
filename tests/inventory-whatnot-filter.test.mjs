import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store, 2026-11-03: "how to select the comics in the dashboard that aren't
// on Whatnot?" -> LISTING: On Whatnot / Not on Whatnot.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const start = app.indexOf('function inventoryMatchesListing(');
const src = app.slice(start, app.indexOf('\n}\n', start) + 2);
const match = new Function('inventoryIsListed', src + '\nreturn inventoryMatchesListing;')(i => !!i.ebayListingId);
const synced = { status: 'in_stock', sellOnWhatnot: true };
const csvOnly = { status: 'in_stock', whatnotListedAt: '2026-10-01' };
const notOn = { status: 'in_stock' };
const sold = { status: 'sold' };
assert.equal(match(synced, 'on_whatnot'), true);
assert.equal(match(notOn, 'on_whatnot'), false);
assert.equal(match(notOn, 'not_on_whatnot'), true);
assert.equal(match(synced, 'not_on_whatnot'), false);
assert.equal(match(csvOnly, 'not_on_whatnot'), false, 'old CSV listings are linked, never listed twice');
assert.equal(match(sold, 'not_on_whatnot'), false, 'in stock only');
assert.equal(match({ status: 'in_stock', ebayListingId: '1' }, 'listed_online'), true, 'existing filters unchanged');
const html = fs.readFileSync('dashboard.html', 'utf8');
assert.match(html, /onclick="setF\('listing','on_whatnot',this\)"[^>]*>On Whatnot<\/button>/);
assert.match(html, /onclick="setF\('listing','not_on_whatnot',this\)"[^>]*>Not on Whatnot<\/button>/);
console.log('Inventory LISTING: On Whatnot / Not on Whatnot filters passed');
