import assert from 'node:assert/strict';
import fs from 'node:fs';

const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store risk: the recurring "photo-to-cover binding" bug class on
// multi-cover eBay group listings (see foc-ebay-group-image-position-
// binding, foc-ebay-variation-listing-image-fallback/main-photo,
// foc-ebay-group-listing-photo-repair) was only ever fixed by a manual
// REPAIR LISTING PHOTOS button -- nothing ever told staff WHICH live group
// listings actually still needed it, so a listing published before the fix
// stayed broken until someone thought to click the button on it. This
// closes that loop: a successful repair now leaves a timestamp on every
// row in that group, and the Cover Wall's eBay Listing Health panel flags
// any live group listing that has never been through it.

assert.match(worker, /ebayGroupPhotosRepairedAt: repairedAt/, '/foc/ebay/repair-group-listing-photos must record a timestamp on every row in a successfully-repaired group');

assert.match(preorders, /groupKey:prior\.groupKey \|\| d\.ebayInventoryItemGroupKey \|\| '',/, 'ebayPresaleFields\' presale aggregation must carry the group key through from the row data');
assert.match(preorders, /groupPhotosRepairedAt:prior\.groupPhotosRepairedAt \|\| d\.ebayGroupPhotosRepairedAt \|\| '',/, 'must carry the repaired-at timestamp through from the row data');
assert.match(preorders, /ebayInventoryItemGroupKey:groupKey, ebayGroupPhotosRepairedAt:groupPhotosRepairedAt/, 'a LISTED/SOLD_OUT SKU must expose its group key and repaired-at timestamp to the dashboard');

const issuesStart = focDash.indexOf('function focEbayHealthIssues(){');
const issuesEnd = focDash.indexOf('\n}', issuesStart) + 2;
const issuesFn = focDash.slice(issuesStart, issuesEnd);
assert.match(issuesFn, /v\.ebayPresaleStatus==='LISTED'\|\|v\.ebayPresaleStatus==='SOLD_OUT'.*v\.ebayInventoryItemGroupKey&&!v\.ebayGroupPhotosRepairedAt/, 'must flag a live (LISTED or SOLD_OUT) group listing that has never been repaired');
assert.match(issuesFn, /needsPhotoRepair\.push\(v\);/, 'a flagged group must be collected into needsPhotoRepair');

assert.match(focDash, /issues\.needsPhotoRepair\.map\(function\(v\)\{/, 'the health panel must render the needsPhotoRepair rows');
assert.match(focDash, /Run REPAIR LISTING PHOTOS below\./, 'the flagged row must point staff at the actual fix');

console.log('FOC eBay group-listing photo repair visibility checks passed');

// ── Functional: dedupe by group key, only flag live+unrepaired groups ──
{
  function focEbayHealthIssues(skus){
    var released=[],missingDate=[],needsPhotoRepair=[];
    var seenGroupKeys={};
    skus.forEach(function(v){
      if(v.ebayPresaleStatus==='RELEASED'&&Number(v.ebayAvailable||0)>0)released.push(v);
      else if(v.ebayPresaleStatus==='ACTION_REQUIRED'&&v.ebayPresaleNote)missingDate.push(v);
      if((v.ebayPresaleStatus==='LISTED'||v.ebayPresaleStatus==='SOLD_OUT')&&v.ebayInventoryItemGroupKey&&!v.ebayGroupPhotosRepairedAt&&!seenGroupKeys[v.ebayInventoryItemGroupKey]){
        seenGroupKeys[v.ebayInventoryItemGroupKey]=true;
        needsPhotoRepair.push(v);
      }
    });
    return {released:released,missingDate:missingDate,needsPhotoRepair:needsPhotoRepair};
  }

  const unrepairedCoverA = { title:'Title A - Cover 1', ebayPresaleStatus:'LISTED', ebayInventoryItemGroupKey:'grp1', ebayGroupPhotosRepairedAt:'' };
  const unrepairedCoverB = { title:'Title A - Cover 2', ebayPresaleStatus:'LISTED', ebayInventoryItemGroupKey:'grp1', ebayGroupPhotosRepairedAt:'' };
  const repairedGroup = { title:'Title B - Cover 1', ebayPresaleStatus:'LISTED', ebayInventoryItemGroupKey:'grp2', ebayGroupPhotosRepairedAt:'2026-01-01T00:00:00.000Z' };
  const singleCoverListing = { title:'Title C', ebayPresaleStatus:'LISTED', ebayInventoryItemGroupKey:'' };
  const notYetListed = { title:'Title D', ebayPresaleStatus:'ELIGIBLE_NOW', ebayInventoryItemGroupKey:'' };

  const { needsPhotoRepair } = focEbayHealthIssues([unrepairedCoverA, unrepairedCoverB, repairedGroup, singleCoverListing, notYetListed]);
  assert.deepEqual(needsPhotoRepair.map(v => v.title), ['Title A - Cover 1'], 'an unrepaired live group must be flagged exactly once, regardless of how many covers share its group key; a repaired group, a single-cover listing, and a not-yet-listed SKU must never be flagged');
}

console.log('FOC eBay group-listing photo repair visibility functional checks passed');
