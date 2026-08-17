import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the worker's /identify/card prompt covers all four games ──
assert.match(worker, /"game":"pokemon"\|"mtg"\|"sports"\|"one_piece"/, 'the identify JSON schema must advertise all four supported games');
assert.match(worker, /sports cards \(baseball\/basketball\/football\/hockey\/soccer\/etc\), and One Piece TCG are all in scope/, 'the prompt must state sports and One Piece are in scope, not just Pokemon/MTG');
assert.match(worker, /For sports: name is the PLAYER\\'s name printed on the card/, 'the prompt must give sports-specific field guidance');
assert.match(worker, /For one_piece: name is the card\\'s own title/, 'the prompt must give One Piece-specific field guidance');
assert.match(worker, /or anything else outside these four/, 'the prompt must still exclude non-card items (comics, sealed product, video games)');

// ── Contract: the worker filters/maps the extra games through, including the new year field ──
assert.match(worker, /\['pokemon', 'mtg', 'sports', 'one_piece'\]\.includes\(c\.game\)/, 'the response filter must accept all four games');
assert.match(worker, /year: String\(c\.year \|\| ''\)\.trim\(\)\.slice\(0, 4\)/, 'a year field must be threaded through for sports cards');

console.log('Own AI (worker) contract checks passed');

// ── Contract: the dashboard scanner routes sports/one_piece through own AI, not just pokemon/mtg ──
assert.match(dashboard, /useOwnScanner && \['pokemon', 'mtg', 'sports', 'one_piece'\]\.includes\(categoryHint\)/, 'doCardSightScan must send sports/one_piece scans through own AI too when the setting allows it');
assert.match(dashboard, /if\(card\.game === 'sports'\) return \[card\.year, card\.setName, card\.name, card\.number \? '#' \+ card\.number : ''\]/, 'ownCardIdentifyQuery must build a year+set+player+number query for sports cards');
assert.match(dashboard, /: card\.game === 'sports' \? 'Sports Card'\s*\n\s*: 'One Piece';/, 'resolveOwnCardIdentifyCard must map sports/one_piece to real catalog category strings');
assert.match(dashboard, /CARD SCANNER \(ALL GAMES, INCLUDING GRADED\)/, 'the Research settings label must reflect every game the scanner covers');

console.log('Own AI (dashboard) contract checks passed');

// ── Functional: category strings resolve to the same category key both
// category-key implementations (dashboard's qplCategoryKey and the
// query-routing module's categoryKey) agree on -- this is what makes
// searchQuickCatalog actually route sports/one_piece scans to real pricing
// instead of silently returning nothing.
function qplCategoryKey(category){
  const c = String(category || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if(!c || c === 'any category' || c === 'any') return '';
  if(c.includes('magic') || /\bmtg\b/.test(c)) return 'mtg';
  if(c.includes('pokemon') || c.includes('poke')) return 'pokemon';
  if(c.includes('one piece')) return 'one_piece';
  if(c.includes('sport') || c.includes('baseball') || c.includes('football') || c.includes('basketball')) return 'sports';
  return c.replace(/[^a-z0-9]+/g, '_');
}
const CATEGORY_ALIASES = {
  'pokemon tcg':'pokemon', pokemon:'pokemon', tcg:'tcg',
  'magic: the gathering':'mtg', magic:'mtg', mtg:'mtg',
  'sports card':'sports', 'sports cards':'sports', sports:'sports', graded:'graded',
  comic:'comic', comics:'comic', sealed:'sealed', 'sealed product':'sealed',
  'video games':'video_games', games:'video_games', funko:'funko', lego:'lego', coins:'coins'
};
function queryRoutingCategoryKey(value = ''){
  return CATEGORY_ALIASES[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}

assert.equal(qplCategoryKey('Sports Card'), 'sports');
assert.equal(queryRoutingCategoryKey('Sports Card'), 'sports');
assert.equal(qplCategoryKey('One Piece'), 'one_piece');
assert.equal(queryRoutingCategoryKey('One Piece'), 'one_piece');
// The tempting "One Piece TCG" string is a trap: query-routing's alias table
// has no entry for it, so its fallback slugifies to 'one_piece_tcg' -- one
// extra word away from the 'one_piece' key searchQuickCatalog actually
// checks. Pin this mismatch so nobody "simplifies" resolveOwnCardIdentifyCard
// back to the TCG-suffixed string.
assert.equal(qplCategoryKey('One Piece TCG'), 'one_piece');
assert.notEqual(queryRoutingCategoryKey('One Piece TCG'), 'one_piece');

console.log('Own AI category-key parity functional checks passed');

// ── Functional: ownCardIdentifyQuery builds the right query shape per game ──
const queryFnSrc = dashboard.match(/function ownCardIdentifyQuery\(card\)\{[\s\S]*?\n\}/)[0];
const ownCardIdentifyQuery = new Function('card', queryFnSrc.replace(/^function ownCardIdentifyQuery\(card\)\{/, '').replace(/\}$/, ''));

assert.equal(
  ownCardIdentifyQuery({ game:'sports', year:'2023', setName:'Topps Chrome', name:'Anthony Edwards', number:'150' }),
  '2023 Topps Chrome Anthony Edwards #150',
  'a sports card must query as year + set + player + number'
);
assert.equal(
  ownCardIdentifyQuery({ game:'one_piece', name:'Monkey D. Luffy', setName:'OP-01 Romance Dawn', number:'123' }),
  'Monkey D. Luffy OP-01 Romance Dawn #123',
  'a One Piece card must query the same name+set+number shape as Pokemon/MTG'
);
assert.equal(
  ownCardIdentifyQuery({ game:'pokemon', name:'Lucario V', setName:'Astral Radiance', number:'4/102' }),
  'Lucario V Astral Radiance #4/102',
  'existing Pokemon query shape must be unchanged'
);

console.log('Own AI query-builder functional checks passed');

// ── Functional: the worker's response filter/mapper accepts sports+one_piece
// and caps year at 4 chars, exactly mirroring the source logic.
function mapIdentifiedCards(cards){
  return (Array.isArray(cards) ? cards : [])
    .filter(c => c && ['pokemon', 'mtg', 'sports', 'one_piece'].includes(c.game) && String(c.name || '').trim())
    .slice(0, 12)
    .map(c => ({
      game: c.game,
      name: String(c.name || '').trim().slice(0, 120),
      setName: String(c.setName || '').trim().slice(0, 120),
      number: String(c.number || '').trim().slice(0, 20),
      year: String(c.year || '').trim().slice(0, 4),
      finish: String(c.finish || '').trim().slice(0, 20),
    }));
}
const mapped = mapIdentifiedCards([
  { game:'sports', name:'Anthony Edwards', setName:'Topps Chrome', number:'150', year:'2023-fake-extra' },
  { game:'comic', name:'Amazing Spider-Man' },
  { game:'one_piece', name:'Monkey D. Luffy', setName:'OP-01 Romance Dawn', number:'123', rarity:'L' },
]);
assert.equal(mapped.length, 2, 'comic (out of scope) must be filtered out, sports and one_piece must pass through');
assert.equal(mapped[0].year, '2023', 'year must be capped at 4 characters');
assert.equal(mapped[1].game, 'one_piece');

console.log('Own AI response-mapping functional checks passed');
