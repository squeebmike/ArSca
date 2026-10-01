import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Store ask: "I don't want to type anything ... take the order live when it
// happens, then print the sticker with the name and item." Lines below are
// what the store's own Whatnot screenshots show, top to bottom.

const ctx = {};
vm.runInNewContext(fs.readFileSync('extensions/whatnot-live-stickers/detector.js', 'utf8'), ctx);
const { parseSales, createTracker } = ctx.WLS;
const chat = ['thecannedbowl', "I'm feeling it this one will have one", 'ac_comics', 'Host', 'My favorite cover!! The B&W X cover!', 'Say something...'];

// ── auction result card ──
{
  const r = parseSales(['ac_comics', '5.0', 'Giveaway', '61', 'Entries', ...chat, 'bigbob1 won!', 'AC Raw #34', 'Near Mint', '$8', 'Sold', 'Awaiting Next Item']);
  assert.deepEqual({ ...r.auction }, { type:'auction', buyer:'bigbob1', title:'AC Raw #34', subtitle:'Near Mint', price:'8' });
  assert.equal(r.giveaway, null);
}
// ── the "Won the auction!" banner shows a truncated name; the card has the full one ──
{
  const r = parseSales(['notyouraverageprin...', 'Won the auction!', ...chat, 'notyouraverageprince27 won!', 'AC Raw #35', 'Near Mint', '$4.47 Shipping + Taxes', '$10', 'Sold']);
  assert.equal(r.auction.buyer, 'notyouraverageprince27');
  assert.equal(r.auction.price, '10', 'the shipping line is never the price');
  assert.equal(r.auction.title, 'AC Raw #35');
}
// ── name and "won!" rendered on separate lines ──
assert.equal(parseSales(['bigbob1', 'won!', 'AC Raw #34', '$8', 'Sold']).auction.buyer, 'bigbob1');
// ── giveaway ──
{
  const r = parseSales(['Giveaway Winner', 'themanapocket won the giveaway!', ...chat, 'notyouraverageprince27 won!', 'AC Raw #35', 'Near Mint', '$10', 'Sold']);
  assert.equal(r.giveaway.buyer, 'themanapocket');
  assert.equal(r.auction.buyer, 'notyouraverageprince27', 'a giveaway and the last auction are both seen');
}
// ── chat never prints a sticker ──
{
  const r = parseSales(['cincinnatus_comics', 'I won!', 'ohana_cali_comics', 'bigbob1 won!', 'circlecitycomics', 'lol $5 is cheap']);
  assert.equal(r.auction, null, '"I won!" and a "won!" with no price card are chat, not a sale');
}
// ── Buy It Now wording ──
{
  const r = parseSales(['collector_jim bought Amazing Spider-Man #300 for $125']);
  assert.deepEqual({ ...r.bin }, { type:'bin', buyer:'collector_jim', title:'Amazing Spider-Man #300', subtitle:'', price:'125' });
  assert.equal(parseSales(['I just bought it']).bin, null);
}
// ── one sticker per sale ──
{
  const track = createTracker();
  const card = (who, item, price) => parseSales([who + ' won!', item, '$' + price, 'Sold']);
  const none = parseSales(['Awaiting Next Item']);
  assert.equal(track(card('old_buyer', 'AC Raw #33', 5)).length, 0, 'a result already on screen when the page loads is not reprinted');
  assert.equal(track(card('bigbob1', 'AC Raw #34', 8)).length, 1);
  assert.equal(track(card('bigbob1', 'AC Raw #34', 8)).length, 0, 'the result staying on screen prints once');
  assert.equal(track(none).length, 0);
  assert.equal(track(card('bigbob1', 'AC Raw #34', 8)).length, 1, 'same buyer, same title, next item = another sticker');
  const both = track(parseSales(['themanapocket won the giveaway!', 'prince27 won!', 'AC Raw #35', '$10', 'Sold']));
  assert.deepEqual([...both.map(s => s.type)].sort(), ['auction', 'giveaway']);
}

// ── extension files + dashboard download ──
{
  const dir = 'extensions/whatnot-live-stickers/';
  const manifest = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.whatnot.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['detector.js', 'content.js']);
  assert.match(fs.readFileSync(dir + 'label.js', 'utf8'), /'2x1':'2in 1in'/);
  assert.match(fs.readFileSync(dir + 'background.js', 'utf8'), /size:'2x1'/, '2x1 is the default label');

  const dashboard = fs.readFileSync('dashboard.html', 'utf8');
  const list = JSON.parse(dashboard.match(/const WHATNOT_STICKER_EXTENSION_FILES = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual([...list].sort(), fs.readdirSync(dir).sort(), 'the download packs every extension file');
  assert.match(dashboard, /onclick="downloadWhatnotStickerExtension\(\)"/);
  assert.ok(fs.existsSync('.nojekyll'), 'GitHub Pages serves the extension files raw');

  const fn = name => { const s = dashboard.indexOf('function ' + name + '('); return dashboard.slice(s, dashboard.indexOf('\n}', s) + 2); };
  const { zipCrc32, buildStoredZip } = new Function(fn('zipCrc32') + '\n' + fn('buildStoredZip') + '\nreturn { zipCrc32, buildStoredZip };')();
  assert.equal(zipCrc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const zip = new Uint8Array(await buildStoredZip([{ name:'a/x.txt', data:new TextEncoder().encode('hello') }, { name:'a/y.txt', data:new TextEncoder().encode('world!') }]).arrayBuffer());
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2);
  fs.writeFileSync(process.env.WLS_ZIP_OUT || '/dev/null', zip);
}
console.log('Whatnot live stickers checks passed');
