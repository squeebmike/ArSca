import assert from 'node:assert/strict';
import { text } from '../scripts/foc-preorders.mjs';

// Matched live: 175 PRH descriptions showed "Godzillaâs" -- UTF-8 bytes read
// as Latin-1, left garbled because the whole-string repair gives up when any
// other character in the text (here a genuine em dash) can't be a mis-read byte.
assert.equal(text('Godzillaâ\u0080\u0099s first rampage — Tokyo'), 'Godzilla’s first rampage — Tokyo');
assert.equal(text('BLACKBEARD: â\u0080\u0098NUFF SAID'), 'BLACKBEARD: ‘NUFF SAID');
// Whole-string single and double mis-encodings still repair.
assert.equal(text('FÃ¡bio Moon'), 'Fábio Moon');
assert.equal(text('FallbacksÃ¢â\u0082¬â\u0084¢ adventure'), 'Fallbacks’ adventure');
// Real accented text is never touched -- including an accent before a
// non-breaking space, which looks like a byte pair but isn't valid UTF-8.
assert.equal(text('pâte à la mode — Pokémon'), 'pâte à la mode — Pokémon');
assert.equal(text('Hiromasa Taté have a few'), 'Hiromasa Taté have a few');
console.log('FOC mojibake repair checks passed');
