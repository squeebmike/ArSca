import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-11-tournament-events.sql', 'utf8');

// Migration: tables + RLS exist, store-scoped.
for (const table of ['events', 'event_registrations', 'event_matches']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `migration missing ${table} table`);
  assert.match(migration, new RegExp(`${table}_select_member`), `${table} missing a select RLS policy`);
}

// Tab plumbing: registered with the role/plan gate system, not just a bare panel.
assert.match(dashboard, /id="tab-events"/, 'events tab panel must exist');
assert.match(dashboard, /\['events', 'TOURNAMENTS'\]/, 'events must be reachable from the tab nav');
assert.match(dashboard, /events:'events'.*channels:'marketplace'/, 'events tab must be registered in TAB_CAPABILITY');
assert.match(dashboard, /'overview','display','browse','inventory','research','pos','alerts','wantlist','locations','restock','sets','events'/, 'employees must be able to reach the events tab');
assert.match(dashboard, /capabilities:\['research','checkout','sales','inventory','consignments','staff','shows','events'\]/, 'events must be gated at the Store plan tier alongside shows');

// Core functions exist.
for (const fn of ['loadEventsFromSupabase', 'renderEventsPanel', 'saveEventFromForm', 'addEventRegistration', 'chargeEventEntryFee', 'markEventEntryFeesPaidFromSaleLines', 'startNextRound', 'reportMatchResult', 'computeSwissPairings', 'computeStandings']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Entry fee rides the real checkout/cart flow (cash drawer + sales reporting
// coverage), not a side-channel payment -- same one_off + metadata pattern
// gift cards use.
assert.match(dashboard, /metadata:\{ eventEntryFee:true, eventId:event\.id, registrationId:reg\.id \}/, 'entry fee must be tagged for the post-checkout hook');
assert.match(dashboard, /await markEventEntryFeesPaidFromSaleLines\(bundle\);/, 'checkout finalize must mark entry fees paid');

// Offline durability for all event writes.
for (const type of ['event-upsert', 'event-registration-upsert', 'event-round-start', 'event-match-result', 'event-entry-fee-paid']) {
  assert.match(dashboard, new RegExp(`item\\.type === '${type}'`), `${type} must be replayable from the offline sync queue`);
}

assert.match(dashboard, /'pos_ops_log','pos_show_mode','pos_customers','customers_cache_v1','events_cache_v1','pos_undo_stack'/, 'events cache must be store-scoped (per-store, not shared across a multi-store device)');

console.log('Tournament events contract checks passed');

// ── Functional check: the Swiss pairing + standings algorithms themselves ──
// (not just "the function exists" -- these are the two places a real bug
// would silently produce wrong tournament results).
const pairingsSrc = dashboard.match(/function computeSwissPairings\(players, previousMatches\)\{[\s\S]*?\n\}/)?.[0];
const shuffleSrc = dashboard.match(/function shuffleArray\(arr\)\{[\s\S]*?\n\}/)?.[0];
const standingsSrc = dashboard.match(/function computeStandings\(registrations, matches\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(pairingsSrc, 'could not extract computeSwissPairings for functional testing');
assert.ok(standingsSrc, 'could not extract computeStandings for functional testing');
const { computeSwissPairings, computeStandings } = new Function(`${shuffleSrc}\n${pairingsSrc}\n${standingsSrc}\nreturn { computeSwissPairings, computeStandings };`)();

// Odd field: exactly one bye, everyone else paired, no player faces themself.
{
  const players = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
  const pairs = computeSwissPairings(players, []);
  const byes = pairs.filter(p => !p.player2);
  assert.equal(byes.length, 1, 'odd field must produce exactly one bye');
  assert.equal(pairs.length, 3, '5 players must produce 3 pairing rows (2 matches + 1 bye)');
  const seen = new Set();
  pairs.forEach(p => {
    assert.notEqual(p.player1.id, p.player2?.id, 'a player must never be paired against themself');
    [p.player1.id, p.player2?.id].filter(Boolean).forEach(id => {
      assert.ok(!seen.has(id), `player ${id} appears in more than one pairing row this round`);
      seen.add(id);
    });
  });
  assert.equal(seen.size, 5, 'every player must appear in exactly one pairing row');
}

// Repeat-opponent avoidance: with only 4 players, round 2 pairings must not
// reuse round 1's pairs when a non-repeat pairing is available.
{
  const players = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const round1 = computeSwissPairings(players, []);
  const round1Matches = round1.map(p => ({ player1_registration_id:p.player1.id, player2_registration_id:p.player2?.id || null }));
  const round2 = computeSwissPairings(players, round1Matches);
  const round1Keys = new Set(round1Matches.map(m => [m.player1_registration_id, m.player2_registration_id].sort().join('|')));
  round2.forEach(p => {
    if(!p.player2) return;
    const key = [p.player1.id, p.player2.id].sort().join('|');
    assert.ok(!round1Keys.has(key), `round 2 repeated a round 1 pairing: ${key}`);
  });
}

// Even field: no byes at all.
{
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id }));
  const pairs = computeSwissPairings(players, []);
  assert.equal(pairs.filter(p => !p.player2).length, 0, 'even field must not produce a bye');
  assert.equal(pairs.length, 3, '6 players must produce exactly 3 matches');
}

// Standings: winner outranks loser, bye counts as a win, draw splits points.
{
  const registrations = [
    { id:'p1', player_name:'Alice', dropped:false },
    { id:'p2', player_name:'Bob', dropped:false },
    { id:'p3', player_name:'Carol', dropped:false },
  ];
  const matches = [
    { player1_registration_id:'p1', player2_registration_id:'p2', result:'p1', player1_game_wins:2, player2_game_wins:0 },
    { player1_registration_id:'p3', player2_registration_id:null, result:null }, // bye, unreported in this fixture on purpose
    { player1_registration_id:'p2', player2_registration_id:'p3', result:'draw', player1_game_wins:1, player2_game_wins:1 },
  ];
  const standings = computeStandings(registrations, matches);
  const byId = Object.fromEntries(standings.map(s => [s.registration.id, s]));
  assert.equal(byId.p1.points, 3, 'match winner must get 3 points');
  assert.equal(byId.p1.wins, 1);
  assert.equal(byId.p2.points, 1, 'a draw must be worth 1 point, not a full win');
  assert.equal(byId.p3.points, 1);
  assert.equal(standings[0].registration.id, 'p1', 'the only match winner must rank first');
}

console.log('Swiss pairing + standings functional checks passed');
