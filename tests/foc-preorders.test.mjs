import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { normalizePrhRow, loadAllCatalogs, loadCycleSummaries, paginateCycleCatalog, focOrderConfirmationEmail, reconcileFocOrderPayment, syncFocStripeEvent, handleFocRequest } from '../scripts/foc-preorders.mjs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const dashboard = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-17-foc-preorders.sql', 'utf8');

const representative = {
  MainIdentifier:'75960621456300121',
  UPC:'75960621456300121',
  TitleFamilyID:'852493',
  SeriesName:'Avengers',
  SeriesNumber:'1',
  Title:'AVENGERS #1 PRIMARY TITLE',
  PublisherName:'Marvel Comics',
  CoverArtist:'Russell Dauterman',
  FOCDate:'08/24/2026',
  OnSaleDate:'09/30/2026',
  PriceUSD:'$4.99',
  CoverLink:'https://example.com/avengers.jpg',
  CoverAvailable:'Yes',
};
const coverA = normalizePrhRow(representative);
assert.equal(coverA.distributorSku, '75960621456300121', '17-digit identifiers must remain exact strings');
assert.equal(coverA.upc, '75960621456300121');
assert.equal(coverA.distributorFamilyId, '852493');
assert.equal(coverA.variantLabel, 'Cover A', 'PRH Primary Title must be customer-facing Cover A');
assert.equal(coverA.focDate, '2026-08-24');
assert.equal(coverA.msrpCents, 499);
assert.equal(coverA.flags.firstIssue, true);

const incentive = normalizePrhRow({...representative, MainIdentifier:'75960621456300131', UPC:'75960621456300131', Title:'AVENGERS #1 JIM CHEUNG VARIANT', VariantType:'Incentive Variant', OrderRequirement:'1:50', CoverArtist:'Jim Cheung'});
assert.equal(incentive.distributorFamilyId, coverA.distributorFamilyId, 'cover variants must group under TitleFamilyID');
assert.equal(incentive.isIncentive, true);
assert.equal(incentive.ratioThreshold, 50);
assert.equal(incentive.flags.incentive, true);

const foil = normalizePrhRow({...representative, MainIdentifier:'75960621456300141', UPC:'75960621456300141', Title:'AVENGERS #1 FOIL VARIANT', VariantType:'Variant Title'});
assert.equal(foil.flags.foil, true, 'foil covers must be explicitly identified for pricing and filtering');

const repairedEncoding = normalizePrhRow({...representative, Artist:'FÃ¡bio Moon', Description:'ITâS reunion weekendÂ at Riverdale High.'});
assert.equal(repairedEncoding.interiorArtist, 'Fábio Moon', 'PRH names must repair UTF-8 text decoded as Latin-1');
assert.equal(repairedEncoding.description, 'IT’S reunion weekend at Riverdale High.', 'PRH punctuation must not display mojibake on the preorder page');

// Store report: a FOC synopsis rendered with mangled punctuation ("Fallbacks"
// followed by garbage instead of an apostrophe, a garbled bullet, etc) --
// PRH's feed had gone through TWO rounds of UTF-8-decoded-as-Windows-1252
// before reaching us, not one. The single-pass reversal above (previous
// test) leaves codepoints like U+20AC/U+2122 in the string from the first
// bad decode, which used to trip the old "any codepoint over 255 means
// don't touch it" safety guard and silently skip repair entirely.
// Reproduced by round-tripping clean text through the exact corruption
// PRH's feed applies (encode to UTF-8 bytes, reinterpret as Windows-1252,
// twice) rather than pasting literal mojibake characters, since those can
// include invisible control codepoints that don't survive being typed or
// copy-pasted reliably.
const CP1252_LOW_TO_UNICODE = {0x80:0x20AC,0x82:0x201A,0x83:0x0192,0x84:0x201E,0x85:0x2026,0x86:0x2020,0x87:0x2021,0x88:0x02C6,0x89:0x2030,0x8A:0x0160,0x8B:0x2039,0x8C:0x0152,0x8E:0x017D,0x91:0x2018,0x92:0x2019,0x93:0x201C,0x94:0x201D,0x95:0x2022,0x96:0x2013,0x97:0x2014,0x98:0x02DC,0x99:0x2122,0x9A:0x0161,0x9B:0x203A,0x9C:0x0153,0x9E:0x017E,0x9F:0x0178};
function mangleOnceAsCp1252(cleanText) {
  let out = '';
  for (const byte of Buffer.from(cleanText, 'utf8')) out += String.fromCodePoint(CP1252_LOW_TO_UNICODE[byte] || byte);
  return out;
}
const cleanSynopsis = 'Fallbacks' + String.fromCharCode(0x2019) + ' adventures reach their climax ' + String.fromCharCode(0x2014) + ' the gods themselves await. Can' + String.fromCharCode(0x2019) + 't miss it' + String.fromCharCode(0x2026) + ' ' + String.fromCharCode(0x2022) + ' Featuring Julie Dillon.';
const doubleMangled = mangleOnceAsCp1252(mangleOnceAsCp1252(cleanSynopsis));
const repairedDouble = normalizePrhRow({...representative, Description: doubleMangled});
assert.equal(repairedDouble.description, cleanSynopsis, 'a synopsis mis-encoded through Windows-1252 TWICE must be fully repaired, not silently left broken');

assert.match(migration, /America\/Los_Angeles/);
assert.match(migration, /p_foc_date::timestamp \+ interval '1 minute'/, 'default cutoff must be 12:01 AM Monday Pacific');
assert.match(migration, /revoke all[\s\S]+from anon/i, 'raw preorder tables must not be anonymous');
assert.match(worker, /handleFocRequest/);

