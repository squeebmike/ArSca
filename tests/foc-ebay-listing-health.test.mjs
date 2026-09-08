import fs from 'node:fs';
import assert from 'node:assert/strict';

const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');

// Store idea: a live eBay presale listing whose on-sale date has already
// passed isn't caught by anything today -- ebayPresaleStatus flips to
// RELEASED but nothing stops the listing itself from staying live and
// still selling copies of a book that's now overdue. This surfaces those,
// plus SKUs eBay can't even schedule (no on-sale date on file), on the
// FOC Cover Wall automatically.

assert.match(preorders, /ebayPresaleStatus:'RELEASED'/, 'sanity check: the RELEASED status this feature reads must actually exist server-side');

assert.match(focDash, /function focEbayHealthIssues\(\)\{/, 'missing focEbayHealthIssues');
const issuesStart = focDash.indexOf('function focEbayHealthIssues(){');
const issuesEnd = focDash.indexOf('\n}', issuesStart) + 2;
const issuesFn = focDash.slice(issuesStart, issuesEnd);
assert.match(issuesFn, /v\.ebayPresaleStatus==='RELEASED'&&Number\(v\.ebayAvailable\|\|0\)>0/, 'must flag listings past on-sale date that are STILL live with copies available -- not ones already sold out or already withdrawn');
assert.match(issuesFn, /v\.ebayPresaleStatus==='ACTION_REQUIRED'&&v\.ebayPresaleNote/, 'must also flag SKUs eBay could not schedule at all (missing on-sale date)');

assert.match(focDash, /function focEbayHealthPanelHtml\(\)\{/, 'missing focEbayHealthPanelHtml');
const panelStart = focDash.indexOf('function focEbayHealthPanelHtml(){');
const panelEnd = focDash.indexOf('\n}', panelStart) + 2;
const panelFn = focDash.slice(panelStart, panelEnd);
assert.match(panelFn, /if\(!total\)return'';/, 'a cycle with no issues must render nothing, not an empty warning box cluttering the Cover Wall');
assert.match(panelFn, /EBAY LISTING HEALTH/, 'panel must have a clear heading');

// Wired into the Cover Wall render, and the eBay status filter dropdown
// now offers RELEASED as an option (it existed as a real status already,
// just wasn't selectable).
assert.match(focDash, /<\/section>'\+focEbayHealthPanelHtml\(\)\+'<div class="panel foc-toolbar"/, 'the health panel must actually be rendered on the Cover Wall, not just defined');
assert.match(focDash, /<option value="RELEASED" '\+\(state\.ebay==='RELEASED'\?'selected':''\)\+'>Released \(on sale\)<\/option>/, 'RELEASED must be selectable in the eBay status filter, matching every other real status');

console.log('FOC eBay listing health check contract checks passed');

// ── Functional: reimplement the flagging logic and prove it ──
function focEbayHealthIssues(skus){
  const released=[], missingDate=[];
  skus.forEach(v => {
    if(v.ebayPresaleStatus==='RELEASED' && Number(v.ebayAvailable||0)>0) released.push(v);
    else if(v.ebayPresaleStatus==='ACTION_REQUIRED' && v.ebayPresaleNote) missingDate.push(v);
  });
  return { released, missingDate };
}

const skus = [
  { title:'Overdue Still Live', ebayPresaleStatus:'RELEASED', ebayAvailable:4 },
  { title:'Overdue But Sold Out', ebayPresaleStatus:'RELEASED', ebayAvailable:0 },
  { title:'Not Yet Released', ebayPresaleStatus:'LISTED', ebayAvailable:5 },
  { title:'No On-Sale Date', ebayPresaleStatus:'ACTION_REQUIRED', ebayPresaleNote:'No on-sale date on this SKU' },
  { title:'Never Listed On Ebay', ebayPresaleStatus:'ELIGIBLE_NOW' },
];
const { released, missingDate } = focEbayHealthIssues(skus);
assert.equal(released.length, 1, 'only a RELEASED cover that is STILL LIVE with availability must be flagged');
assert.equal(released[0].title, 'Overdue Still Live');
assert.equal(missingDate.length, 1, 'only ACTION_REQUIRED covers with a real note must be flagged');
assert.equal(missingDate[0].title, 'No On-Sale Date');

const healthyIssues = focEbayHealthIssues([{ title:'Fine', ebayPresaleStatus:'LISTED', ebayAvailable:3 }]);
assert.equal(healthyIssues.released.length + healthyIssues.missingDate.length, 0, 'a healthy cycle must produce zero issues');

console.log('FOC eBay listing health check functional checks passed');
