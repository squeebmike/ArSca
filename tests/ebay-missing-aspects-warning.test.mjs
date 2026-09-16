import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store gap: computeEbayListingFields' own comments identify Player/Team/
// Auto/Patch/RC as the highest-value eBay search (Cassini) terms for
// sports cards, but nothing ever warned staff when a listing was about to
// publish with those blank. Non-blocking -- a real reason to list without
// one can exist -- just a confirm() before publish.

assert.match(dashboard, /function ebayMissingHighValueAspectsWarning\(payload\)\{/, 'missing ebayMissingHighValueAspectsWarning');
const fnStart = dashboard.indexOf('function ebayMissingHighValueAspectsWarning(payload){');
const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
const ebayMissingHighValueAspectsWarning = new Function(dashboard.slice(fnStart, fnEnd) + '\nreturn ebayMissingHighValueAspectsWarning;')();

assert.equal(ebayMissingHighValueAspectsWarning({ sport: '', player: '', team: '' }), '', 'must never warn for a non-sports-card listing (sport blank), regardless of player/team');
assert.equal(ebayMissingHighValueAspectsWarning({ sport: 'Baseball', player: 'Mike Trout', team: 'Angels' }), '', 'must not warn when both Player and Team are filled in');
assert.match(ebayMissingHighValueAspectsWarning({ sport: 'Baseball', player: '', team: 'Angels' }), /Player/, 'must warn when Player is blank on a sports card');
assert.match(ebayMissingHighValueAspectsWarning({ sport: 'Baseball', player: 'Mike Trout', team: '' }), /Team/, 'must warn when Team is blank on a sports card');
assert.match(ebayMissingHighValueAspectsWarning({ sport: 'Baseball', player: '', team: '' }), /Player.*Team|Team.*Player/, 'must name both when both are blank');

console.log('eBay missing high-value aspects warning functional checks passed');

// Wired into the single-item listing submit path before publish.
const submitStart = dashboard.indexOf('async function submitDashboardEbayListing(id){');
const submitEnd = dashboard.indexOf('\n}', dashboard.indexOf("status.style.color='var(--red)'", submitStart)) + 2;
const submitFn = dashboard.slice(submitStart, submitEnd);
assert.match(submitFn, /const aspectsWarning = ebayMissingHighValueAspectsWarning\(payload\);/, 'submitDashboardEbayListing must compute the warning before publishing');
assert.match(submitFn, /if\(aspectsWarning && !confirm\(aspectsWarning\)\) return;/, 'a staff member must be able to cancel and go fill in Player/Team, or proceed anyway -- never a silent, un-skippable block, and never silently ignored either');

console.log('eBay missing high-value aspects warning wiring checks passed');
