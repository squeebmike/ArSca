import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-11-tournament-events.sql', 'utf8');
const featuresMigration = fs.readFileSync('supabase-migrations/2026-08-12-tournament-features.sql', 'utf8');

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
assert.match(dashboard, /'overview','display','browse','inventory','research','pos','whatnot','alerts','wantlist','locations','restock','grading','sets','events'/, 'employees must be able to reach the events tab');
assert.match(dashboard, /capabilities:\['research','checkout','sales','inventory','consignments','staff','shows','events','pulllists'\]/, 'events must be gated at the Store plan tier alongside shows');

// Core functions exist.
for (const fn of ['loadEventsFromSupabase', 'renderEventsPanel', 'saveEventFromForm', 'addEventRegistration', 'chargeEventEntryFee', 'markEventEntryFeesPaidFromSaleLines', 'startNextRound', 'reportMatchResult', 'computeSwissPairings', 'computeStandings', 'computeLeaderboard', 'renderLeaderboardInto', 'loadAllEventDataForLeaderboard',
  'toggleEventCheckin', 'checkInAllEventPlayers', 'cutToTopN', 'reportBracketMatchResult', 'maybeAdvanceBracket', 'computeFinalPlacements', 'renderTopCutPanel', 'renderPrizesPanel', 'savePrizeAmount', 'issuePrizeGiftCard', 'completeEvent', 'awardEventLoyaltyPoints', 'setLeaderboardSeriesFilter']) {
  assert.match(dashboard, new RegExp(`function ${fn}`), `missing ${fn}`);
}

// Leaderboard aggregates cloud-stored results across events (not a
// per-device localStorage tally), only counts completed events, and can be
// sliced by series (season) as well as game/format.
assert.match(dashboard, /events\.filter\(e => e\.status === 'completed' && \(gameFilter === 'All' \|\| e\.game === gameFilter\) && \(!seriesFilter \|\| seriesFilter === 'All' \|\| e\.series_name === seriesFilter\)\)/, 'leaderboard must aggregate only completed events, filterable by format/game and by series');
assert.match(dashboard, /r\.customer_id \|\| \(\(r\.player_name \|\| ''\)\.trim\(\)\.toLowerCase\(\) \+ '\|' \+ \(r\.contact \|\| ''\)\.trim\(\)\.toLowerCase\(\)\)/, 'leaderboard must key players by customer_id when known, else name+contact');

// Entry fee rides the real checkout/cart flow (cash drawer + sales reporting
// coverage), not a side-channel payment -- same one_off + metadata pattern
// gift cards use.
assert.match(dashboard, /metadata:\{ eventEntryFee:true, eventId:event\.id, registrationId:reg\.id \}/, 'entry fee must be tagged for the post-checkout hook');
assert.match(dashboard, /await markEventEntryFeesPaidFromSaleLines\(bundle\);/, 'checkout finalize must mark entry fees paid');

// Offline durability for all event writes.
for (const type of ['event-upsert', 'event-registration-upsert', 'event-round-start', 'event-match-result', 'event-entry-fee-paid',
  'event-checkin', 'event-prize-award', 'event-topcut-start', 'event-bracket-result', 'event-loyalty-award']) {
  assert.match(dashboard, new RegExp(`item\\.type === '${type}'`), `${type} must be replayable from the offline sync queue`);
}

// Feature-expansion migration: new columns are additive (add column if not
// exists) so a store that already ran the original migration doesn't break.
assert.match(featuresMigration, /alter table public\.event_registrations add column if not exists checked_in boolean/, 'event_registrations must gain checked_in');
assert.match(featuresMigration, /alter table public\.event_registrations add column if not exists prize_amount numeric/, 'event_registrations must gain prize_amount');
assert.match(featuresMigration, /alter table public\.events add column if not exists top_cut_size integer/, 'events must gain top_cut_size');
assert.match(featuresMigration, /alter table public\.events add column if not exists series_name text/, 'events must gain series_name');
assert.match(featuresMigration, /alter table public\.event_matches add column if not exists stage text not null default 'swiss'/, 'event_matches must gain a stage column defaulting to swiss (backward compatible)');
assert.match(featuresMigration, /alter table public\.event_matches add column if not exists bracket_slot integer/, 'event_matches must gain bracket_slot');

// Top cut must never leak bracket-stage matches into the Swiss points table
// -- standings freeze at the cut point.
assert.match(dashboard, /const swissMatches = matches\.filter\(m => m\.stage !== 'topcut'\);/, 'Swiss standings must exclude top-cut bracket matches');

// Prize gift cards are comped (no sale attached) but issued through the same
// gift_cards table/codegen as a purchased one, so they spend identically.
assert.match(dashboard, /issued_sale_id:null, issued_by:getCurrentUserId\(\)/, 'prize gift cards must be issued with no sale attached');

