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

// ── #3: sales recorded in the dashboard ──
{
  const dashboard = fs.readFileSync('dashboard.html', 'utf8');
  const fn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}', s) + 2); };
  const inserted = [], updated = [], posted = [];
  const sb = { from:table => ({
    insert:row => ({ select:() => ({ limit:async () => { const r = { ...row, id:table + '-' + (inserted.length + 1) }; inserted.push({ table, row:r }); return { data:[r], error:null }; } }) }),
    update:fields => ({ eq:(col, id) => { updated.push({ table, id, fields }); const p = Promise.resolve({ error:null }); return p; } }),
  }) };
  const env = {
    all:[{ id:'inv1', name:'Amazing Spider-Man #300', cost:100, category:'Comic' }, { id:'inv2', name:'AC Raw #1', cost:1 }, { id:'inv3', name:'AC Raw #1', cost:1 }],
    store:{},
  };
  const src = [
    'let whatnotActiveShow = null, whatnotShowItems = [], whatnotSession = { count:0, gross:0, profit:0 };',
    fn('wlsRecordedIds'), fn('wlsMarkRecorded'), fn('wlsNormalize'), fn('wlsMatchInventoryItem'),
    fn('wlsEnsureLiveShow', 'async function '), fn('recordWhatnotLiveSale', 'async function '), fn('whatnotPackListGroups'),
    dashboard.match(/const WLS_RECORDED_KEY = [^\n]+\n/)[0],
    'return { record:recordWhatnotLiveSale, groups:whatnotPackListGroups, state:() => ({ whatnotActiveShow, whatnotShowItems, whatnotSession }) };',
  ].join('\n');
  const localStorage = { getItem:k => env.store[k] ?? null, setItem:(k, v) => { env.store[k] = v; } };
  const api = new Function('all', 'getSupabaseClient', 'getActiveStoreId', 'storeWorkerFetch', 'whatnotFeeSettings', 'renderWhatnotSessionTally', 'renderWhatnotShowPanel', 'loadActiveWhatnotShow', 'upsertCustomer', 'inventoryItemIsSellable', 'inventoryListPrice', 'safeLocalJson', 'localStorage', src)(
    env.all, () => sb, () => 'store-1',
    async (path, init) => { posted.push({ path, body:JSON.parse(init.body) }); return { ok:true, status:200, json:async () => ({ ok:true, profit:12 }) }; },
    () => ({ pct:10, flat:0.3 }), () => {}, () => {}, async () => {}, async () => ({ id:'cust-1' }),
    i => i.status !== 'sold', i => Number(i.price || 50), (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch(e) { return d; } }, localStorage,
  );
  // blind-bag sale with no inventory match: show is started, buyer recorded
  assert.equal(await api.record({ id:'s1', type:'auction', buyer:'bigbob1', title:'AC Raw #34', price:'8', at:'2026-10-01T18:00:00Z' }), true);
  assert.equal(inserted[0].table, 'whatnot_shows', 'a live show is started when none is live');
  const row1 = inserted[1].row;
  assert.equal(row1.buyer_name, 'bigbob1');
  assert.equal(row1.sold_price_cents, 800);
  assert.equal(row1.status, 'sold');
  assert.equal(row1.inventory_item_id, null);
  assert.equal(posted.length, 0, 'no inventory sale without an exact title match');
  // exact title match marks the inventory item sold, idempotently
  await api.record({ id:'s2', type:'auction', buyer:'prince27', title:'amazing spider-man #300', price:'125' });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].path, '/inventory/record-external-sale');
  assert.equal(posted[0].body.itemId, 'inv1');
  assert.equal(posted[0].body.externalRef, 'whatnot-live:s2');
  assert.equal(posted[0].body.feeAmount, 12.8);
  // ambiguous title (two items named the same) never guesses
  await api.record({ id:'s3', type:'auction', buyer:'x_y', title:'AC Raw #1', price:'5' });
  assert.equal(posted.length, 1);
  // a giveaway
  await api.record({ id:'s4', type:'giveaway', buyer:'themanapocket', title:'Giveaway', price:'' });
  assert.equal(inserted.at(-1).row.status, 'giveaway');
  // the same sale twice records once
  const before = inserted.length;
  assert.equal(await api.record({ id:'s1', type:'auction', buyer:'bigbob1', title:'AC Raw #34', price:'8' }), true);
  assert.equal(inserted.length, before, 'a sale already recorded is acknowledged without a second row');
  // pack list groups by buyer
  const groups = api.groups([{ name:'A', status:'sold', sold_price_cents:800, buyer_name:'bigbob1' }, { name:'B', status:'sold', sold_price_cents:200, buyer_name:'BigBob1' }, { name:'G', status:'giveaway', sold_price_cents:0, buyer_name:'zed' }, { name:'C', status:'sold', sold_price_cents:100, buyer_name:'' }]);
  assert.deepEqual(groups.map(g => [g.buyer, g.items.length, g.totalCents]), [['(no buyer name)', 1, 100], ['bigbob1', 2, 1000], ['zed', 1, 0]]);
  assert.match(dashboard, /onclick="openWhatnotPackList\(\)">PACK LIST<\/button>/);
  const relay = fs.readFileSync('extensions/whatnot-live-stickers/dashboard-relay.js', 'utf8');
  assert.match(relay, /location\.origin/, 'messages stay on the dashboard origin');
  assert.match(dashboard, /e\.source !== window \|\| !e\.data \|\| e\.data\.source !== 'wls-extension'/, 'the page only takes sales from the extension relay');
}
console.log('Whatnot live sales -> dashboard checks passed');
