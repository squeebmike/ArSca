import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report, after #349 fixed the QR not rendering at all: "so much
// better, qr cuts off a little and needs to take up more space." A
// hardcoded height guess (62px roll / 70px sheet) for the wrap back face's
// QR was actually TALLER than the real remaining room once the shop name
// line, the gap between it and the code, and the face's own padding were
// accounted for -- .wrap-back clips overflow, so the last couple rows of
// modules were silently sliced off on a real print. Fix: let the image
// flex to fill whatever space actually remains (computed by layout, not
// guessed), and reclaim padding/gap that wasn't earning its keep.

assert.match(html, /const imgStyle = isWrap \? 'width:100%;flex:1;min-height:0;object-fit:contain' : `width:100%;height:\$\{imgHeight\}px;object-fit:contain`;/,
  'the wrap back face code image must flex to fill remaining space instead of using a fixed height guess that can overflow');
assert.match(html, /barcodeImg = `<img src="\$\{canvas\.toDataURL\('image\/png'\)\}" style="\$\{imgStyle\}">`;/,
  'the generated code image must actually use the computed imgStyle');

// The standard (non-wrap) layout is unaffected -- it keeps a fixed
// on-label height, since it isn't laid out in the same clipped flex column.
assert.match(html, /const imgHeight = isRoll \? 30 : 36;/, 'the standard layout\'s fixed code height must be preserved unchanged');
assert.doesNotMatch(html, /isWrap \? \(isRoll \? 62 : 70\)/, 'the old oversized wrap height guess must be fully removed, not left dangling as dead code');

// Padding/gap tightened so flex actually has more real room to hand the
// image, not just avoiding overflow at the old cramped size.
assert.match(html, /\.label\.wrap \.wrap-back \{ width:56%; padding:6px 4px 4px; justify-content:flex-start; gap:4px; \}/,
  'wrap-back padding/gap must be tightened to free up real room for the QR, not just barely avoid clipping at the old size, and must get more than half the label\'s width');

console.log('Wrap QR fills back face contract checks passed');
