import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-12-pull-lists.sql', 'utf8');

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
