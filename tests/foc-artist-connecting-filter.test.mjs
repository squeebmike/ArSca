// FOC FILTERS (store, 2026-11-16): "Connecting covers" in the comics filter, and an artist picker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const grab = sig => { const i = foc.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = foc.indexOf('){', i) + 1; for (; j < foc.length; j++) { if (foc[j] === '{') d++; else if (foc[j] === '}' && !--d) break; } return foc.slice(i, j + 1); };
const src = ['focVariantIsConnecting', 'focArtistNames', 'focArtistCounts', 'focFamilyHasArtist', 'visibleFamilies'].map(n => grab('function ' + n + '(')).join('\n');
const families = [
  { title: 'Ultimate Spider-Man #12', publisher: 'Marvel', interiorArtist: 'David Messina', variants: [{ id: 'a', variantLabel: 'Cover A', coverArtist: 'Marco Checchetto' }, { id: 'b', variantLabel: 'Cover B Connecting Variant', coverArtist: 'Peach Momoko' }] },
  { title: 'Absolute Batman #8', publisher: 'DC', interiorArtist: 'Nick Dragotta', variants: [{ id: 'c', variantLabel: 'Cover A', coverArtist: 'Nick Dragotta' }, { id: 'd', variantLabel: 'Cover C', coverArtist: 'Peach Momoko & Jim Lee' }] },
  { title: 'Saga #70', publisher: 'Image', interiorArtist: 'Fiona Staples', variants: [{ id: 'e', variantLabel: 'Cover A', coverArtist: 'Fiona Staples' }] },
];
const state = { families, query: '', publisher: 'all', flag: 'all', ebay: 'all', artist: 'all' };
const lib = new Function('state', 'focIntel', 'focFamilyIntel', 'focConnectFor', src + '\nreturn { visibleFamilies, focArtistCounts, focArtistNames };')(state, { loaded: false }, () => null, id => id === 'e' ? { set: {} } : null);
assert.deepEqual(lib.focArtistNames('Peach Momoko & Jim Lee'), ['Peach Momoko', 'Jim Lee']);
const counts = lib.focArtistCounts(families);
assert.deepEqual(counts.slice(0, 3).map(a => [a.name, a.count]), [['Fiona Staples', 2], ['Nick Dragotta', 2], ['Peach Momoko', 2]], 'every artist, most covers first');
state.flag = 'connecting'; assert.deepEqual(lib.visibleFamilies().map(f => f.title), ['Ultimate Spider-Man #12', 'Saga #70'], 'by name, or in a saved / suggested connecting set');
state.flag = 'all'; state.artist = 'peach momoko'; assert.deepEqual(lib.visibleFamilies().map(f => f.title), ['Ultimate Spider-Man #12', 'Absolute Batman #8'], 'cover artist');
state.artist = 'fiona staples'; assert.deepEqual(lib.visibleFamilies().map(f => f.title), ['Saga #70'], 'interior artist');
assert.ok(foc.includes('<option value="connecting" ') && foc.includes('onchange="filterFocArtist(this.value)"') && foc.includes('window.filterFocArtist=function(v){state.artist=v;renderFamilies();};'));
console.log('FOC connecting / artist filters: passed');
