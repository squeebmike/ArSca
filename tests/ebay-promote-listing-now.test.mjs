import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store request: close the loop between "eBay recommends Promoted
// Listings" (already existed, purely informational) and actually acting
// on it -- promoteListingNow adds the recommended item to a running
// campaign, or creates one at eBay's suggested bid if none exists yet.
// This is a real, ongoing eBay ad-spend commitment, so it must follow the
// same explicit real-money confirmation convention the rest of the app
// already uses (see submitCreateCampaign/endEbayCampaign), not a silent
// one-tap action.

const src = fs.readFileSync('dashboard.html', 'utf8');

assert.match(src, /async function promoteListingNow\(listingId, itemName, suggestedBid, btn\)\{/, 'promoteListingNow must exist with this signature');

// The PROMOTE button must actually be rendered next to the recommendation
// text, not just exist as a dead function.
const recoFnMatch = src.match(/async function loadEbayListingRecommendations\([\s\S]*?\n\}/);
assert.ok(recoFnMatch, 'expected to find loadEbayListingRecommendations');
assert.match(recoFnMatch[0], /onclick="promoteListingNow\(/, 'the recommendation render must include a PROMOTE button wired to promoteListingNow');

const promoteFnMatch = src.match(/async function promoteListingNow\([\s\S]*?\n\}\n/);
assert.ok(promoteFnMatch, 'expected to find the full promoteListingNow body');
const body = promoteFnMatch[0];

// Real-money confirmation: must never silently spend ad budget.
assert.match(body, /confirm\(`Add "\$\{itemName\}" to the/, 'adding to an existing running campaign must be confirmed, naming the item and the campaign');
assert.match(body, /spends real eBay ad budget/, 'adding to an existing campaign must say plainly that it spends real ad budget');
assert.match(body, /confirm\(`No Promoted Listings campaign exists yet\. Create one/, 'creating a new campaign must be confirmed, not silently spun up');
assert.match(body, /charges \$\{bidNum\}% of the sale price/, 'the create-path confirmation must state the real percentage that will be charged');

// Must reuse the existing campaign endpoints rather than inventing new
// ones -- no new backend route needed for this.
assert.match(body, /storeWorkerFetch\('\/ebay\/marketing\/campaigns'/, 'must look up existing campaigns before deciding to create a new one');
assert.match(body, /storeWorkerFetch\('\/ebay\/marketing\/campaign\/create'/, 'must reuse the existing campaign/create route');
assert.match(body, /storeWorkerFetch\('\/ebay\/marketing\/campaign\/add-listings'/, 'must reuse the existing campaign/add-listings route');

// Only a RUNNING campaign should be reused -- adding to a paused/ended one
// would silently do nothing on eBay's side.
assert.match(body, /c\.status === 'RUNNING'/, 'must only reuse a campaign that is actually RUNNING');

console.log('eBay promote-listing-now checks passed');
