import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-12-pull-lists.sql', 'utf8');
const metronLinkMigration = fs.readFileSync('supabase-migrations/2026-08-13-pull-list-metron-link.sql', 'utf8');
const issueDetailMigration = fs.readFileSync('supabase-migrations/2026-08-13-pull-list-issue-detail.sql', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Migration: tables + RLS exist, store-scoped.
for (const table of ['pull_list_series', 'pull_list_items', 'pull_list_subscriptions']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `migration missing ${table} table`);
  assert.match(migration, new RegExp(`${table}_select_member`), `${table} missing a select RLS policy`);
}

// Subscriptions denormalize customer_name (same convention as
// event_registrations.player_name) so rendering never needs a join.
assert.match(migration, /customer_name text not null/, 'pull_list_subscriptions must store customer_name directly');
// One subscription per customer per series, not silent duplicates.
assert.match(migration, /idx_pull_list_subscriptions_unique on public\.pull_list_subscriptions\(series_id, customer_id\)/, 'a customer must not be able to subscribe to the same series twice');

// Tab plumbing: registered with the role/plan gate system, not just a bare panel.
assert.match(dashboard, /id="tab-pulllists"/, 'pull lists tab panel must exist');
assert.match(dashboard, /\['pulllists', 'PULL LISTS'\]/, 'pull lists must be reachable from the tab nav');
assert.match(dashboard, /pulllists:'pulllists'/, 'pulllists tab must be registered in TAB_CAPABILITY');
assert.match(dashboard, /'overview','display','browse','inventory','research','pos','alerts','wantlist','locations','restock','sets','events','pulllists'/, 'employees must be able to reach the pull lists tab');
assert.match(dashboard, /capabilities:\['research','checkout','sales','inventory','consignments','staff','shows','events','pulllists'\]/, 'pull lists must be gated at the Store plan tier alongside events');
assert.match(dashboard, /if\(name === 'pulllists'\) setTimeout\(ensurePullListPanel, 0\);/, 'switching to the pull lists tab must trigger a render');

