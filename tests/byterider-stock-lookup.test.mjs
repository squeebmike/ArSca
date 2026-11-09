import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inventoryStats, wantsStats, cardNumbersIn, askByteRider, matchItems } from '../scripts/byterider-ask.mjs';
import { sportsByCode, pokemonBySlash } from '../scripts/byterider-lookup.mjs';
// Store, 2026-11-09: "how many cards are in stock, how many Julio Rodriguez,
// the cheapest, the most expensive, any blank covers, connecting covers,
// foils ... 143/142 pulls up the Bulbasaur ... BLA-JR pulls up this card ...
// mic support so I don't have to type".
const items = [
  { id: '1', name: 'Julio Rodríguez #BLA-JR Big League Autograph', category: 'Sports Cards', price: 120, quantity: 1, url: '/item/1' },
  { id: '2', name: 'Julio Rodriguez 2023 Topps #1', category: 'Sports Cards', price: 4, quantity: 3, url: '/item/2' },
  { id: '3', name: 'Absolute Batman #25 Cvr H Left Connecting Card Stock', category: 'Comics', price: 8, quantity: 1, url: '/item/3' },
  { id: '4', name: 'Saga #1 Blank Sketch Cover', category: 'Comics', price: 6, quantity: 2, url: '/item/4' },
  { id: '5', name: 'Charizard ex 199/165', category: 'Pokemon TCG', price: 397, quantity: 1, finish: 'Foil', url: '/item/5' },
];
const s = inventoryStats(items, 'How many Julio Rodriguez do you have?');
assert.deepEqual([s.listings, s.copies, s.cheapest.name, s.priciest.price], [2, 4, 'Julio Rodriguez 2023 Topps #1', 120], 'accents fold; copies counted');
assert.equal(inventoryStats(items, 'how many cards are in stock').listings, 5);
assert.equal(inventoryStats(items, 'any blank covers?').listings, 1);
assert.equal(inventoryStats(items, 'do you have connecting covers').listings, 1);
assert.equal(inventoryStats(items, 'any foils?').listings, 1);
assert.equal(inventoryStats(items, 'how many Ohtani').listings, 0);
assert.ok(wantsStats('what is the cheapest comic') && wantsStats('most expensive card?') && !wantsStats('when is your next show'));
assert.deepEqual(matchItems(items, 'cheapest julio rodriguez').map(i => i.price), [4, 120], 'cheapest first');

// Card numbers.
assert.deepEqual(cardNumbersIn('BLA-JR and 143/142, X-Force #4, Spider-Man'), { codes: ['BLA-JR'], slashes: [{ number: '143', total: '142' }] });
const bla = sportsByCode(['BLA-JR'], 'julio bla-jr');
assert.equal(bla[0].name, 'Julio Rodríguez');
assert.equal(bla[0].url, '/baseball/checklists/2024-topps-big-league-baseball/cards/2024-topps-big-league-baseball-big-league-autographs-bla-jr');
assert.equal(sportsByCode(['BLA-JR'], 'jose ramirez bla-jr')[0].name, 'Jose Ramirez', 'the player named wins');
const sets = [{ id: 'sv7', name: 'SV07: Stellar Crown', cardCount: 180 }, { id: 'x', name: 'Huge', cardCount: 400 }, { id: 'y', name: 'Other 142', cardCount: 150 }];
const read = [];
const poke = await pokemonBySlash([{ number: '143', total: '142' }], '143/142', { sets, cardsFor: async set => (read.push(set.id), set.id === 'sv7' ? [{ name: 'Bulbasaur', cardNumber: '143/142', rarity: 'Illustration Rare', prices: { market: 88.32 }, tcgPlayerId: '1' }] : []), cardPath: (set, c) => '/pokemon/cards/' + set.id + '/' + c.tcgPlayerId });
assert.deepEqual(poke, [{ number: '143/142', name: 'Bulbasaur', set: 'SV07: Stellar Crown', section: 'Illustration Rare', price: 88.32, url: '/pokemon/cards/sv7/1' }]);
assert.ok(!read.includes('x'), 'only sets about that size are read');

// ByteRider gets both, and links the checklist page first.
let prompt = '';
const out = await askByteRider({ question: 'how many BLA-JR do you have?' }, { items: async () => items, allItems: async () => items, facts: async () => 'facts', lookup: async nums => sportsByCode(nums.codes, ''), claude: async sys => (prompt = sys, { text: 'ok' }) });
assert.match(prompt, /STOCK COUNT/);
assert.match(prompt, /- 1 listing, 1 copy in stock/);
assert.match(prompt, /CHECKLIST CARDS[\s\S]*BLA-JR: Julio Rodríguez -- 2024 Topps Big League Baseball/);
assert.match(out.items[0].url, /^\/baseball\/checklists\/2024-topps-big-league-baseball\//);

// Worker wiring and the mic.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /lookup: async \(nums, q\) => \[\n\s*\.\.\.sportsByCode\(nums\.codes, q\),/);
assert.match(w, /cardsFor: async set => \(await loadPokemonSetCards\(env, set, Date\.now\(\), \{ refresh: false, cacheOnly: true \}\)\)\.data/);
assert.match(fs.readFileSync('scripts/public-pokemon-sets.mjs', 'utf8'), /if \(!hit && cacheOnly\) return \{ data: \[\], cache: 'none', complete:false \};/);
const site = fs.readFileSync('scripts/byterider-site.mjs', 'utf8');
assert.match(site, /const Speech = typeof window !== 'undefined' && \(window\.SpeechRecognition \|\| window\.webkitSpeechRecognition\);/);
assert.match(site, /form\.append\(mic, input, send\);/);
assert.match(site, /if \(voice\) speak\(r\.text\);/);
console.log('ByteRider stock counts, card-number checklist lookup and mic passed');