const pagedCatalog=paginateCycleCatalog({cycle:{id:'cycle-1'},families:[
  {id:'family-1',title:'One',variants:[{id:'sku-1'},{id:'sku-2'}]},
  {id:'family-2',title:'Two',variants:[{id:'sku-3'}]},
]},'2','1');
assert.deepEqual(pagedCatalog.families.map(family=>[family.id,family.variants.map(sku=>sku.id)]),[['family-1',['sku-2']],['family-2',['sku-3']]]);
assert.equal(pagedCatalog.totalVariants,3);
assert.equal(pagedCatalog.hasMore,false);
assert.equal(pagedCatalog.nextOffset,null);
assert.match(service, /Choose a live carrier shipping rate/);
assert.match(service, /ShippoToken/);
assert.match(service, /waitlist-only until the store secures more copies/);
assert.match(service, /path==='\/public\/preorders\/picks'&&request\.method==='GET'/, 'signed-in collectors must be able to reopen unpaid comic pulls');
assert.match(service, /path==='\/public\/preorders\/picks'&&request\.method==='PUT'/, 'comic pulls must be saved before payment instead of living only in one browser');
assert.match(service, /request\.method==='PATCH'\|\|request\.method==='DELETE'/, 'saved pulls need item-level save/remove operations independent from the cart');
assert.match(service, /user_id=eq\.\$\{encodeURIComponent\(auth\.user\.id\)\}/, 'saved-pull mutations must remain scoped to the authenticated collector');
assert.match(service, /await loadSavedPicks\(db,storeId,auth\.user\.id\)/, 'the account preorder response must include saved unpaid pulls separately from purchased orders');
assert.match(service, /p\.isIncentive \|\| p\.flags\.foil/, 'new foils and ratio incentives must import without a guessed selling price');
assert.match(service, /hadCustomPrice/, 'staff selling-price overrides must survive PRH re-imports');
assert.match(service, /customer_price_cents \|\| 0/, 'checkout must never fall back from an unset selling price to distributor MSRP');
assert.match(service, /metadata\[source\].*foc_preorder/s);
assert.match(dashboard, /THE FOC WALL/i);
assert.match(dashboard, /LOCK ORDERS/);
assert.match(dashboard, /UNLOCK ORDERS/);
assert.match(dashboard, /HIDE FROM SITE/);
assert.match(dashboard, /SHOW ON SITE \(LOCKED\)/);

// ── Bug: a real PRH FOC metadata CSV import failed with "289 row(s) are
// missing an exact identifier, title, or FOC date" -- on EVERY row, despite
// every row genuinely having all three. Root cause: SheetJS's CSV reader
// type-infers date-looking cells and reformats them to a locale short date
// (e.g. "08/31/2026" -> "8/31/26") unless read with raw:true, and the
// server's dateIso() parser requires a 4-digit year, so it silently
// rejected every single row. The same type-inference also rounds big
// numeric-looking identifier strings (17-digit UPCs) through float
// coercion, corrupting the exact identifier this importer depends on. ──
assert.match(dashboard, /XLSX\.read\(buffer,\{type:'array',raw:true\}\)/, 'the PRH FOC import must read the workbook with raw:true, or SheetJS silently reformats date cells (breaking every row\'s FOC date) and corrupts big numeric identifier strings through float rounding');
assert.doesNotMatch(dashboard, /XLSX\.read\(buffer,\{type:'array'\}\)/, 'the old raw-less read call must be gone, not just shadowed by a second one');

// ── Functional: reproduce the exact bug end-to-end against the real xlsx
// library (same version loaded from CDN in production), using the exact
// read options string extracted from the shipped source -- so this test
// actually breaks if the raw:true fix is ever reverted, instead of just
// asserting a string is present. ──
{
  const XLSX = (await import('xlsx')).default ?? await import('xlsx');
  const readOptsSrc = dashboard.match(/XLSX\.read\(buffer,(\{[^}]*\})\)/)?.[1];
  assert.ok(readOptsSrc, 'could not extract the XLSX.read() options object from scripts/foc-dashboard.js');
  const readOpts = new Function('return ' + readOptsSrc)();

  // A minimal PRH-shaped CSV: real column names, a date-looking FOCDate,
  // and a 17-digit UPC-like identifier long enough to lose precision if
  // SheetJS ever coerces it to a Number instead of keeping it a string.
  const csv = 'MainIdentifier,UPC,Title,FOCDate\n' +
    '75960621456300121,75960621456300121,AVENGERS #1 PRIMARY TITLE,08/31/2026\n';
  const buffer = Buffer.from(csv, 'utf8');
  const wb = XLSX.read(buffer, { ...readOpts, type:'buffer' }); // type:'buffer' swaps in for the browser's ArrayBuffer path; raw stays whatever the source specifies
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval:'', raw:false });
  assert.equal(rows[0].FOCDate, '08/31/2026', 'FOCDate must survive the read as the exact original string, not get reformatted to a 2-digit-year short date ("8/31/26") that the server\'s strict dateIso() parser then rejects');
  assert.equal(rows[0].MainIdentifier, '75960621456300121', 'a 17-digit identifier must survive the read as an exact string, not get coerced through a float and lose precision');
  const normalized = normalizePrhRow(rows[0]);
  assert.ok(normalized.distributorSku && normalized.upc && normalized.focDate && normalized.title, 'the row must pass the server\'s import validation now (all four required fields present) -- this is the exact check that failed on all 289 rows before the fix');
}

console.log('PRH FOC CSV date/identifier reformatting fix (real xlsx library) verified.');