// Core functions exist.
for (const fn of ['loadPullListSeriesFromSupabase', 'loadPullListDetail', 'loadAllPullListDataForOrderSheet', 'renderPullListPanel',
  'savePullListSeriesFromForm', 'addPullListItem', 'setPullListItemStatus', 'addPullListSubscription', 'removePullListSubscription',
  'computePullListOrderSheetRows', 'renderPullListOrderSheetInto']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Subscribing requires a findable contact (not just a name) -- otherwise a
// duplicate/typo'd walk-in name silently creates an unreachable subscriber.
assert.match(dashboard, /if\(!contact\) return toast_dash\('Enter a phone or email so this subscriber can be found again'\);/, 'pull list subscription must require a contact method');

// Subscribing rides the same customer upsert as event registration, so a
// subscriber and a tournament player and a loyalty member are one record.
assert.match(dashboard, /const customer = await upsertCustomer\(name, contact, '', 'pulllist'\);/, 'pull list subscription must upsert through the shared customers table');

// Offline durability for all pull list writes.
for (const type of ['pulllist-series-upsert', 'pulllist-item-upsert', 'pulllist-item-status', 'pulllist-subscription-upsert']) {
  assert.match(dashboard, new RegExp(`item\\.type === '${type}'`), `${type} must be replayable from the offline sync queue`);
}

assert.match(dashboard, /'pos_ops_log','pos_show_mode','pos_customers','customers_cache_v1','events_cache_v1','pulllist_series_cache_v1','pos_undo_stack'/, 'pull list cache must be store-scoped (per-store, not shared across a multi-store device)');

console.log('Pull list contract checks passed');

// ── Metron auto-discovery: no distributor has a public API, so this rides
// the already-integrated Metron bibliographic catalog instead. ──

assert.match(metronLinkMigration, /alter table public\.pull_list_series add column if not exists metron_series_id text/, 'pull_list_series must be able to remember its resolved Metron series so repeat lookups skip disambiguation');

// Worker: /comic/metron/search must accept a store-date range so it can
// answer "what's solicited but not out yet" instead of only "look up this
// one known issue number".
assert.match(worker, /storeDateAfter = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(url\.searchParams\.get\('store_date_after'\)/, 'worker must accept a validated store_date_after param');
assert.match(worker, /storeDateBefore = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(url\.searchParams\.get\('store_date_before'\)/, 'worker must accept a validated store_date_before param');
assert.match(worker, /\.\.\.\(storeDateAfter \? \{ store_date_range_after:storeDateAfter \} : \{\}\), \.\.\.\(storeDateBefore \? \{ store_date_range_before:storeDateBefore \} : \{\}\)/, 'the date-range params must actually reach the Metron filters, not just be parsed and discarded');

for (const fn of ['findUpcomingIssuesFromMetron', 'savePullListSeriesMetronId', 'showMetronSeriesPickerForPullList', 'chooseMetronSeriesForPullList', 'showMetronUpcomingIssuesModal', 'addSelectedMetronIssuesToPullList']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Ambiguous series name (multiple Metron matches, e.g. a reboot) must route
// to a picker, not silently guess or silently fail.
assert.match(dashboard, /if\(data\.seriesChoices\?\.length > 1\) return showMetronSeriesPickerForPullList\(data\.seriesChoices\);/, 'multiple Metron series matches must show a disambiguation picker, not guess');

// Metron tracks street (on-sale) dates, not FOC (order cutoff) dates -- the
// bulk-add must never fabricate a FOC date from data Metron doesn't have.
assert.match(dashboard, /foc_date:null, street_date:iss\.storeDate \|\| null,/, 'issues added from Metron must leave foc_date unset, never invented from the street date');

// Issues already tracked for this series must not be re-addable as
// duplicates from the discovery modal.
assert.match(dashboard, /const existingNumbers = new Set\(\(pullListItemsCache\[series\?\.id\] \|\| \[\]\)\.map\(i => i\.issue_number\)\);/, 'already-tracked issue numbers must be excluded/disabled in the discovery picker');

// ── New Releases browse mode: discovery without first adding a series ──

// A bare date range (no series/creator/upc/sku) must be a valid request on
// its own, not rejected by the original "must identify something" gate.
assert.match(worker, /if \(!series && !seriesId && !creator && !upc && !sku && !storeDateAfter\) return json\(\{ ok:false, error:'Comic series, creator, UPC, SKU, or a store date range is required' \}, 400\);/, 'a bare store date range must be accepted, not just series/creator/upc/sku lookups');
assert.match(worker, /if \(storeDateAfter && !series && !seriesId && !creator && !upc && !sku\) \{/, 'worker must have a distinct browse-mode branch for a bare date range');
assert.match(worker, /store_date_range_after:storeDateAfter, \.\.\.\(storeDateBefore \? \{ store_date_range_before:storeDateBefore \} : \{\}\), \.\.\.\(publisher \? \{ publisher_name:publisher \} : \{\}\), page \};/, 'browse mode must support an optional publisher filter alongside the date range');

for (const fn of ['renderPullListBrowseInto', 'searchPullListNewReleases', 'renderPullListBrowseResults', 'createPullListSeriesFromMetron', 'addBrowsedIssueToPullList']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}
assert.match(dashboard, /\['pulllist-browse-from','pulllist-browse-to','pulllist-browse-publisher'\]|pulllist-browse-from/, 'browse view must have date/publisher filter inputs');

// Adding a browsed issue must match series by Metron's real series id first
// (not just fuzzy title text), so a reboot/relaunch with the same title as
// an existing series doesn't get silently merged into the wrong one.
assert.match(dashboard, /pullListSeriesCache\.find\(s => s\.metron_series_id && s\.metron_series_id === iss\.seriesId\)/, 'browsed-issue add must prefer matching by Metron series id over title text');

console.log('New Releases browse mode checks passed');

console.log('Metron pull-list auto-discovery checks passed');

// ── Functional check: computePullListOrderSheetRows ──
{
  const rowsSrc = dashboard.match(/function computePullListOrderSheetRows\(seriesList, itemsCache, subscriptionsCache\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(rowsSrc, 'could not extract computePullListOrderSheetRows for functional testing');
  const { computePullListOrderSheetRows } = new Function(`${rowsSrc}\nreturn { computePullListOrderSheetRows };`)();

  const seriesList = [
    { id:'s1', title:'Amazing Spider-Man' },
    { id:'s2', title:'Batman' },
  ];
  const itemsCache = {
    s1: [
      { id:'i1', issue_number:'12', foc_date:'2026-09-10', status:'upcoming' },
      { id:'i2', issue_number:'13', foc_date:'2026-08-20', status:'upcoming' },
      { id:'i3', issue_number:'11', foc_date:'2026-07-01', status:'ordered' }, // must be excluded -- not upcoming
    ],
    s2: [
      { id:'i4', issue_number:'5', foc_date:null, status:'upcoming' }, // no FOC date -- must sort last
    ],
  };
  const subscriptionsCache = {
    s1: [{ id:'sub1', active:true }, { id:'sub2', active:true }, { id:'sub3', active:false }], // inactive must not count
    s2: [],
  };

  const rows = computePullListOrderSheetRows(seriesList, itemsCache, subscriptionsCache);
  assert.equal(rows.length, 3, 'ordered-status items must be excluded, only upcoming items appear');
  assert.equal(rows[0].item.id, 'i2', 'earliest FOC date must sort first');
  assert.equal(rows[1].item.id, 'i1', 'later FOC date must sort second');
  assert.equal(rows[2].item.id, 'i4', 'an item with no FOC date must sort last, not first');
  assert.equal(rows[0].subscriberCount, 2, 'inactive subscriptions must not count toward the subscriber total');
  assert.equal(rows[2].subscriberCount, 0, 'a series with no subscribers must show a zero count, not crash');
}

console.log('Pull list order sheet functional checks passed');

// ── Cover click detail + demand signals ──

assert.match(issueDetailMigration, /alter table public\.pull_list_items add column if not exists metron_issue_id text/, 'pull_list_items must be able to remember its Metron issue id for later cover-click lookups');
assert.match(dashboard, /metron_issue_id:iss\.id \|\| null/, 'adding an issue from New Releases must persist its Metron issue id, not just the cover image');

for (const fn of ['openComicCoverDetail', 'closeComicCoverDetail', 'renderComicCoverDetail', 'comicCoverTargetId', 'checkEbaySoldCompsForComicIssue', 'detectVariantSignal']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Cover detail must reuse the existing Metron issue-detail route (built
// for the Research tab), not a duplicate endpoint.
assert.match(dashboard, /storeWorkerFetch\('\/comic\/metron\/issue\/' \+ encodeURIComponent\(metronIssueId\)/, 'cover detail must call the existing /comic/metron/issue/:id route');

// Sold-comps must reuse the existing generic endpoint (built for card price
// research), not a comic-specific duplicate.
assert.match(dashboard, /storeWorkerFetch\('\/comps\/sold\?' \+ new URLSearchParams/, 'demand check must call the existing /comps/sold route');

// A pull-list item's cover is only clickable when a Metron issue id is on
// file -- a manually-typed issue (no Metron link) must not render a dead
// click target.
assert.match(dashboard, /\$\{i\.metron_issue_id \? `onclick="openComicCoverDetail\('\$\{escHtml\(i\.metron_issue_id\)\}'\)"` : ''\}/, 'pull list item cover must only be clickable when a Metron issue id is on file');

console.log('Cover detail + demand signal contract checks passed');

// ── Functional check: detectVariantSignal (free demand-signal heuristic) ──
{
  const fnSrc = dashboard.match(/function detectVariantSignal\(label\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fnSrc, 'could not extract detectVariantSignal for functional testing');
  const { detectVariantSignal } = new Function(`${fnSrc}\nreturn { detectVariantSignal };`)();

  assert.equal(detectVariantSignal('1:25 Incentive Variant'), '1:25 INCENTIVE', 'a numeric incentive ratio must be detected');
  assert.equal(detectVariantSignal('1:50 Retailer Incentive Cover'), '1:50 INCENTIVE', 'ratio detection must win even when "retailer incentive" text is also present');
  assert.equal(detectVariantSignal('Virgin Variant'), 'VIRGIN (no text/logo)', 'a virgin cover must be flagged');
  assert.equal(detectVariantSignal('Sketch Cover by Artist'), 'SKETCH COVER', 'a sketch cover must be flagged');
  assert.equal(detectVariantSignal('San Diego Comic-Con Exclusive'), 'CONVENTION EXCLUSIVE', 'a convention exclusive must be flagged');
  assert.equal(detectVariantSignal('Foil Cover'), 'FOIL', 'a foil cover must be flagged');
  assert.equal(detectVariantSignal('Regular Cover A'), '', 'an ordinary cover must not be flagged with a fabricated signal');
  assert.equal(detectVariantSignal(''), '', 'an empty label must not throw or fabricate a signal');
}

console.log('detectVariantSignal functional checks passed');
