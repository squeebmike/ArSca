import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-11-tournament-events.sql', 'utf8');

// Migration: tables + RLS exist, store-scoped.
for (const table of ['events', 'event_registrations', 'event_matches']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `migration missing ${table} table`);
  assert.match(migration, new RegExp(`${table}_select_member`), `${table} missing a select RLS policy`);
}

// pos_sales.id is text, not uuid (client-generated ids aren't always
// UUID-shaped) -- a uuid FK against it fails to create at all (42804).
assert.doesNotMatch(migration, /sale_id uuid references public\.pos_sales/, 'sale_id FK must be text, not uuid -- pos_sales.id is text');
assert.match(migration, /sale_id text references public\.pos_sales\(id\)/, 'event_registrations.sale_id must be text');

// Tab plumbing: registered with the role/plan gate system, not just a bare panel.
assert.match(dashboard, /id="tab-events"/, 'events tab panel must exist');
assert.match(dashboard, /\['events', 'TOURNAMENTS'\]/, 'events must be reachable from the tab nav');
assert.match(dashboard, /events:'events'.*channels:'marketplace'/, 'events tab must be registered in TAB_CAPABILITY');
assert.match(dashboard, /'overview','display','browse','inventory','research','pos','alerts','wantlist','locations','restock','sets','events'/, 'employees must be able to reach the events tab');
assert.match(dashboard, /capabilities:\['research','checkout','sales','inventory','consignments','staff','shows','events'\]/, 'events must be gated at the Store plan tier alongside shows');

// Core functions exist.
for (const fn of ['loadEventsFromSupabase', 'renderEventsPanel', 'saveEventFromForm', 'addEventRegistration', 'chargeEventEntryFee', 'markEventEntryFeesPaidFromSaleLines', 'startNextRound', 'reportMatchResult', 'computeSwissPairings', 'computeStandings', 'computeLeaderboard', 'renderLeaderboardInto', 'loadAllEventDataForLeaderboard']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Leaderboard aggregates cloud-stored results across events (not a
// per-device localStorage tally) and only counts completed events.
assert.match(dashboard, /events\.filter\(e => e\.status === 'completed' && \(gameFilter === 'All' \|\| e\.game === gameFilter\)\)/, 'leaderboard must aggregate only completed events, filterable by format/game');
assert.match(dashboard, /r\.customer_id \|\| \(\(r\.player_name \|\| ''\)\.trim\(\)\.toLowerCase\(\) \+ '\|' \+ \(r\.contact \|\| ''\)\.trim\(\)\.toLowerCase\(\)\)/, 'leaderboard must key players by customer_id when known, else name+contact');

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

// ── Functional check: computeLeaderboard aggregates across events ──
{
  const leaderboardSrc = dashboard.match(/function computeLeaderboard\(events, gameFilter\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(leaderboardSrc, 'could not extract computeLeaderboard for functional testing');
  const { computeLeaderboard } = new Function(`${standingsSrc}\n${leaderboardSrc}\nreturn { computeLeaderboard };`)();

  const events = [
    { id:'ev1', status:'completed', game:'Magic: The Gathering' },
    { id:'ev2', status:'completed', game:'Magic: The Gathering' },
    { id:'ev3', status:'completed', game:'Pokemon TCG' },
    { id:'ev4', status:'upcoming', game:'Magic: The Gathering' }, // must be ignored -- not completed
  ];
  const registrationsByEvent = {
    ev1: [{ id:'r1', player_name:'Alice', contact:'alice@x.com', customer_id:'cust-1' }, { id:'r2', player_name:'Bob', contact:'' }],
    ev2: [{ id:'r3', player_name:'Alice', contact:'alice@x.com', customer_id:'cust-1' }, { id:'r4', player_name:'Bob', contact:'' }],
    ev3: [{ id:'r5', player_name:'Alice', contact:'alice@x.com', customer_id:'cust-1' }],
    ev4: [{ id:'r6', player_name:'Alice', contact:'alice@x.com', customer_id:'cust-1' }],
  };
  const matchesByEvent = {
    ev1: [{ player1_registration_id:'r1', player2_registration_id:'r2', result:'p1', player1_game_wins:2, player2_game_wins:0 }],
    ev2: [{ player1_registration_id:'r3', player2_registration_id:'r4', result:'p2', player1_game_wins:0, player2_game_wins:2 }],
    ev3: [{ player1_registration_id:'r5', player2_registration_id:null, result:'p1' }],
    ev4: [],
  };
  global.eventRegistrationsCache = registrationsByEvent;
  global.eventMatchesCache = matchesByEvent;

  const mtgBoard = computeLeaderboard(events, 'Magic: The Gathering');
  const byName = Object.fromEntries(mtgBoard.map(r => [r.name, r]));
  assert.equal(mtgBoard.length, 2, 'MTG leaderboard must only include the 2 distinct MTG players, not the Pokemon or upcoming-event entries');
  assert.equal(byName.Alice.points, 3, 'Alice won ev1 (3pts) and lost ev2 (0pts) -- must sum across events, not just the latest');
  assert.equal(byName.Alice.wins, 1);
  assert.equal(byName.Bob.points, 3, 'Bob lost ev1 (0pts) and won ev2 (3pts)');
  assert.equal(byName.Alice.events, 2, 'Alice played 2 completed MTG events');

  const allBoard = computeLeaderboard(events, 'All');
  assert.equal(allBoard.length, 2, '"All" filter must still key Alice by customer_id across MTG+Pokemon into one row, not split her by game');
  const aliceAll = allBoard.find(r => r.name === 'Alice');
  assert.equal(aliceAll.events, 3, 'Alice\'s "All formats" total must include all 3 of her completed events (2 MTG + 1 Pokemon)');

  const pokemonBoard = computeLeaderboard(events, 'Pokemon TCG');
  assert.equal(pokemonBoard.length, 1);
  assert.equal(pokemonBoard[0].points, 3, 'a bye in a completed event must still award points to the leaderboard');
}

console.log('Leaderboard functional checks passed');
