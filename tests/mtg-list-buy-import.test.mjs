// A pasted Magic list into the Buy tab (store, 2026-11-14: "can the buy importer do this format? For MTG ... I'd like
// to copy and paste it in the buy import section").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const m = await import('../scripts/pricecharting-buy-import.mjs');
const list = `1 Whims of the Fates [BNG] 115
1 Corpses of the Lost (Extended Art) [LCI] 366
2 Agonizing Remorse (JP Alternate Art) (Foil Etched) [STA] 87
1 Prosper, Tome-Bound (Display Commander) - Thick Stock [AFC] 2
1 Sewer Nemesis [LIST] 075/312
1 Xathrid Necromancer [MEDIA] A12
1 Archmage Emeritus (STX Bundle) [UMP] 377
4 Uchuulon [CLB] 673
1x Sol Ring (C21) 263 *F*
1 Brainstorm (Foil) [ICE] 61
Lightning Bolt

// Sideboard
1 Counterspell [7ED] 67`;
const { items, skipped } = m.parseMtgList(list);
assert.equal(skipped.length, 0);
assert.equal(items.length, 12);
assert.deepEqual(items[0], { quantity: 1, name: 'Whims of the Fates', extras: [], set: 'BNG', number: '115', finish: '' });
assert.deepEqual([items[1].name, items[1].extras, items[1].set, items[1].number], ['Corpses of the Lost', ['Extended Art'], 'LCI', '366']);
assert.deepEqual([items[2].quantity, items[2].name, items[2].extras, items[2].finish], [2, 'Agonizing Remorse', ['JP Alternate Art'], 'etched'], 'Foil Etched is the finish, not part of the name');
assert.equal(m.mtgDisplayName(items[2]), 'Agonizing Remorse (JP Alternate Art) (Foil Etched)');
assert.deepEqual([items[3].name, items[3].extras.sort()], ['Prosper, Tome-Bound', ['Display Commander', 'Thick Stock']]);
assert.deepEqual([items[4].set, items[4].number], ['LIST', '075/312']);
assert.deepEqual(m.mtgIdentifier(items[4]), { name: 'Sewer Nemesis' }, 'The List goes by name');
assert.deepEqual(m.mtgIdentifier(items[5]), { name: 'Xathrid Necromancer' }, 'media promos go by name');
assert.deepEqual(m.mtgIdentifier(items[0]), { set: 'bng', collector_number: '115' });
assert.deepEqual(m.mtgIdentifier(items[3]), { set: 'afc', collector_number: '2' });
assert.equal(items[7].quantity, 4);
assert.deepEqual([items[8].quantity, items[8].name, items[8].set, items[8].number, items[8].finish], [1, 'Sol Ring', 'C21', '263', 'foil'], 'Moxfield style');
assert.equal(items[9].finish, 'foil');
assert.deepEqual([items[10].name, items[10].quantity, items[10].set], ['Lightning Bolt', 1, ''], 'just a name');
assert.deepEqual(m.mtgIdentifier(items[10]), { name: 'Lightning Bolt' });
assert.equal(items[11].name, 'Counterspell', 'section headers are skipped, not cards');
// Prices: the finish asked for, falling back sensibly.
const card = { prices: { usd: '0.50', usd_foil: '2.00', usd_etched: '3.25' } };
assert.equal(m.mtgPriceOf(card, ''), 0.5); assert.equal(m.mtgPriceOf(card, 'foil'), 2); assert.equal(m.mtgPriceOf(card, 'etched'), 3.25);
assert.equal(m.mtgPriceOf({ prices: { usd_foil: '4' } }, ''), 4, 'foil-only printing'); assert.equal(m.mtgPriceOf({ prices: {} }, ''), 0);
// The Buy tab: a PASTE MTG LIST button, Scryfall 75 at a time, unpriced lines NEEDS REVIEW; a .txt list through IMPORT works too.
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8'), app = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.ok(html.includes('onclick="openMtgPasteToBuyList()"'));
assert.ok(app.includes("fetch('https://api.scryfall.com/cards/collection', { method:'POST'") && app.includes('identifiers:ids.slice(i, i + 75)'));
assert.ok(app.includes('needsReview:!priced') && app.includes("addImportedRowsToBuyList(rows, 'pasted Magic list', skipped.length);"));
assert.ok(app.includes('if(!format && mod.parseMtgList(fileText).items.length)'));
console.log('Pasted Magic list into the Buy tab: passed');