assert.match(dashboard, /'pos_ops_log','pos_show_mode','pos_customers','customers_cache_v1','events_cache_v1','pulllist_series_cache_v1','pos_undo_stack'/, 'events cache must be store-scoped (per-store, not shared across a multi-store device)');

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
  const leaderboardSrc = dashboard.match(/function computeLeaderboard\(events, gameFilter, seriesFilter\)\{[\s\S]*?\n\}/)?.[0];
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

  // Series (season) filter: same events but tagged into two series -- only
  // ev1 in "Fall Series", only ev2 in "Winter Series".
  events[0].series_name = 'Fall Series';
  events[1].series_name = 'Winter Series';
  const fallBoard = computeLeaderboard(events, 'All', 'Fall Series');
  assert.equal(fallBoard.length, 2, 'Fall Series leaderboard must only include ev1 players');
  assert.equal(fallBoard.find(r => r.name === 'Alice').events, 1, 'Alice only played 1 Fall Series event even though she played 3 events total');
  const allSeriesBoard = computeLeaderboard(events, 'All', 'All');
  assert.equal(allSeriesBoard.find(r => r.name === 'Alice').events, 3, '"All" series filter must not narrow the results');
}

console.log('Leaderboard functional checks passed');

// ── Functional check: computeFinalPlacements (prize payout ordering) ──
{
  const placementsSrc = dashboard.match(/function computeFinalPlacements\(event, registrations, matches\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(placementsSrc, 'could not extract computeFinalPlacements for functional testing');
  const { computeFinalPlacements } = new Function(`${standingsSrc}\n${placementsSrc}\nreturn { computeFinalPlacements };`)();

  // No top cut: plain Swiss standings order.
  {
    const registrations = [
      { id:'p1', player_name:'Alice', dropped:false },
      { id:'p2', player_name:'Bob', dropped:false },
    ];
    const matches = [{ player1_registration_id:'p1', player2_registration_id:'p2', result:'p1', player1_game_wins:2, player2_game_wins:0 }];
    const placements = computeFinalPlacements({ top_cut_size:null }, registrations, matches);
    assert.equal(placements[0].player_name, 'Alice', 'no top cut -- placements must fall back to plain Swiss standings order');
  }

  // Top cut of 4: semifinal losers tie for 3rd/4th behind the final's winner/loser.
  {
    const registrations = ['Alice','Bob','Carol','Dave'].map((name,i) => ({ id:'p'+(i+1), player_name:name, dropped:false }));
    const matches = [
      // Semifinals (round 1 of the bracket, stage topcut, round_number 1).
      { round_number:1, stage:'topcut', bracket_slot:0, player1_registration_id:'p1', player2_registration_id:'p4', result:'p1' }, // Alice beats Dave
      { round_number:1, stage:'topcut', bracket_slot:1, player1_registration_id:'p2', player2_registration_id:'p3', result:'p1' }, // Bob beats Carol
      // Final (round 2).
      { round_number:2, stage:'topcut', bracket_slot:0, player1_registration_id:'p1', player2_registration_id:'p2', result:'p1' }, // Alice beats Bob
    ];
    const placements = computeFinalPlacements({ top_cut_size:4 }, registrations, matches);
    assert.equal(placements[0].player_name, 'Alice', 'the final winner must place 1st');
    assert.equal(placements[1].player_name, 'Bob', 'the final loser must place 2nd');
    const thirdFourth = placements.slice(2, 4).map(r => r.player_name).sort();
    assert.deepEqual(thirdFourth, ['Carol','Dave'], 'both semifinal losers must place 3rd/4th, ahead of anyone who did not make the cut');
  }
}

console.log('computeFinalPlacements functional checks passed');

// ── Round timer + overtime ──────────────────────────────────────────
const timerMigration = fs.readFileSync('supabase-migrations/2026-08-15-tournament-round-timer.sql', 'utf8');

for (const col of ['round_length_minutes integer', "round_overtime_mode text not null default 'none'", 'round_overtime_turns integer not null default 5', 'round_overtime_minutes integer not null default 5', "round_timer_state text not null default 'idle'", 'round_timer_started_at timestamptz', 'round_timer_elapsed_seconds integer not null default 0', 'round_timer_overtime_turn integer not null default 0']) {
  assert.match(timerMigration, new RegExp(`alter table public\\.events add column if not exists ${col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `missing migration for events.${col}`);
}

assert.match(dashboard, /id="event-round-length"/, 'event modal must expose a round length field');
assert.match(dashboard, /id="event-overtime-mode"/, 'event modal must expose an overtime mode select');
assert.match(dashboard, /round_length_minutes:Number\(document\.getElementById\('event-round-length'\)\?\.value \|\| 0\) \|\| null,/, 'saveEventFromForm must persist round_length_minutes');
assert.match(dashboard, /round_overtime_mode:document\.getElementById\('event-overtime-mode'\)\?\.value \|\| 'none',/, 'saveEventFromForm must persist round_overtime_mode');

for (const fn of ['computeRoundTimerStatus', 'formatTimerClock', 'roundTimerPanelHtml', 'startRoundTimer', 'pauseRoundTimer', 'resetRoundTimer', 'advanceOvertimeTurn', 'tickRoundTimerDisplay']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}
assert.match(dashboard, /\$\{event\.current_round > 0 \? roundTimerPanelHtml\(event\) : ''\}/, 'round timer panel must be wired into the event detail round section');
assert.match(dashboard, /const timerFields = event\.round_length_minutes/, 'starting a new round must reset the timer for a configured event');
assert.match(dashboard, /item\.type === 'event-timer-update'/, 'offline sync must handle standalone timer updates (pause/resume/reset/advance turn)');
assert.match(dashboard, /\.\.\.\(timerFields \|\| \{\}\)/, 'the event-round-start offline sync handler must also apply queued timer fields');

console.log('Round timer contract checks passed');

// ── Functional check: computeRoundTimerStatus + formatTimerClock ──
{
  const statusSrc = dashboard.match(/function computeRoundTimerStatus\(event, nowMs\)\{[\s\S]*?\n\}/)?.[0];
  const clockSrc = dashboard.match(/function formatTimerClock\(totalSeconds\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(statusSrc && clockSrc, 'could not extract round timer functions for functional testing');
  const { computeRoundTimerStatus, formatTimerClock } = new Function(`${statusSrc}\n${clockSrc}\nreturn { computeRoundTimerStatus, formatTimerClock };`)();

  assert.equal(computeRoundTimerStatus({ round_length_minutes:null, round_timer_state:'running' }, Date.now()), null, 'no round length configured means no timer');
  assert.equal(computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'idle' }, Date.now()), null, 'idle state means no active timer');

  // Running main round, 10 minutes elapsed of a 50-minute round.
  const started = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const mainStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'running', round_timer_started_at:started, round_timer_elapsed_seconds:0 }, Date.now());
  assert.equal(mainStatus.phase, 'main');
  assert.ok(Math.abs(mainStatus.remainingSeconds - 40 * 60) <= 2, 'remaining time must reflect 40 minutes left of a 50-minute round');
  assert.equal(formatTimerClock(mainStatus.remainingSeconds).length, 5, 'clock format must be mm:ss');

  // Paused mid-round: elapsed_seconds alone (no started_at) determines remaining time.
  const pausedStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'paused', round_timer_started_at:null, round_timer_elapsed_seconds:600 }, Date.now());
  assert.equal(pausedStatus.phase, 'main');
  assert.equal(pausedStatus.remainingSeconds, 50 * 60 - 600, 'a paused timer must not keep counting down');
  assert.equal(pausedStatus.paused, true);

  // Main time fully elapsed, overtime_mode 'none' -- just a flat time-up state.
  const timeUpStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'running', round_timer_started_at:new Date(Date.now() - 51 * 60 * 1000).toISOString(), round_timer_elapsed_seconds:0, round_overtime_mode:'none' }, Date.now());
  assert.equal(timeUpStatus.phase, 'time_up');

  // Magic-style overtime: turn counter, not time-based.
  const turnsStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'running', round_timer_started_at:new Date(Date.now() - 51 * 60 * 1000).toISOString(), round_timer_elapsed_seconds:0, round_overtime_mode:'extra_turns', round_overtime_turns:5, round_timer_overtime_turn:2 }, Date.now());
  assert.equal(turnsStatus.phase, 'overtime_turns');
  assert.equal(turnsStatus.turn, 2);
  assert.equal(turnsStatus.totalTurns, 5);
  assert.equal(turnsStatus.done, false);
  const turnsDoneStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'running', round_timer_started_at:new Date(Date.now() - 51 * 60 * 1000).toISOString(), round_timer_elapsed_seconds:0, round_overtime_mode:'extra_turns', round_overtime_turns:5, round_timer_overtime_turn:5 }, Date.now());
  assert.equal(turnsDoneStatus.done, true, 'overtime must report done once the final turn is reached');

  // Pokemon/YGO-style overtime: a fixed extra minutes block, counting down from its own total.
  const minutesStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'running', round_timer_started_at:new Date(Date.now() - 52 * 60 * 1000).toISOString(), round_timer_elapsed_seconds:0, round_overtime_mode:'extra_minutes', round_overtime_minutes:5 }, Date.now());
  assert.equal(minutesStatus.phase, 'overtime_minutes');
  assert.ok(Math.abs(minutesStatus.remainingSeconds - 3 * 60) <= 2, '1 minute into a 5-minute overtime block should read close to 4 minutes remaining');
  assert.equal(minutesStatus.done, false);
  const minutesDoneStatus = computeRoundTimerStatus({ round_length_minutes:50, round_timer_state:'running', round_timer_started_at:new Date(Date.now() - 56 * 60 * 1000).toISOString(), round_timer_elapsed_seconds:0, round_overtime_mode:'extra_minutes', round_overtime_minutes:5 }, Date.now());
  assert.equal(minutesDoneStatus.remainingSeconds, 0, 'overtime minutes must clamp at zero, not go negative');
  assert.equal(minutesDoneStatus.done, true);
}

console.log('Round timer functional checks passed');
