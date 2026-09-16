import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store gap: Promoted Listings was purely reactive -- a seller had to
// manually add every single new listing to their active Cost Per Sale
// campaign, so anything published between visits to that screen got zero
// promotion until someone noticed. This adds an opt-in (spends real ad
// budget, so never a silent default) auto-enroll step right after a
// listing publishes.

assert.match(worker, /async function autoEnrollListingInActivePromotedCampaign\(env, ebayToken, storeId, listingId\) \{/, 'missing autoEnrollListingInActivePromotedCampaign');
const fnStart = worker.indexOf('async function autoEnrollListingInActivePromotedCampaign(env, ebayToken, storeId, listingId) {');
const fnEnd = worker.indexOf('\n    }', fnStart) + 6;
const fn = worker.slice(fnStart, fnEnd);

assert.match(fn, /if \(!listingId\) return;/, 'must no-op with nothing to enroll rather than making pointless API calls');
assert.match(fn, /if \(!settingsRows\?\.\[0\]\?\.receipt_settings\?\.ebayAutoPromoteListings\?\.enabled\) return;/, 'must be opt-in per store -- this spends real ad budget, so it must never run for a store that never turned it on');
assert.match(fn, /campaignStatus === 'RUNNING' && c\.fundingStrategy\?\.fundingModel === 'COST_PER_SALE'/, 'must only ever consider a live, spend-capable campaign');
assert.match(fn, /if \(running\.length !== 1\) return;/, 'must stay conservative and do nothing when zero or multiple active campaigns exist -- auto-picking among several would be guessing which one the seller wants this listing in');
assert.match(fn, /bulk_create_ads_by_listing_id/, 'must actually enroll the listing via the same Marketing API endpoint the manual add-listings route uses');

console.log('eBay auto-promote worker logic checks passed');

// Wired into the shared listing-creation function (used by both /ebay/list
// and the FOC single-cover presale route) so both entry points benefit,
// and wrapped so a failure here can never surface as a listing-creation
// error -- the listing itself already succeeded by the time this runs.
const createStart = worker.indexOf('async function createAndPublishEbayListing(b, ebayToken, env, storeId) {');
const createEnd = worker.indexOf('\n    // Publishes several FOC covers of the SAME issue as ONE eBay listing', createStart);
const createBody = worker.slice(createStart, createEnd);
assert.match(createBody, /try \{ await autoEnrollListingInActivePromotedCampaign\(env, ebayToken, storeId, pubData\.listingId\); \} catch \(_\) \{\}/, 'createAndPublishEbayListing must call the auto-enroll step, wrapped so it can never fail the listing itself');

console.log('eBay auto-promote call-site wiring checks passed');

// Settings UI: a real, off-by-default toggle a store can actually reach,
// not just backend logic nothing exposes.
assert.match(dashboard, /function ebayAutoPromoteListingsSettingsHtml\(p\)\{/, 'missing ebayAutoPromoteListingsSettingsHtml');
assert.match(dashboard, /const cfg = \{ enabled:false, \.\.\.\(p\.ebayAutoPromoteListings \|\| \{\}\) \};/, 'must default to disabled, matching the worker-side opt-in check');
assert.match(dashboard, /function saveEbayAutoPromoteListingsSettings\(\)\{/, 'missing saveEbayAutoPromoteListingsSettings');
assert.match(dashboard, /saveVendorProfile\(\{ ebayAutoPromoteListings \}\);/, 'must actually persist the setting');
assert.match(dashboard, /onclick="saveEbayAutoPromoteListingsSettings\(\)">SAVE AUTO-PROMOTE SETTINGS<\/button>/, 'the settings panel must have a real save button wired to the save function');

// receipt_settings is a full-replace column written from two places
// (saveVendorProfile + savePaymentSettings) -- same bug class already
// fixed for ebayAutoReprice: the new field must be in BOTH explicit
// whitelists or one write path silently erases the other's value.
const inWhitelist = (dashboard.match(/ebayAutoPromoteListings:next\.ebayAutoPromoteListings \|\| \{\},/g) || []).length;
assert.equal(inWhitelist, 2, 'ebayAutoPromoteListings must be carried in both receipt_settings whitelists (saveVendorProfile and savePaymentSettings), or one will erase the other\'s write');

console.log('eBay auto-promote settings UI checks passed');