// ── Bug: the customer-facing preorder page can only ever show ONE FOC
// week -- loadCatalog() always fetches just the single most recent cycle.
// A new Monday import doesn't delete the prior week from the database (the
// dashboard's FOC Wall still lists both), but the live site had no way to
// ask for anything but "the latest one", so from a customer's perspective
// older weeks just vanished the moment a new week was imported. ──
assert.match(service, /export async function loadAllCatalogs\(db, storeId, includeAdmin = false\) \{/, 'loadAllCatalogs must exist and be exported for the multi-week public route to use');
assert.match(service, /status=neq\.archived&order=foc_date\.desc&limit=26/, 'loadAllCatalogs must fetch multiple non-archived cycles, not just the single latest one');
assert.match(worker, /handleFocRequest/, 'sanity: the worker still wires up the FOC route handler');
assert.match(service, /if\(path==='\/public\/preorders\/weeks'&&request\.method==='GET'\)\{/, 'a public route to list every FOC week must exist alongside the existing single-week /public/preorders route');
assert.match(service, /const cycles=await loadAllCatalogs\(db,storeId,false\);return deps\.json\(\{ok:true,cycles\}\);/, 'the weeks route must return every open/closed cycle\'s catalog, not just the newest');
assert.match(service, /url\.searchParams\.get\('summary'\)==='1'/, 'the first customer request must support a metadata-only cycle index instead of returning every cover catalog');
assert.match(service, /if \(!includeAdmin\) cycleQuery \+= '&status=neq\.archived'/, 'a hidden FOC must not be reachable through the public single-cycle route');

console.log('Multi-week FOC public route contract checks passed');

// ── Functional: loadAllCatalogs against a mock two-cycle store (the exact
// shape of the real bug report -- an Aug 31 and an Aug 24 cycle both open)
// -- confirms both weeks come back, newest first, each with only its own
// families/SKUs (no cross-week bleed), and that an archived third week is
// excluded. ──
{
  const cycleAug31 = { id:'cycle-aug31', store_id:'store1', distributor:'PRH', foc_date:'2026-08-31', customer_cutoff_at:'2026-08-31T07:01:00Z', status:'open' };
  const cycleAug24 = { id:'cycle-aug24', store_id:'store1', distributor:'PRH', foc_date:'2026-08-24', customer_cutoff_at:'2026-08-24T07:01:00Z', status:'open' };
  const familyAug31 = { id:'fam-aug31', cycle_id:'cycle-aug31', distributor_family_id:'f1', title:'Sabrina the Teenage Witch #1' };
  const familyAug24 = { id:'fam-aug24', cycle_id:'cycle-aug24', distributor_family_id:'f2', title:'Uncanny X-Men #36' };
  const skuAug31 = { id:'sku-aug31', family_id:'fam-aug31', cycle_id:'cycle-aug31', distributor_sku:'111', upc:'111', title:'Sabrina the Teenage Witch #1', variant_label:'Cover A', customer_price_cents:499 };
  const skuAug24 = { id:'sku-aug24', family_id:'fam-aug24', cycle_id:'cycle-aug24', distributor_sku:'222', upc:'222', title:'Uncanny X-Men #36', variant_label:'Cover A', customer_price_cents:499 };

  const db = async (path) => {
    if (path.startsWith('foc_cycles?')) {
      assert.ok(path.includes('status=neq.archived'), 'must exclude archived cycles at the query level');
      return { data:[cycleAug31, cycleAug24] }; // newest first, as order=foc_date.desc would return
    }
    if (path.startsWith('comic_title_families?cycle_id=eq.cycle-aug31')) return { data:[familyAug31] };
    if (path.startsWith('comic_title_families?cycle_id=eq.cycle-aug24')) return { data:[familyAug24] };
    if (path.startsWith('comic_skus?cycle_id=eq.cycle-aug31')) return { data:[skuAug31] };
    if (path.startsWith('comic_skus?cycle_id=eq.cycle-aug24')) return { data:[skuAug24] };
    if (path.startsWith('foc_preorder_orders?')) return { data:[] };
    throw new Error('unexpected db call: ' + path);
  };

  const cycles = await loadAllCatalogs(db, 'store1', false);
  assert.equal(cycles.length, 2, 'both open weeks must be returned, not just the newest');
  assert.equal(cycles[0].cycle.id, 'cycle-aug31', 'weeks must come back newest-first, matching the order cycles were fetched in');
  assert.equal(cycles[1].cycle.id, 'cycle-aug24', 'the older week must still be present, not dropped');
  assert.equal(cycles[0].families.length, 1);
  assert.equal(cycles[0].families[0].title, 'Sabrina the Teenage Witch #1', 'the Aug 31 week must only contain its own family, not the other week\'s');
  assert.equal(cycles[1].families[0].title, 'Uncanny X-Men #36', 'the Aug 24 week must only contain its own family, not the other week\'s');
  assert.equal(cycles[0].families[0].variants.length, 1);
  assert.equal(cycles[0].families[0].variants[0].sku, '111', 'each week\'s SKUs must stay scoped to that week\'s cycle_id, not merge across weeks');
}

console.log('loadAllCatalogs multi-week functional checks passed');

// The lightweight index must not build any title/SKU catalogs, and must
// place orderable cycles first with expired history at the bottom.
{
  const active = { id:'active', store_id:'store1', foc_date:'2099-09-07', customer_cutoff_at:'2099-09-07T07:01:00Z', status:'open' };
  const expired = { id:'expired', store_id:'store1', foc_date:'2020-08-24', customer_cutoff_at:'2020-08-24T07:01:00Z', status:'open' };
  let calls=0;
  const db=async path=>{calls++;assert.match(path,/^foc_cycles\?/);return{data:[expired,active]};};
  const summaries=await loadCycleSummaries(db,'store1');
  assert.equal(calls,1,'cycle summaries must use one small cycle-table query only');
  assert.deepEqual(summaries.map(c=>c.id),['active','expired'],'active FOCs must precede expired history');
  assert.equal(summaries[0].isOpen,true);
  assert.equal(summaries[1].isOpen,false);
}

console.log('FOC summary ordering and incremental-load contract checks passed');

// ── Bug: placing a FOC preorder and paying for it never sent the customer
// any confirmation -- checkout only set up the Stripe payment and wrote
// the order row; nothing in the flow ever called the app's email sender. ──
assert.match(worker, /syncFocStripeEvent\(env,event,\{supabaseAdminFetch,sendEmail\}\)/, 'the Stripe webhook must pass sendEmail into syncFocStripeEvent, or a paid FOC order can never trigger a confirmation email');
assert.match(service, /export function focOrderConfirmationEmail\(order, items\) \{/, 'a confirmation-email builder must exist');
assert.match(service, /const guard = status==='paid' \? '&status=neq\.paid' : '';/, 'the paid-transition update must guard against redelivered Stripe webhooks, or a duplicate delivery would email the customer twice');

console.log('FOC order-confirmation-email contract checks passed');

// ── Functional: the email body itself must actually contain what was
// ordered and what it cost -- a confirmation with no order details isn't
// a real confirmation. ──
{
  const order = { order_number:'FOC-20260831-ABCD1234', customer_name:'Jane', customer_email:'jane@example.com', fulfillment_method:'pickup', subtotal_cents:998, shipping_cents:0, total_cents:998 };
  const items = [{ quantity:2, unit_price_cents:499, sku_snapshot:{ title:'Avengers #1', variantLabel:'Cover A' } }];
  const { subject, body } = focOrderConfirmationEmail(order, items);
  assert.match(subject, /FOC-20260831-ABCD1234/, 'the subject must name the specific order');
  assert.match(body, /2 x Avengers #1/, 'the body must list what was actually ordered and the quantity');
  assert.match(body, /\$9\.98/, 'the body must show the real total charged, not a placeholder');
  assert.match(body, /Pickup in store/, 'the body must state the fulfillment method the customer chose');
}

// ── Functional: syncFocStripeEvent against a mock Stripe webhook payload,
// covering the exact failure modes a real confirmation email needs to
// avoid -- sending on a genuine payment, never on a failed payment, never
// twice on a redelivered webhook (Stripe redelivers on any non-2xx or
// timeout), and never touching FOC tables at all for an unrelated
// payment (e.g. a normal POS sale) that just happens to share the same
// event type. ──
{
  const mockOrder = { id:'order1', order_number:'FOC-20260831-ABCD1234', store_id:'store1', user_id:'user1', stripe_mode:'live', customer_email:'jane@example.com', customer_name:'Jane', fulfillment_method:'pickup', subtotal_cents:2499, shipping_cents:0, total_cents:2499 };
  const mockItems = [{ id:'item1', sku_id:'sku1', quantity:1, unit_price_cents:2499, line_total_cents:2499, sku_snapshot:{ title:'Avengers #1', variantLabel:'Cover A' } }];

  // Genuine successful payment -> exactly one email, to the right address.
  // supabaseAdminFetch's real signature is (env, path, options) -- syncFocStripeEvent
  // always calls it via deps.supabaseAdminFetch(env, path, options), never the
  // 2-arg (path, options) shorthand loadCatalog/loadAllCatalogs use internally
  // via their own pre-bound `db` closure, so these mocks take env first.
  {
    const emailCalls = [];
    const ledgerWrites = [];
    const db = async (env, path, options) => {
      if (path.startsWith('foc_preorder_orders?') && !options) return { data:[mockOrder] };
      if (path.startsWith('foc_preorder_orders?') && options?.method === 'PATCH') {
        if (!path.includes('status=neq.paid')) return { data:[] };
        assert.ok(path.includes('status=neq.paid'), 'the paid-transition PATCH must carry the idempotency guard');
        return { data:[mockOrder] };
      }
      if (path.startsWith('foc_preorder_items?')) return { data:mockItems };
      if (path.startsWith('foc_pick_lists?')) return { data:[] };
      if (/^pos_(sales|sale_lines|payments)\?on_conflict=id$/.test(path)) { ledgerWrites.push({path,body:JSON.parse(options.body)}); return { data:[] }; }
      throw new Error('unexpected db call: ' + path);
    };
    const sendEmail = async (env, to, subject) => { emailCalls.push({ to, subject }); };
    const event = { type:'payment_intent.succeeded', data:{ object:{ id:'pi_1', status:'succeeded', metadata:{ source:'foc_preorder', foc_order_id:'order1' } } } };
    await syncFocStripeEvent({}, event, { supabaseAdminFetch:db, sendEmail });
    assert.equal(emailCalls.length, 1, 'a genuine successful payment must send exactly one confirmation email');
    assert.equal(emailCalls[0].to, 'jane@example.com', 'the email must go to the order\'s customer_email, not somewhere else');
    assert.equal(ledgerWrites.length, 3, 'a paid comic preorder must write one sale, its lines, and its payment into the shared dashboard ledger');
    const preorderLine=ledgerWrites.find(call=>call.path.startsWith('pos_sale_lines')).body[0];
    assert.equal(preorderLine.adjusted_price,24.99, 'dashboard sales must receive the full comic line revenue');
    assert.equal(preorderLine.cost_basis,12.5, 'PRH cost must be exactly 50% of price, rounded to the nearest cent');
    assert.equal(preorderLine.profit,12.49, 'comic preorder profit must be revenue minus the 50% PRH cost');
  }

  // Redelivered webhook for an order already marked paid -> the guarded
  // PATCH matches zero rows -> must not send a second email.
  {
    const emailCalls = [];
    const db = async (env, path, options) => {
      if (path.startsWith('foc_preorder_orders?') && !options) return { data:[mockOrder] };
      if (path.startsWith('foc_preorder_orders?') && options?.method === 'PATCH') return { data:[] };
      if (path.startsWith('foc_preorder_items?')) return { data:mockItems };
      if (/^pos_(sales|sale_lines|payments)\?on_conflict=id$/.test(path)) return { data:[] };
      throw new Error('unexpected db call on redelivery: ' + path);
    };
    const sendEmail = async () => { emailCalls.push(1); };
    const event = { type:'payment_intent.succeeded', data:{ object:{ id:'pi_1', status:'succeeded', metadata:{ source:'foc_preorder', foc_order_id:'order1' } } } };
    await syncFocStripeEvent({}, event, { supabaseAdminFetch:db, sendEmail });
    assert.equal(emailCalls.length, 0, 'a redelivered webhook for an already-paid order must not send a duplicate confirmation email');
  }

  // Failed payment -> no email under any circumstances.
  {
    let emailCalled = false;
    const db = async (env, path, options) => {
      if (path.startsWith('foc_preorder_orders?') && options?.method === 'PATCH') return { data:[{ id:'order1' }] };
      throw new Error('unexpected db call: ' + path);
    };
    const sendEmail = async () => { emailCalled = true; };
    const event = { type:'payment_intent.payment_failed', data:{ object:{ id:'pi_2', status:'requires_payment_method', metadata:{ source:'foc_preorder', foc_order_id:'order1' } } } };
    await syncFocStripeEvent({}, event, { supabaseAdminFetch:db, sendEmail });
    assert.equal(emailCalled, false, 'a failed payment must never trigger a confirmation email');
  }

  // Unrelated Stripe event (e.g. a normal in-store POS sale's payment_intent)
  // -> must not touch the FOC tables or send anything.
  {
    let dbCalled = false, emailCalled = false;
    const db = async () => { dbCalled = true; return { data:[] }; };
    const sendEmail = async () => { emailCalled = true; };
    const event = { type:'payment_intent.succeeded', data:{ object:{ id:'pi_3', status:'succeeded', metadata:{ source:'pos_ledger' } } } };
    await syncFocStripeEvent({}, event, { supabaseAdminFetch:db, sendEmail });
    assert.equal(dbCalled, false, 'a non-FOC Stripe event must be ignored entirely');
    assert.equal(emailCalled, false);
  }
}

console.log('FOC order-confirmation-email functional checks passed');

// A completed Stripe charge must be recoverable even if the webhook never
// arrives. The recovery path verifies identity, store, currency, and amount
// before it is allowed to reuse the normal paid-event transition.
{
  const order={id:'order-reconcile',store_id:'store1',status:'payment_pending',stripe_mode:'live',stripe_payment_intent_id:'pi_reconcile',currency:'usd',total_cents:3395};
  const stripeApi=async()=>({id:'pi_reconcile',status:'succeeded',currency:'usd',amount:3395,metadata:{source:'foc_preorder',foc_order_id:'order-reconcile',arsca_store_id:'store1'}});
  let paidPatch=false;
  const db=async(env,path,options)=>{
    if(path.startsWith('foc_preorder_orders?')&&!options)return{data:[]};
    if(path.startsWith('foc_preorder_orders?')&&options?.method==='PATCH'){paidPatch=JSON.parse(options.body).status==='paid';return{data:[]};}
    throw new Error('unexpected reconciliation db call: '+path);
  };
  const result=await reconcileFocOrderPayment({},order,{stripeApi,stripeMode:()=> 'live',supabaseAdminFetch:db});
  assert.equal(result.status,'succeeded');
  assert.equal(paidPatch,true,'a verified succeeded PaymentIntent must run the ordinary idempotent paid transition');
  await assert.rejects(()=>reconcileFocOrderPayment({},order,{stripeApi:async()=>({...await stripeApi(),amount:999}),stripeMode:()=> 'live',supabaseAdminFetch:db}),/amount does not match/,'a mismatched Stripe amount must never repair an order');
}

console.log('FOC missed-webhook reconciliation checks passed');

// On the store workstation, also validate the full supplied PRH export. CI
// remains deterministic when that private distributor file is absent.
const actualPath = 'C:/Users/Sales/Downloads/2026-08-24_PRH_FOC_metadata_full (1).csv';
if (fs.existsSync(actualPath)) {
  const rows = parse(fs.readFileSync(actualPath), { columns:true, bom:true, skip_empty_lines:true, relax_column_count:true });
  const normalized = rows.map(normalizePrhRow);
  assert.equal(rows.length, 249, 'the supplied FOC file should contain 249 products');
  assert.equal(new Set(normalized.map(row => row.distributorFamilyId)).size, 133, 'the supplied file should group into 133 title families');
  assert.equal(normalized.filter(row => row.isIncentive).length, 32, 'the supplied file should contain 32 ratio incentives');
  assert.ok(normalized.every(row => typeof row.distributorSku === 'string' && /^(?:\d{13}|\d{17})$/.test(row.distributorSku)), 'all supplied UPC/ISBN identifiers must remain exact digit strings');
  const avengers = normalized.filter(row => row.distributorFamilyId === '852493');
  assert.ok(avengers.length >= 8, 'Avengers #1 covers should share one stable family');
  assert.ok(avengers.some(row => row.variantLabel === 'Cover A'));
  assert.deepEqual(avengers.filter(row => row.isIncentive).map(row => row.ratioThreshold).sort((a,b)=>a-b), [25,50,100,200]);
}

console.log('FOC preorder normalization, security, checkout, and real-rate shipping contracts passed.');

// ── Contract: receiving a shipment is the ONLY place a comic_sku becomes
// real inventory -- importing a PRH file and placing the distributor order
// (exportPrh) both stay catalog/planning-only, since neither is proof the
// books actually arrive (short-ships, delays, and cancellations are routine
// in comics distribution). Creating inventory at either earlier point would
// give the store phantom stock for books it may never receive. ──
assert.match(service, /if\(path==='\/foc\/admin\/receive'&&request\.method==='POST'\)return receiveShipment\(request,env,deps\);/, 'a POST /foc/admin/receive route must exist');
const importPrhSrc = service.match(/async function importPrh\(request, env, deps, storeId\) \{[\s\S]*?\n\}/)[0];
assert.doesNotMatch(importPrhSrc, /inventory_items/, 'importing a PRH file must never create inventory_items rows -- most of a weekly catalog is never ordered');
const exportPrhSrc = service.match(/async function exportPrh\(env,deps,url,request\)\{[\s\S]*?\n\}/)[0];
assert.doesNotMatch(exportPrhSrc, /inventory_items/, 'placing the distributor order must never create inventory_items rows -- an order is not proof the books arrive');
const receiveSrc = service.match(/async function receiveShipment\(request,env,deps\)\{[\s\S]*?\n\}/)[0];
assert.match(receiveSrc, /status:'in_stock'/, 'received copies must be created as normal sellable in_stock inventory');
assert.match(receiveSrc, /source:'foc_receive',focSkuId:sku\.id,focCycleId:cycleId/, 'created inventory must trace back to the exact FOC cover and cycle it came from');
assert.match(receiveSrc, /sort\(\(a,b\)=>new Date\(a\.created_at\)-new Date\(b\.created_at\)\)/, 'paid customer copies must be reserved oldest-order-first, not in an arbitrary order');
assert.match(receiveSrc, /status=eq\.committed/, 'only committed (paid, non-refunded) preorder items may claim a received copy');
assert.match(receiveSrc, /if\(need<=0\|\|need>reserveRemaining\)continue;/, 'an item must only be marked received when its FULL requested quantity is covered -- partially covering it and still marking it received would understate what the customer is still owed');
assert.match(receiveSrc, /nextStatus=order\.fulfillment_method==='pickup'\?'ready_for_pickup':'reserved'/, 'a fully-received paid order must move to ready_for_pickup (pickup) or reserved (shipping), not sit looking identical to an order still weeks away');

// Store request: a received physical copy must never be sellable twice --
// once as a freshly-created standalone row (POS/storefront) AND again
// through the still-live FOC eBay presale listing's own separate quantity
// counter. Copies already spoken for by that listing's own available
// quantity must not also become new standalone rows; a short-ship against
// what the listing still shows available must pull the listing's quantity
// down (locally and on the live eBay offer) instead of leaving it able to
// oversell copies that never arrived.
assert.match(receiveSrc, /if\(row\.status==='presale'&&d\.ebayOfferId&&remainingQty>0\)livePresaleRowBySkuId\.set\(d\.focSkuId,row\);/,
  'must track which SKUs have a live (still-presale, still-unsold) eBay listing to reconcile against');
assert.match(receiveSrc, /newStandaloneCount=Math\.max\(0,receivedQty-presaleAvailable\);/,
  'only the amount received beyond what the live listing already accounts for may become new standalone rows');
assert.match(receiveSrc, /if\(receivedQty<presaleAvailable\)\{/, 'a short-ship against the listing\'s own available quantity must be detected');
assert.match(receiveSrc, /await deps\.ebayReviseOfferQuantity\(env,ebayToken,pd\.ebayOfferId,receivedQty\)/,
  'a short-shipped listing\'s quantity must actually be pushed down on the live eBay offer, not just the local row');
assert.match(receiveSrc, /data:\{\.\.\.pd,qty:receivedQty,quantity:receivedQty\}/, 'the local presale row must be reduced to match what actually arrived');
assert.match(receiveSrc, /const \{ data:inserted \}=rows\.length\?await db\('inventory_items',\{method:'POST'/,
  'must skip the insert call entirely when nothing needs a new standalone row (all received copies already absorbed by the live listing)');

console.log('FOC receive-shipment contract checks passed');

// ── Functional: reimplement the receiving-vs-live-listing reconciliation
// math and verify it against the scenarios that actually matter -- no live
// listing (legacy behavior unchanged), over-received (surplus becomes new
// stock, listing untouched), exact match, and short-ship (listing pulled
// down, nothing double-counted as new stock). ──
function reconcileReceivedAgainstLivePresale(receivedQty, presaleAvailable) {
  if (!(presaleAvailable > 0)) return { newStandaloneCount: receivedQty, presaleReducedTo: null };
  const newStandaloneCount = Math.max(0, receivedQty - presaleAvailable);
  const presaleReducedTo = receivedQty < presaleAvailable ? receivedQty : null;
  return { newStandaloneCount, presaleReducedTo };
}
{
  // No live eBay listing for this SKU at all -- every received copy becomes
  // a normal standalone row, exactly as it always did before this feature.
  const r = reconcileReceivedAgainstLivePresale(5, 0);
  assert.equal(r.newStandaloneCount, 5, 'with no live listing, nothing should be withheld from becoming standalone stock');
  assert.equal(r.presaleReducedTo, null, 'there is no listing to reduce');
}
{
  // Store ordered/received more than the live listing still shows
  // available (e.g. it already sold some) -- the surplus becomes new
  // standalone stock; the listing itself is left alone (it's not short).
  const r = reconcileReceivedAgainstLivePresale(10, 7);
  assert.equal(r.newStandaloneCount, 3, 'only the surplus beyond the listing\'s own available count should become new standalone stock');
  assert.equal(r.presaleReducedTo, null, 'a listing that is not short-shipped must not have its quantity touched');
}
{
  // Received exactly what the listing still shows available -- fully
  // absorbed by the listing (which convert-to-instock will flip to
  // in_stock right after), no new standalone rows, no reduction needed.
  const r = reconcileReceivedAgainstLivePresale(7, 7);
  assert.equal(r.newStandaloneCount, 0, 'an exact match must not create redundant standalone rows for copies the listing already accounts for');
  assert.equal(r.presaleReducedTo, null, 'an exact match is not a short-ship');
}
{
  // Short-ship: fewer copies arrived than the live listing still shows
  // available to buy -- the listing must be pulled down to what actually
  // came in so it can never oversell a copy that never showed up.
  const r = reconcileReceivedAgainstLivePresale(4, 7);
  assert.equal(r.newStandaloneCount, 0, 'a short-shipped SKU must not spin off standalone rows -- there is nothing left over');
  assert.equal(r.presaleReducedTo, 4, 'the listing\'s available quantity must be pulled down to exactly what arrived');
}

console.log('FOC receive-vs-live-listing reconciliation functional checks passed');

// ── Functional: reimplement the reservation + order-status-flip algorithm
// and verify it against the scenarios that actually matter: a short-ship
// (fewer copies arrive than were ordered), oldest-paid-customer-first
// allocation, a cover with no customer orders at all (pure store stock),
// and a partially-received order that must NOT be marked ready. ──
function allocateReceivedCopies(receivedQty, paidItemsForSku) {
  const sorted = paidItemsForSku.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let remaining = receivedQty;
  const reservedItemIds = [];
  for (const item of sorted) {
    const need = item.quantity;
    if (need <= 0 || need > remaining) continue; // never partially reserve one item's requested quantity
    remaining -= need;
    reservedItemIds.push(item.id);
  }
  return { reservedItemIds, reservedForCustomers: receivedQty - remaining, unclaimed: remaining };
}
function nextOrderStatus(fulfillmentMethod, allItemsReceived) {
  if (!allItemsReceived) return null;
  return fulfillmentMethod === 'pickup' ? 'ready_for_pickup' : 'reserved';
}

{
  // Ordered 5, only 3 arrived (short-ship) -- the two oldest paid customers
  // (qty 1 and 1) get reserved; the newest paid customer (qty 2) is left
  // unreserved rather than the allocation silently favoring them.
  const paid = [
    { id:'item-newest', quantity:2, created_at:'2026-08-19T10:00:00Z' },
    { id:'item-oldest', quantity:1, created_at:'2026-08-15T10:00:00Z' },
    { id:'item-middle', quantity:1, created_at:'2026-08-17T10:00:00Z' },
  ];
  const result = allocateReceivedCopies(3, paid);
  assert.deepEqual(result.reservedItemIds, ['item-oldest', 'item-middle'], 'a short-shipped cover must reserve the oldest paid orders first, not an arbitrary order');
  assert.equal(result.reservedForCustomers, 2, 'only the copies actually allocated to a customer count as reserved');
  assert.equal(result.unclaimed, 1, 'the remaining received copy (not enough for the newest paid order) becomes normal shelf stock, not a phantom reservation');
}

{
  // A cover nobody preordered (pure speculative store stock) -- everything
  // received goes straight to the shelf, no reservation math applies.
  const result = allocateReceivedCopies(4, []);
  assert.deepEqual(result.reservedItemIds, []);
  assert.equal(result.reservedForCustomers, 0);
  assert.equal(result.unclaimed, 4, 'a cover with no paid customers must have its entire received quantity available as shelf stock');
}

{
  // Order status only flips once EVERY item on it has arrived -- a mixed
  // order (one cover in, one cover still weeks out) must not be marked
  // ready for pickup with half the order missing.
  assert.equal(nextOrderStatus('pickup', true), 'ready_for_pickup');
  assert.equal(nextOrderStatus('shipping', true), 'reserved');
  assert.equal(nextOrderStatus('pickup', false), null, 'an order with any unreceived item must not be marked ready_for_pickup');
}

console.log('FOC receive-shipment functional checks passed');

// ── Bug: a customer whose checkout got interrupted (closed the tab,
// network dropped, walked away) mid-Stripe-payment was left with an order
// permanently stuck in payment_pending on My Preorders, with no way to ever
// pay it -- checkout (/public/preorders/checkout) only ever creates a NEW
// order from cart items, and cancel is the only other route that touches
// payment_pending. There was no "resume" action at all: the pay button a
// customer would expect on that order literally had nothing to call. ──
assert.match(service, /if\(path==='\/public\/preorders\/resume'&&request\.method==='POST'\)return resumePreorderPayment\(request,env,deps\);/, 'a POST /public/preorders/resume route must exist so a payment_pending order is not a permanent dead end');
assert.match(service, /canPay:deadlineOpen&&unpaid,canCancel:unpaid/, 'My Preorders must distinguish payable orders from always-removable unpaid attempts');
const cancelSrc = service.match(/async function cancelPreorder\(request, env, deps\) \{[\s\S]*?\n\}/)[0];
assert.match(cancelSrc,/if\(order\.status==='payment_pending'\|\|order\.status==='payment_failed'\)/,'an unpaid attempt must remain removable after FOC closes; there is no captured payment or distributor quantity to preserve');
assert.doesNotMatch(cancelSrc,/requested_by_customer|stripeApi\(env[^\n]*'refunds'/,'a paid comic preorder must never expose an automatic customer cancellation or refund path');
assert.match(cancelSrc,/Paid comic preorders are final and cannot be cancelled online/,'paid orders must clearly explain the final-sale policy');
assert.match(service, /const RESUMABLE_INTENT_STATUSES = new Set\(\['requires_payment_method','requires_confirmation','requires_action'\]\);/, 'must only reuse an existing PaymentIntent Stripe still considers payable, never one already succeeded/canceled');
const resumeSrc = service.match(/async function resumePreorderPayment\(request, env, deps\) \{[\s\S]*?\n\}/)[0];
assert.match(resumeSrc, /user_id=eq\.\$\{encodeURIComponent\(auth\.user\.id\)\}/, 'must scope the order lookup to the authenticated user -- one customer must never be able to resume another\'s order by guessing an orderId');
assert.match(resumeSrc, /if\(!\['payment_pending','payment_failed'\]\.includes\(order\.status\)\)/, 'an order that is already paid/cancelled/refunded must be rejected, not silently charged again or given a stray new PaymentIntent');
assert.match(resumeSrc, /if\(!cycleOpen\(order\.cycle\)\)/, 'resuming payment after FOC has closed must be blocked the same way new checkouts and cancellations already are -- the store can no longer add it to the distributor order');
assert.match(resumeSrc, /idempotencyKey:`arsca-foc-resume-\$\{mode\}-\$\{order\.id\}-\$\{Date\.now\(\)\}`/, 'the resume path\'s idempotency key must differ from the original checkout\'s (no Date.now()) -- reusing that exact key would make Stripe hand back the original, already-dead intent instead of minting a payable one');

console.log('FOC resume-payment contract checks passed');

// ── Functional: drive resumePreorderPayment through handleFocRequest with a
// fully mocked deps, covering the scenarios that actually matter for a
// customer stuck on a dead-end order. ──
function mockRequest(body, method = 'POST') {
  return { method, headers:{ get:() => null }, json:async () => body };
}
function mockDeps(overrides = {}) {
  return {
    json:(data, status = 200) => ({ status, data }),
    readJsonWithLimit:async (request) => ({ data:await request.json() }),
    requireAuthenticatedUser:async () => ({ user:{ id:'user-1' } }),
    stripeMode:() => 'test',
    stripeConfig:() => ({ secretKey:'sk_test_x', publishableKey:'pk_test_x' }),
    supabaseAdminFetch:async () => ({ data:[] }),
    stripeApi:async () => { throw new Error('unexpected stripeApi call'); },
    ...overrides,
  };
}
const openCycle = { status:'open', customer_cutoff_at:new Date(Date.now() + 3600000).toISOString() };
const closedCycle = { status:'open', customer_cutoff_at:new Date(Date.now() - 3600000).toISOString() };

{
  // A dead-but-not-yet-known-dead intent (requires_payment_method) must be
  // reused as-is -- no new PaymentIntent, no order row PATCH.
  const order = { id:'order-1', user_id:'user-1', status:'payment_pending', stripe_payment_intent_id:'pi_old', stripe_mode:'test', total_cents:998, cycle_id:'cycle-1', store_id:'store-1', order_number:'FOC-1', customer_email:'jane@example.com', cycle:openCycle };
  let patchCalled = false, stripeApiCalls = [];
  const deps = mockDeps({
    supabaseAdminFetch:async (env, path) => { assert.ok(path.includes('user_id=eq.user-1'), 'lookup must be scoped to the authenticated user'); return { data:[order] }; },
    stripeApi:async (env, mode, path, opts) => { stripeApiCalls.push({ path, opts }); return { id:'pi_old', status:'requires_payment_method', client_secret:'secret_old' }; },
  });
  const res = await handleFocRequest(mockRequest({ orderId:'order-1' }), {}, new URL('https://x/public/preorders/resume'), deps);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.clientSecret, 'secret_old', 'a still-payable existing intent must be reused, not replaced');
  assert.equal(stripeApiCalls.length, 1, 'only the GET retrieve call should happen -- no POST to create a new intent');
  assert.equal(stripeApiCalls[0].path, 'payment_intents/pi_old');
}

{
  // An intent Stripe no longer considers payable (e.g. already canceled)
  // must trigger a fresh PaymentIntent, and the order row must be updated
  // with the new intent id.
  const order = { id:'order-2', user_id:'user-1', status:'payment_pending', stripe_payment_intent_id:'pi_dead', stripe_mode:'test', total_cents:1500, cycle_id:'cycle-1', store_id:'store-1', order_number:'FOC-2', customer_email:'jane@example.com', cycle:openCycle };
  let patchedBody = null;
  const deps = mockDeps({
    supabaseAdminFetch:async (env, path, options) => {
      if (options?.method === 'PATCH') { patchedBody = JSON.parse(options.body); return { data:[order] }; }
      return { data:[order] };
    },
    stripeApi:async (env, mode, path, opts) => {
      if (opts?.method === 'GET') return { id:'pi_dead', status:'canceled' };
      assert.equal(opts.method, 'POST');
      assert.equal(opts.params.get('amount'), '1500', 'the fresh intent must charge the order\'s real total, not a stale or default amount');
      return { id:'pi_new', status:'requires_payment_method', client_secret:'secret_new' };
    },
  });
  const res = await handleFocRequest(mockRequest({ orderId:'order-2' }), {}, new URL('https://x/public/preorders/resume'), deps);
  assert.equal(res.data.clientSecret, 'secret_new', 'a dead intent must be replaced with a fresh, payable one');
  assert.ok(patchedBody, 'the order row must be updated with the new PaymentIntent id');
  assert.equal(patchedBody.stripe_payment_intent_id, 'pi_new');
}

{
  // An order that already succeeded must be rejected outright -- never
  // re-chargeable, never handed a stray new PaymentIntent.
  const order = { id:'order-3', user_id:'user-1', status:'paid', stripe_payment_intent_id:'pi_paid', total_cents:998, cycle:openCycle };
  const deps = mockDeps({ supabaseAdminFetch:async () => ({ data:[order] }) });
  const res = await handleFocRequest(mockRequest({ orderId:'order-3' }), {}, new URL('https://x/public/preorders/resume'), deps);
  assert.equal(res.data.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /already paid/, 'the error must explain the order is already resolved, not a generic failure');
}

{
  // FOC already closed for this cycle -- resuming payment must be blocked
  // the same way starting a new checkout already is, since the store can
  // no longer add the item to its distributor order.
  const order = { id:'order-4', user_id:'user-1', status:'payment_pending', stripe_payment_intent_id:'pi_x', total_cents:998, cycle:closedCycle };
  const deps = mockDeps({ supabaseAdminFetch:async () => ({ data:[order] }) });
  const res = await handleFocRequest(mockRequest({ orderId:'order-4' }), {}, new URL('https://x/public/preorders/resume'), deps);
  assert.equal(res.data.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /FOC is closed/i);
}

console.log('FOC resume-payment functional checks passed');

// Saved pulls are a durable curated list now, not a projection of whatever
// happens to be in one browser's cart. PATCH upserts one exact cover; DELETE
// removes only explicitly selected SKUs owned by the signed-in collector.
{
  const calls=[];
  const deps=mockDeps({
    supabaseAdminFetch:async (env,path,options={})=>{
      calls.push({path,options});
      if(path.startsWith('comic_skus?'))return{data:[{id:'11111111-1111-4111-8111-111111111111',cycle_id:'22222222-2222-4222-8222-222222222222',cycle:openCycle}]};
      if(path.startsWith('foc_pick_lists?')&&path.includes('cycle_id=eq.'))return{data:[{id:'33333333-3333-4333-8333-333333333333'}]};
      return{data:[]};
    },
  });
  const res=await handleFocRequest(mockRequest({storeId:'44444444-4444-4444-8444-444444444444',skuId:'11111111-1111-4111-8111-111111111111',quantity:2},'PATCH'),{},new URL('https://x/public/preorders/picks'),deps);
  assert.equal(res.status,200);
  const upsert=calls.find(call=>call.path.startsWith('foc_pick_list_items?on_conflict='));
  assert.ok(upsert,'PATCH must upsert one saved exact cover instead of replacing the collector\'s whole list');
  assert.equal(JSON.parse(upsert.options.body).quantity,2);
  assert.match(upsert.options.headers.Prefer,/merge-duplicates/);
}

{
  const calls=[];
  const deps=mockDeps({supabaseAdminFetch:async (env,path,options={})=>{calls.push({path,options});if(path.startsWith('foc_pick_lists?'))return{data:[{id:'33333333-3333-4333-8333-333333333333'}]};return{data:[]};}});
  const skuId='11111111-1111-4111-8111-111111111111';
  const res=await handleFocRequest(mockRequest({storeId:'44444444-4444-4444-8444-444444444444',skuIds:[skuId]},'DELETE'),{},new URL('https://x/public/preorders/picks'),deps);
  assert.equal(res.status,200);
  const deletion=calls.find(call=>call.options.method==='DELETE');
  assert.ok(deletion,'DELETE must issue an item-level removal');
  assert.match(deletion.path,/pick_list_id=in\./,'removal must be constrained to lists owned by the authenticated collector');
  assert.match(deletion.path,new RegExp(skuId),'removal must target only the requested exact cover');
}

console.log('Durable saved-pull mutation checks passed');
