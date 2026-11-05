// Crull001 (2026-11-05): "Do the pokemon fix link" -- imported cards get
// their TCGplayer product, only on a sure match, a few credits each.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { linkCandidate, linkQuery, pickMatch, cardNum, runPokemonLinkSync } from '../scripts/pokemon-link-sync.mjs';

const raw = { category: 'Pokemon TCG', name: 'Charizard', set: 'Evolutions', card_number: '11', selectedLanguage: 'English', condition: 'NM' };
assert.equal(linkCandidate({ status: 'in_stock', data: raw }), true);
assert.equal(linkCandidate({ status: 'in_stock', data: { ...raw, isSlabbed: true, grader: 'PSA', grade: '8' } }), false, 'slabs price from the graded guide');
assert.equal(linkCandidate({ status: 'in_stock', data: { ...raw, tcgPlayerId: '1' } }), false, 'already linked');
assert.equal(linkCandidate({ status: 'in_stock', data: { ...raw, pptLinkCheckedAt: 'x' } }), false, 'never looked up twice');
assert.equal(linkCandidate({ status: 'in_stock', data: { ...raw, selectedLanguage: 'Chinese' } }), false);
assert.deepEqual(linkQuery(raw), { path: '/cards', params: { search: 'Charizard Evolutions 11', language: 'english', limit: '5' } });
assert.equal(linkQuery({ ...raw, set: 'Japanese VSTAR Universe', selectedLanguage: 'Japanese' }).params.language, 'japanese');
assert.equal(cardNum('011/108'), '11'); assert.equal(cardNum('SWSH213'), '213'); assert.equal(cardNum('GG05'), '5');

// Only a sure match: same name, same number, the set named the same.
const good = { tcgPlayerId: '123', name: 'Charizard', setName: 'Evolutions', cardNumber: '011/108', id: 'pp1' };
assert.equal(pickMatch(raw, [good, { tcgPlayerId: '9', name: 'Charizard', setName: 'Base Set', cardNumber: '4/102' }]).tcgPlayerId, '123');
assert.equal(pickMatch(raw, [{ ...good, cardNumber: '12/108' }]), null, 'wrong number');
assert.equal(pickMatch(raw, [{ ...good, name: 'Charizard EX' }]), null, 'wrong name');
assert.equal(pickMatch(raw, [{ ...good, setName: 'XY Promos' }]), null, 'wrong set');
assert.equal(pickMatch(raw, [good, { ...good, tcgPlayerId: '124' }]), null, 'two products: not sure');
const etb = { category: 'Pokemon TCG', name: 'Perfect Order Elite Trainer Box', set: 'Perfect Order', is_sealed: true };
assert.equal(pickMatch(etb, [{ tcgPlayerId: '55', name: 'Perfect Order Elite Trainer Box', setName: 'Perfect Order' }]).tcgPlayerId, '55');

// The run: links, marks the rest, stops when credits run out; never touches The Mana Pocket.
const rows = [
  { id: 'a', status: 'in_stock', data: { ...raw } },
  { id: 'b', status: 'in_stock', data: { ...raw, name: 'Nidoking', card_number: '11', set: 'Base Set', variant: '1st Edition' } },
  { id: 'c', status: 'in_stock', data: { ...raw, isSlabbed: true, grader: 'PSA', grade: '9' } },
];
const writes = {};
const deps = {
  db: async (path, opts) => { if (opts?.method === 'PATCH') { writes[path.match(/id=eq\.([^&]+)/)[1]] = JSON.parse(opts.body).data; return {}; } return { data: rows }; },
  pptList: async (path, p) => p.search.startsWith('Charizard') ? { ok: true, status: 200, cards: [good] } : p.search.startsWith('Nidoking') ? { ok: true, status: 200, cards: [{ tcgPlayerId: '77', name: 'Nidoking', setName: 'Base Set', cardNumber: '11/102' }] } : { ok: true, status: 200, cards: [] },
  isPlatform: id => id === 'home',
};
const out = await runPokemonLinkSync('his', deps);
assert.deepEqual(out, { linked: 2, noMatch: 0, failed: 0, left: 0 });
assert.equal(writes.a.tcgPlayerId, '123'); assert.equal(writes.a.externalRefs.tcgPlayerId, '123'); assert.equal(writes.a.pptLinkResult, 'linked');
assert.equal(writes.b.selectedPrinting, '1st Edition', 'a 1st Edition copy is priced as 1st Edition');
assert.equal(writes.c, undefined, 'the slab is left alone');
assert.deepEqual(await runPokemonLinkSync('home', deps), { skipped: 'The Mana Pocket is not linked by this job' });
const broke = await runPokemonLinkSync('his', { ...deps, pptList: async () => ({ ok: false, status: 403, cards: [] }) });
assert.equal(broke.failed, 1, 'out of credits: stops, tries next hour');

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /if \(!isPlatformStore\(storeId, env\)\) \{\n\s+try \{\n\s+const linked = await runPokemonLinkSync\(/);
assert.match(worker, /source: 'server-link'/);
console.log('Pokemon link sync: sure matches only, a few credits each, second stores only');
