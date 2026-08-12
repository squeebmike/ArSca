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

// ── PRH FOC-list XLSX import ──

const upcMigration = fs.readFileSync('supabase-migrations/2026-08-14-pull-list-upc.sql', 'utf8');
assert.match(upcMigration, /alter table public\.pull_list_items add column if not exists upc text/, 'pull_list_items must be able to store the distributor UPC for dedupe on re-import');
assert.match(upcMigration, /create unique index if not exists idx_pull_list_items_upc on public\.pull_list_items\(series_id, upc\) where upc is not null/, 'UPC must be unique per series so re-importing the same file twice cannot create duplicates');

assert.match(dashboard, /xlsx@0\.18\.5\/dist\/xlsx\.full\.min\.js/, 'the XLSX parser library must be loaded for the PRH importer to work');

for (const fn of ['parsePrhFocPrice', 'parsePrhFocDate', 'parsePrhFocTitle', 'parsePrhFocRows', 'openPrhImportPicker', 'handlePrhImportFile', 'showPrhImportPreview', 'confirmPrhImport']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Import must dedupe by UPC (the distributor's real identifier), not by
// issue number alone -- two different variants of the same issue number
// are two different UPCs and must both be importable.
assert.match(dashboard, /const already = \(pullListItemsCache\[series\.id\] \|\| \[\]\)\.some\(i => i\.upc && i\.upc === row\.upc\);/, 'import must dedupe by UPC per series');

console.log('PRH import contract checks passed');

// ── Functional check: PRH FOC-list parsers, against real rows from an
// actual PRH FOC-list export (not synthetic fixtures) ──
{
  const priceSrc = dashboard.match(/function parsePrhFocPrice\(value\)\{[\s\S]*?\n\}/)?.[0];
  const dateSrc = dashboard.match(/function parsePrhFocDate\(value\)\{[\s\S]*?\n\}/)?.[0];
  const titleSrc = dashboard.match(/function parsePrhFocTitle\(title\)\{[\s\S]*?\n\}/)?.[0];
  const rowsSrc = dashboard.match(/function parsePrhFocRows\(rows\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(priceSrc && dateSrc && titleSrc && rowsSrc, 'could not extract PRH parser functions for functional testing');
  const { parsePrhFocPrice, parsePrhFocDate, parsePrhFocTitle, parsePrhFocRows } = new Function(
    `${priceSrc}\n${dateSrc}\n${titleSrc}\n${rowsSrc}\nreturn { parsePrhFocPrice, parsePrhFocDate, parsePrhFocTitle, parsePrhFocRows };`
  )();

  assert.equal(parsePrhFocPrice('$5.99 US'), 5.99);
  assert.equal(parsePrhFocPrice('$8.99 US'), 8.99);
  assert.equal(parsePrhFocDate('08/17/2026'), '2026-08-17', 'MM/DD/YYYY must convert to YYYY-MM-DD');
  assert.equal(parsePrhFocDate('09/30/2026'), '2026-09-30');
  assert.equal(parsePrhFocDate(''), null, 'a blank date must not throw or fabricate a date');

  assert.deepEqual(parsePrhFocTitle('ALIEN VS. X-MEN #1'), { seriesTitle:'ALIEN VS. X-MEN', issueNumber:'1', variantLabel:null }, 'a main-cover title with no variant text must parse cleanly with a null variant label');
  assert.deepEqual(parsePrhFocTitle('ALIEN VS. X-MEN #1 ALAN QUAH POSTER HOMAGE VARIANT'), { seriesTitle:'ALIEN VS. X-MEN', issueNumber:'1', variantLabel:'ALAN QUAH POSTER HOMAGE VARIANT' });
  assert.deepEqual(parsePrhFocTitle('THE AMAZING VENOM #1 ITO VIRGIN VARIANT'), { seriesTitle:'THE AMAZING VENOM', issueNumber:'1', variantLabel:'ITO VIRGIN VARIANT' }, 'a series title containing "THE" must not be confused with a different real series (Amazing Spider-Man)');
  assert.equal(parsePrhFocTitle('SOME GRAPHIC NOVEL'), null, 'a title with no issue number and no Cover/Variant marker must not be force-parsed');
  // Real one-shots from an actual PRH FOC-list export ship with no "#1" in
  // the title at all -- just "<Title> Cover A (Artist)". The primary
  // #-number regex alone drops these entirely; confirmed by running the
  // parser against the full real 168-row file before this fallback existed.
  assert.deepEqual(parsePrhFocTitle('Gangrene Cover A (Giménez)'), { seriesTitle:'Gangrene', issueNumber:'1', variantLabel:'Cover A (Giménez)' }, 'a one-shot with no issue number in the title must fall back to issue 1, not get dropped');
  assert.deepEqual(parsePrhFocTitle('Godzilla Vs. America: New York City Variant RI (25) (Fox Full Art)'), { seriesTitle:'Godzilla Vs. America: New York City', issueNumber:'1', variantLabel:'Variant RI (25) (Fox Full Art)' });

  // Real rows straight from an actual PRH FOC-list export (same shape
  // sheet_to_json produces: header row 1, banner row 0 already skipped).
  const realRows = [
    { 'ISBN/UPC':'75960621578200111', Quantity:'1', Title:'ALIEN VS. X-MEN #1', Subtitle:'', Creators:'Kieron Gillen', Imprint:'Marvel Universe', 'Retail Price (US)':'$5.99 US', 'Retail Price (CAN)':'$7.50 CAN', Format:'CB', 'FOC Date':'08/17/2026', 'On-Sale Date':'09/30/2026', Age:'', Grade:'' },
    { 'ISBN/UPC':'75960621578200121', Quantity:'1', Title:'ALIEN VS. X-MEN #1 JOHN ROMITA JR. FOIL VARIANT', Subtitle:'', Creators:'Kieron Gillen', Imprint:'Marvel Universe', 'Retail Price (US)':'$8.99 US', 'Retail Price (CAN)':'$11.25 CAN', Format:'CB', 'FOC Date':'08/17/2026', 'On-Sale Date':'09/30/2026', Age:'', Grade:'' },
    { 'ISBN/UPC':'75960621550800117', Quantity:'1', Title:'THE AMAZING VENOM #1 ITO VIRGIN VARIANT', Subtitle:'', Creators:'Jordan Morris', Imprint:'Marvel Universe', 'Retail Price (US)':'$4.99 US', 'Retail Price (CAN)':'$6.25 CAN', Format:'CB', 'FOC Date':'08/17/2026', 'On-Sale Date':'09/30/2026', Age:'', Grade:'' },
    // Not a comic-book format -- must be filtered out entirely.
    { 'ISBN/UPC':'99999999999', Quantity:'1', Title:'SOME TRADE PAPERBACK', Subtitle:'', Creators:'Someone', Imprint:'Marvel Universe', 'Retail Price (US)':'$19.99 US', 'Retail Price (CAN)':'$25.00 CAN', Format:'TP', 'FOC Date':'08/17/2026', 'On-Sale Date':'09/30/2026', Age:'', Grade:'' },
  ];
  const parsed = parsePrhFocRows(realRows);
  assert.equal(parsed.length, 3, 'the TP-format row must be filtered out, only CB rows parsed');
  assert.equal(parsed[0].upc, '75960621578200111', 'a 17-digit UPC must survive intact -- this exceeds JS safe-integer precision (2^53), so it must be read as text, not a rounded number');
  assert.equal(parsed[0].seriesTitle, 'ALIEN VS. X-MEN');
  assert.equal(parsed[0].variantLabel, null);
  assert.equal(parsed[1].variantLabel, 'JOHN ROMITA JR. FOIL VARIANT');
  assert.equal(parsed[1].priceUS, 8.99);
  assert.equal(parsed[0].focDate, '2026-08-17');
  assert.equal(parsed[0].streetDate, '2026-09-30');
  assert.equal(parsed[2].seriesTitle, 'THE AMAZING VENOM');
}

console.log('PRH import functional checks passed');

// ── #1 highlighting + sort/filter (date, #1s, variants, ratio) ──

for (const fn of ['isFirstIssue', 'pullListFirstIssueBadge', 'extractRatioValue', 'filterAndSortPullListBrowseResults', 'filterAndSortPullListOrderSheetRows', 'pullListFilterSortControlsHtml', 'applyPullListFilterSort']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// The badge must actually be wired into all four places an issue number is
// shown, not just exist as an unused helper.
assert.match(dashboard, /#\$\{escHtml\(iss\.number\)\}<\/b>\$\{pullListFirstIssueBadge\(iss\.number\)\}/, 'New Releases cards must show the #1 badge');
assert.match(dashboard, /#\$\{escHtml\(i\.issue_number\)\}<\/b>\$\{pullListFirstIssueBadge\(i\.issue_number\)\}/, 'pull list item rows must show the #1 badge');
assert.match(dashboard, /pullListFirstIssueBadge\(r\.item\.issue_number\)/, 'order sheet rows must show the #1 badge');
assert.match(dashboard, /#\$\{escHtml\(issue\.number\)\}\$\{pullListFirstIssueBadge\(issue\.number\)\}/, 'the cover detail modal heading must show the #1 badge');

console.log('#1 badge contract checks passed');

// ── Functional check: isFirstIssue / extractRatioValue ──
{
  const isFirstSrc = dashboard.match(/function isFirstIssue\(issueNumber\)\{[\s\S]*?\}/)?.[0];
  const ratioSrc = dashboard.match(/function extractRatioValue\(label\)\{[\s\S]*?\}/)?.[0];
  assert.ok(isFirstSrc && ratioSrc, 'could not extract isFirstIssue/extractRatioValue for functional testing');
  const { isFirstIssue, extractRatioValue } = new Function(`${isFirstSrc}\n${ratioSrc}\nreturn { isFirstIssue, extractRatioValue };`)();

  assert.equal(isFirstIssue('1'), true);
  assert.equal(isFirstIssue('1A'), true, 'a lettered first-issue variant number (1A) must still count as #1');
  assert.equal(isFirstIssue('10'), false, 'issue 10 must not be mistaken for issue 1');
  assert.equal(isFirstIssue('11'), false, 'issue 11 (starts with "1") must not be mistaken for issue 1');
  assert.equal(isFirstIssue(''), false);

  assert.equal(extractRatioValue('1:25 Incentive Variant'), 25);
  assert.equal(extractRatioValue('1:100 Retailer Incentive'), 100, 'a rarer 1:100 ratio must extract higher than a 1:25');
  assert.equal(extractRatioValue('Regular Cover A'), 0, 'a non-ratio label must extract to 0, not throw');
}

// ── Functional check: filterAndSortPullListBrowseResults ──
{
  const fnSrc = dashboard.match(/function filterAndSortPullListBrowseResults\(results, filters\)\{[\s\S]*?\n\}/)?.[0];
  const isFirstSrc = dashboard.match(/function isFirstIssue\(issueNumber\)\{[\s\S]*?\}/)?.[0];
  const ratioSrc = dashboard.match(/function extractRatioValue\(label\)\{[\s\S]*?\}/)?.[0];
  assert.ok(fnSrc, 'could not extract filterAndSortPullListBrowseResults for functional testing');
  const { filterAndSortPullListBrowseResults } = new Function(`${isFirstSrc}\n${ratioSrc}\n${fnSrc}\nreturn { filterAndSortPullListBrowseResults };`)();

  const results = [
    { id:'1', seriesName:'Alpha', number:'1', issueName:'', storeDate:'2026-09-10' },
    { id:'2', seriesName:'Alpha', number:'2', issueName:'1:25 Incentive Variant', storeDate:'2026-09-03' },
    { id:'3', seriesName:'Beta', number:'1', issueName:'1:100 Incentive Variant', storeDate:'2026-09-17' },
    { id:'4', seriesName:'Beta', number:'5', issueName:'Foil Variant', storeDate:'2026-08-20' },
  ];

  const firstOnly = filterAndSortPullListBrowseResults(results, { firstIssueOnly:true, variantOnly:false, ratioOnly:false, sortBy:'date' });
  assert.deepEqual(firstOnly.map(r => r.id), ['1','3'], '#1s-only filter must keep only issue-1 rows, in date order');

  const ratioOnly = filterAndSortPullListBrowseResults(results, { firstIssueOnly:false, variantOnly:false, ratioOnly:true, sortBy:'ratio' });
  assert.deepEqual(ratioOnly.map(r => r.id), ['3','2'], 'ratio-only + ratio sort must keep only ratio variants, rarest (highest ratio number) first');

  const variantOnly = filterAndSortPullListBrowseResults(results, { firstIssueOnly:false, variantOnly:true, ratioOnly:false, sortBy:'date' });
  assert.deepEqual(variantOnly.map(r => r.id), ['4','2','3'], 'variant-only filter must exclude the plain main cover (row 1)');

  const seriesSort = filterAndSortPullListBrowseResults(results, { firstIssueOnly:false, variantOnly:false, ratioOnly:false, sortBy:'series' });
  assert.deepEqual(seriesSort.map(r => r.id), ['2','1','4','3'], 'series sort must group by series name alphabetically, then by date ascending within series');
}

// ── Functional check: filterAndSortPullListOrderSheetRows ──
{
  const fnSrc = dashboard.match(/function filterAndSortPullListOrderSheetRows\(rows, filters\)\{[\s\S]*?\n\}/)?.[0];
  const isFirstSrc = dashboard.match(/function isFirstIssue\(issueNumber\)\{[\s\S]*?\}/)?.[0];
  const ratioSrc = dashboard.match(/function extractRatioValue\(label\)\{[\s\S]*?\}/)?.[0];
  assert.ok(fnSrc, 'could not extract filterAndSortPullListOrderSheetRows for functional testing');
  const { filterAndSortPullListOrderSheetRows } = new Function(`${isFirstSrc}\n${ratioSrc}\n${fnSrc}\nreturn { filterAndSortPullListOrderSheetRows };`)();

  const rows = [
    { series:{ title:'Alpha' }, item:{ issue_number:'1', variant_label:null, foc_date:'2026-09-10' } },
    { series:{ title:'Alpha' }, item:{ issue_number:'2', variant_label:'1:50 Incentive', foc_date:'2026-09-03' } },
    { series:{ title:'Beta' }, item:{ issue_number:'1', variant_label:'Virgin Variant', foc_date:'2026-09-17' } },
  ];
  const firstOnly = filterAndSortPullListOrderSheetRows(rows, { firstIssueOnly:true, variantOnly:false, ratioOnly:false, sortBy:'date' });
  assert.equal(firstOnly.length, 2, '#1s-only must keep both #1 rows across series');
  const ratioOnly = filterAndSortPullListOrderSheetRows(rows, { firstIssueOnly:false, variantOnly:false, ratioOnly:true, sortBy:'date' });
  assert.equal(ratioOnly.length, 1, 'ratio-only must keep only the row with a detectable incentive ratio');
  assert.equal(ratioOnly[0].item.issue_number, '2');
}

console.log('#1 badge + sort/filter functional checks passed');

// ── File picker must not reject a real file over MIME/extension mismatch;
// order sheet export is the honest answer to "how do we place the order"
// (no distributor accepts a submitted order from this app) ──

assert.doesNotMatch(dashboard, /id="pulllist-prh-import-file" accept=/, 'the PRH import file input must not restrict by accept -- mobile downloads often lack a clean .xlsx MIME/extension and get grayed out of the picker entirely');

for (const fn of ['csvEscapeField', 'pullListOrderCsvText', 'exportPullListOrderCsv']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}
// The export must respect whatever filter/sort is currently applied, not
// silently dump the entire untracked order sheet regardless of what's on screen.
assert.match(dashboard, /const rows = filterAndSortPullListOrderSheetRows\(allRows, pullListBrowseFilters\);\s*\n\s*if\(!rows\.length\) return toast_dash\('Nothing to export'\);/, 'CSV export must use the currently filtered/sorted rows, not all rows unconditionally');

console.log('File picker + order export contract checks passed');

// ── Functional check: pullListOrderCsvText ──
{
  const escSrc = dashboard.match(/function csvEscapeField\(value\)\{[\s\S]*?\n\}/)?.[0];
  const csvSrc = dashboard.match(/function pullListOrderCsvText\(rows\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(escSrc && csvSrc, 'could not extract CSV export functions for functional testing');
  const { pullListOrderCsvText } = new Function(`${escSrc}\n${csvSrc}\nreturn { pullListOrderCsvText };`)();

  const rows = [
    { series:{ title:'Alien vs. X-Men' }, item:{ issue_number:'1', variant_label:null, upc:'75960621578200111', foc_date:'2026-08-17' }, subscriberCount:3 },
    { series:{ title:'Batman, "The Dark"' }, item:{ issue_number:'2', variant_label:'1:25 Incentive', upc:'', foc_date:'2026-09-01' }, subscriberCount:0 },
  ];
  const csv = pullListOrderCsvText(rows);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Series,Issue,Variant,UPC,Subscribers (suggested qty),FOC Date', 'header row must be present and in order');
  assert.equal(lines[1], 'Alien vs. X-Men,1,,75960621578200111,3,2026-08-17');
  // A title containing a comma and quotes must be CSV-escaped, not corrupt
  // the row/column structure when opened in a spreadsheet.
  assert.equal(lines[2], '"Batman, ""The Dark""",2,1:25 Incentive,,0,2026-09-01');
  assert.equal(lines.length, 3, 'exactly header + 2 data rows, no stray blank lines');
}

console.log('Order CSV export functional checks passed');

// ── Cover/info backfill for manually-added + PRH-imported issues ──────
// Those two entry points never set metron_issue_id/cover_image_url (PRH's
// spreadsheet has neither; the manual form does no lookup), which is why a
// series detail view can show issues with no thumbnail and no click-through
// info. Confirm the backfill is wired in and matches variants sanely.

assert.match(dashboard, /function backfillPullListSeriesCoversFromMetron\(seriesId\)/, 'missing backfillPullListSeriesCoversFromMetron');
assert.match(dashboard, /function backfillPullListItemCoverFromMetron\(item, series\)/, 'missing backfillPullListItemCoverFromMetron');
assert.match(dashboard, /function pickMetronIssueMatch\(issues, variantLabel\)/, 'missing pickMetronIssueMatch');
assert.match(dashboard, /pullListItemsCache\[seriesId\] = itemRes\.data \|\| \[\];\s*\n\s*pullListSubscriptionsCache\[seriesId\] = subRes\.data \|\| \[\];\s*\n\s*backfillPullListSeriesCoversFromMetron\(seriesId\);/, 'loadPullListDetail must trigger the backfill once items are loaded');

console.log('Cover/info backfill contract checks passed');

// ── Functional check: pickMetronIssueMatch ──
{
  const fnSrc = dashboard.match(/function pickMetronIssueMatch\(issues, variantLabel\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fnSrc, 'could not extract pickMetronIssueMatch for functional testing');
  const { pickMetronIssueMatch } = new Function(`${fnSrc}\nreturn { pickMetronIssueMatch };`)();

  assert.equal(pickMetronIssueMatch([], 'Cover A'), null, 'no issues means no match');

  const single = [{ id:'1', issueName:'', imageUrl:'a.jpg' }];
  assert.equal(pickMetronIssueMatch(single, 'Cover A Daniel Gete').id, '1', 'a single candidate is used regardless of variant label');

  const multi = [
    { id:'10', issueName:'Cover A Daniel Gete', imageUrl:'a.jpg' },
    { id:'11', issueName:'Cover B David Lapham', imageUrl:'b.jpg' },
    { id:'12', issueName:'Cover C Incentive', imageUrl:'c.jpg' },
  ];
  assert.equal(pickMetronIssueMatch(multi, 'Cover B David Lapham').id, '11', 'exact-ish variant label match must pick the right cover, not just the first');
  assert.equal(pickMetronIssueMatch(multi, 'cover a daniel gete').id, '10', 'match must be case/punctuation insensitive');

  const noLabel = pickMetronIssueMatch(multi, null);
  assert.equal(noLabel.id, '10', 'with no variant label to match against, fall back to the first candidate');

  const noneMatch = pickMetronIssueMatch(multi, 'Totally Unrelated Text');
  assert.ok(['10','11','12'].includes(noneMatch.id), 'an unmatched label must still fall back to some candidate rather than returning nothing');
}

console.log('pickMetronIssueMatch functional checks passed');

// ── Cover thumbnail labels must show the cover's own name, not a blank source tag ──
// Metron sibling/nested covers never carried a `source` field, so the old
// `${c.source || ''}` label rendered blank under every Metron cover thumbnail
// -- this is the "tapping covers gives me no info" bug. The label must now
// prefer the cover's own name (which usually carries the artist, e.g. "Cover B
// David Lapham"), and clickable covers must hint that a tap loads full credits.

assert.doesNotMatch(dashboard, /\$\{c\.source \|\| ''\}<\/div>\s*\n\s*\$\{covSignal/, 'cover thumbnail label must not regress to the blank source-only tag');
assert.match(dashboard, /const rawName = c\.issueName \|\| c\.name \|\| '';/, 'missing rawName extraction for cover thumbnail label');
assert.match(dashboard, /const coverLabel = rawName && rawName !== issue\.seriesName \? rawName : \(targetId \? 'Main cover' : ''\);/, 'missing coverLabel fallback logic');
assert.match(dashboard, /tap for full credits/, 'clickable covers must hint that tapping loads full credits');

console.log('Cover thumbnail label fix checks passed');
