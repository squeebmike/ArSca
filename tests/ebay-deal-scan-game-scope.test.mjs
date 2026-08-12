import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── eBay deal-scan cache must be scoped per game ────────────────────
// dealscan:{storeId}:latest used to be ONE cache slot per store shared by
// both the Pokemon and MTG Set Browsers -- whichever scan ran last (either
// panel's manual scan, or the scheduled cron scan, which mixed both games
// into a single combined run) overwrote it for both. Opening the MTG Set
// Browser could show a Pokemon scan's results labeled as if they were MTG's
// (or vice versa). The cache key must include the game.

assert.doesNotMatch(worker, /LBA_KV\.put\(`dealscan:\$\{storeId\}:latest`/, 'the deal-scan cache key must never be unscoped by game again');
assert.match(worker, /LBA_KV\.put\(`dealscan:\$\{storeId\}:\$\{game\}:latest`/, 'the manual /dealscan/check route must write to a game-scoped cache key');
assert.match(worker, /LBA_KV\.get\(`dealscan:\$\{storeId\}:\$\{game\}:latest`/, 'the /dealscan/latest route must read from a game-scoped cache key');
assert.match(worker, /const game = \['pokemon', 'mtg'\]\.includes\(String\(body\.game \|\| ''\)\.toLowerCase\(\)\) \? String\(body\.game\)\.toLowerCase\(\) : 'pokemon';/, 'the game must be validated against an allowlist, not trusted as free text');
assert.match(worker, /const game = \['pokemon', 'mtg'\]\.includes\(String\(url\.searchParams\.get\('game'\) \|\| ''\)\.toLowerCase\(\)\) \? String\(url\.searchParams\.get\('game'\)\)\.toLowerCase\(\) : 'pokemon';/, 'the game query param must be validated against an allowlist');

// The scheduled cron scan used to mix Pokemon + MTG inventory into one
// combined scan/cache write -- it must now run (and cache) each game
// separately so neither game's results can bleed into the other's panel.
assert.match(worker, /const gameFilters = \{ pokemon: \/pokemon\/i, mtg: \/magic\|\\bmtg\\b\/i \};/, 'the scheduled scan must define per-game category filters');
assert.match(worker, /for \(const \[game, categoryPattern\] of Object\.entries\(gameFilters\)\)/, 'the scheduled scan must loop per game, not run one mixed scan');
assert.doesNotMatch(worker, /\.filter\(i => \/pokemon\/i\.test\(i\.category\) \|\| \/magic\|\\bmtg\\b\/i\.test\(i\.category\)\)/, 'the scheduled scan must not go back to mixing both games into one filter');

console.log('Deal-scan worker game-scoping contract checks passed');

// ── Dashboard clients must each declare their own game ──────────────
assert.match(dashboard, /storeWorkerFetch\('\/dealscan\/latest\?game=pokemon'\)/, 'the Pokemon Set Browser must request the pokemon-scoped cache');
assert.match(dashboard, /storeWorkerFetch\('\/dealscan\/latest\?game=mtg'\)/, 'the MTG Set Browser must request the mtg-scoped cache');
assert.match(dashboard, /includeFresh, includeAuctions, scanScope:scope, game:'pokemon' \}\)/, 'the Pokemon manual scan must tag its request with game:pokemon');
assert.match(dashboard, /includeFresh, includeAuctions, scanScope:scope, game:'mtg' \}\)/, 'the MTG manual scan must tag its request with game:mtg');

console.log('Deal-scan dashboard game-scoping contract checks passed');
