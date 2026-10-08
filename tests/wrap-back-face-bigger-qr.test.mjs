import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report, after #350 stopped the QR clipping: it still looked small,
// and "THE MANA POCKET" was wrapping to two lines ("THE MANA" / "POCKET")
// instead of one on a real print. Both waste room the QR could otherwise
// use: a square code inside an evenly-split 50/50 face is capped by
// whichever dimension is tighter (here, width), and a two-line shop name
// eats an extra line of height flex:1 could otherwise hand to the code.

assert.match(html, /\.label\.wrap \.wrap-front \{ width:44%;/, 'the front face must give up some width to the back face, not stay at an even 50/50 split');
assert.match(html, /\.label\.wrap \.wrap-back \{ width:56%;/, 'the back face must get more than half the label\'s width so the QR has real room to grow into');

assert.match(html, /\.wrap-shopname \{ font-size:8px; font-weight:700; letter-spacing:\.01em; text-align:center; white-space:nowrap; \}/,
  'the shop name must be sized/spaced to fit on one line and forced there with white-space:nowrap, not left to wrap to two');

// Neither CSS rule may live inside the wrapStyle template literal as a "//"
// comment -- CSS has no line-comment syntax, and an invalid line here isn't
// just cosmetic: a real risk demonstrated earlier this session is that it
// can desync the CSS parser for everything after it in the same <style>
// block. Explanatory comments for this section belong before `const
// wrapStyle = \`` as ordinary JS comments instead.
{
  const styleStart = html.indexOf('const wrapStyle = `');
  const styleEnd = html.indexOf('`;', styleStart);
  const styleBody = html.slice(styleStart, styleEnd);
  assert.doesNotMatch(styleBody, /\/\//, 'the wrapStyle CSS template literal must not contain a "//" line -- that is not a valid CSS comment and can silently break every rule after it');
}

console.log('Wrap back face wider / one-line shop name contract checks passed');
