import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: tab is registered and role/plan gated like every other tab ──
assert.match(dashboard, /\['scout', 'POCKET SCOUT'\]/, 'Pocket Scout must be registered in the primary tab list');
assert.match(dashboard, /<div id="tab-scout" class="tab-panel">/, 'a dedicated #tab-scout panel must exist');
assert.match(dashboard, /scout:'inventory'/, 'Pocket Scout must be capability-gated like other tabs (no plan bypass)');
assert.match(dashboard, /'pos','whatnot','scout','alerts'/, 'employee role must be able to reach the scout tab (front-line staff use this in-store)');

// ── Contract: multi-photo session state, not a one-shot scan ──
assert.match(dashboard, /let scoutSession = null;/, 'a session object must persist across multiple photos');
assert.match(dashboard, /scoutSession\.photos\.push\(/, 'each analyzed photo must be appended to the session, not replace it');

// ── Contract: evidence fusion prefers higher confidence, never blindly overwrites ──
assert.match(worker, /if \(newConfidence >= priorConfidence\) \{/, 'fusing a new photo\'s identity must compare confidence before overwriting an existing field');
assert.match(worker, /conflicts\.push\(\{ field, kept: existing, discarded: incoming/, 'a lower-confidence conflicting read must be logged, not silently dropped');

// ── Contract: identify + eBay image search run concurrently, not sequentially ──
assert.match(worker, /const \[visionResult, imageSearchResult\] = await Promise\.all\(\[/, 'vision identify and eBay image search must run concurrently per photo');

// ── Contract: active vs sold pricing is never conflated ──
assert.match(worker, /soldWarning = 'Sold history unavailable'/, 'sold comps must explicitly say when unavailable rather than silently substituting active prices');
assert.match(worker, /activeStats,\s*soldStats,\s*soldWarning/, 'comp snapshot must carry active and sold stats as separate fields');

// ── Contract: sold comps must not silently go to zero for trading cards.
// The identity prompt deliberately leaves brand/manufacturer/title/model/
// year blank for category:trading_card (expects the Research handoff
// instead of a guess), which left textQuery empty for every card -- active
// comps still worked (image search needs no text query) but sold comps
// only ever run when textQuery is non-empty, so sold comps silently never
// ran for a single trading card. Confirmed live: 20 active comps, 0 sold,
// every time. __textEvidence (OCR'd text, captured regardless of category)
// is the real fallback query. It accumulates oldest-first (each photo's
// fragments appended to the end), so the fallback must take the LAST N
// entries -- the freshest read, often the back-of-card photo with the card
// number / print run -- not the first N (which grabbed only the oldest,
// front-photo-only text and silently dropped everything read later). ──
{
  const textQueryStart = worker.indexOf("const queryParts = [fused.brand, fused.manufacturer, fused.title || fused.characterOrSubject, fused.model, fused.year].filter(Boolean);");
  assert(textQueryStart >= 0, 'the per-photo comp query builder must exist');
  const textQuerySlice = worker.slice(textQueryStart, textQueryStart + 400);
  assert.match(textQuerySlice, /\(fused\.__textEvidence \|\| \[\]\)\.slice\(-6\)\.join\(' '\)\.trim\(\)\.slice\(0, 120\)/, 'when the identity has no queryable fields (every trading card), textQuery must fall back to the MOST RECENT OCR\'d textEvidence, not the oldest');
}

// ── Contract: active and sold comp lookups must run concurrently, not
// sequentially -- enabling sold comps for trading cards above means this
// block now actually runs on every card scan (previously skipped entirely
// since textQuery was always empty), and awaiting the two eBay calls one
// after another visibly slowed every trading-card scan down. ──
assert.match(worker, /const \[activeResult, soldResult\] = await Promise\.all\(\[\s*textQuery \? fetchEbayActiveListings\(env, textQuery, \{ limit: 20 \}\)\.catch\(\(\) => \(\{ listings: \[\] \}\)\) : Promise\.resolve\(\{ listings: \[\] \}\),\s*textQuery \? fetchSoldCompsWithFallback\(env, textQuery, 30\)\.catch\(\(\) => \(\{ comps: \[\], warning: 'Sold comp lookup failed' \}\)\) : Promise\.resolve\(\{ comps: \[\], warning: null \}\),\s*\]\);/, 'active and sold comp lookups must be parallelized with Promise.all, not awaited one after another');

// ── Contract: junk filtering happens before stats, median before average ──
assert.match(worker, /POCKET_SCOUT_JUNK_TERMS = \/\\b\(lot of\|bundle\|wholesale\|reprint/, 'obvious mismatches (lots, reprints, parts-only) must be filtered before pricing math');
assert.match(worker, /median: Math\.round\(use\[Math\.floor\(use\.length \/ 2\)\] \* 100\) \/ 100,/, 'comp stats must compute a real median, not just an average');

// ── Contract: BUY is never automatic on ROI% alone ──
assert.match(dashboard, /if\(netMid>=s\.preferredProfit && roiPct>=s\.minRoiPct && confidence>=s\.minConfidenceForBuy\)/, 'GREAT BUY must require dollar profit AND roi AND confidence, not any single metric');
assert.match(dashboard, /} else if\(netMid>=s\.minProfit && confidence>=60\)\{/, 'BUY must still be gated on a minimum dollar profit, not just a good ROI%');

// ── Contract: rejecting a candidate recalculates rather than just hiding it ──
assert.match(worker, /status=eq\.pending&select=payload`\);/, 'rejecting a candidate must recompute stats from the remaining pending candidates');

// ── Contract: add-to-inventory reuses the existing SKU generator + direct Supabase insert, not a new inventory system ──
assert.match(dashboard, /generateWalkoffInventorySku\(category, \{ name: match\?\.name \|\| identity\.title/, 'Pocket Scout must reuse the existing SKU generator');

// ── Contract: a bulk sourcing trip can queue scouted items into the Buy
// List tray (Intake tab) instead of writing to inventory one at a time --
// reusing the existing buy/trade-in tray + accept flow rather than a new
// bulk-insert path. Unlike BUY + ADD INVENTORY (an immediate purchase that
// needs a real known cost), queueing to the tray does NOT require a store
// price -- the tray's own offer % does that math once accepted. What it
// does need is a comp price (the 100% basis that % is applied against),
// which the operator can see prefilled and can edit before sending. ──
assert.match(dashboard, /<button class="hbtn" id="scout-buy-tab-btn" onclick="scoutSendToBuyTab\(\)"/, 'a SEND TO BUY TAB button must exist alongside BUY + ADD INVENTORY');
assert.match(dashboard, /<input id="scout-comp-price" type="number"/, 'an editable comp-price field must exist so the operator controls the 100% basis sent to the buy tray');
assert.match(dashboard, /function scoutSendToBuyTab\(\)\{/, 'a dedicated handler must queue the scouted item into the buy tray');
assert.match(dashboard, /const compPrice = Number\(compPriceEl\?\.value\) \|\| match\?\.market \|\| scoutSession\.lastDecision\?\.expectedSale \|\| 0;/, 'sending to the buy tray must use the editable comp price, then a matched catalog price, then the computed expected sale -- never the store-price field');
assert.match(dashboard, /if\(!\(compPrice>0\)\)\{ toast_dash\('Enter a comp price first'\)/, 'sending to the buy tray must require a comp price, not a store price');
assert.doesNotMatch(dashboard.slice(dashboard.indexOf('function scoutSendToBuyTab'), dashboard.indexOf('function scoutSendToBuyTab') + 3200), /manualOfferOverride/, 'the queued item must use the tray\'s normal percent-of-market offer math (buyItemOfferValue), not a manual override that bypasses the buy %');
assert.match(dashboard, /market: compPrice,/, 'the queued item\'s market must be the chosen comp price, so the tray\'s offer % (e.g. 80% of $100 = $80) applies to it like any other buy-tray item');
assert.match(dashboard, /imageUrl: photoUrls\[0\] \|\| match\?\.imageUrl \|\| '', images: photoUrls,/, 'every photo taken in the scout session, not just the first, must ride along to the buy tray so it survives into the eventual inventory record, and the operator\'s own photo must win over a catalog match\'s stock image');
assert.match(dashboard, /buyList\.push\(item\);\s*\n\s*saveBuyList\(\);\s*\n\s*logOpsEvent\('buy_item_added', 'Sent Pocket Scout item to buy tray/, 'sending to the buy tray must reuse the existing buyList array + saveBuyList persistence, not a separate bulk-buy data model');
assert.match(dashboard, /sb\.from\('inventory_items'\)\.insert\(\[row\]\)/, 'Pocket Scout must write inventory the same way every other add-to-inventory flow does (direct client Supabase insert), not a parallel backend table');

// ── Contract: photos taken in a scout session become the inventory item's
// images (all of them, not just the first) whether the item goes straight
// to inventory (BUY + ADD INVENTORY) or via the buy tray -- and that image
// data must actually reach the final inventory row's data, not get dropped
// by buyItemToInventoryUpdates() along the way (a real pre-existing gap:
// that function built the inventory update object from scratch and never
// carried image/imageUrl over at all). ──
assert.match(dashboard, /images: \(scoutSession\.photos\|\|\[\]\)\.map\(p=>p\.url\)\.filter\(Boolean\),/, 'BUY + ADD INVENTORY must save every scout photo, not just the first, as the item\'s images');
assert.match(dashboard, /image:item\.imageUrl \|\| item\.images\?\.\[0\] \|\| '',\s*\n\s*images:\(item\.images && item\.images\.length\) \? item\.images : \(item\.imageUrl \? \[item\.imageUrl\] : \[\]\),/, 'buyItemToInventoryUpdates must explicitly carry the buy-tray item\'s photo(s) into the inventory update, not rely on an incidental object-spread that only works when the item has no .scan');

// ── Contract: trading cards / sports cards / comics can be matched against
// the real PriceCharting/TCGPlayer catalog WITHOUT switching to the Research
// tab -- switching away broke scanning items back-to-back, which is the
// whole point of Pocket Scout. Reuses searchQuickCatalog() (the same
// catalog search the buy tray's own auto-lookup already calls) rendered
// into a dedicated modal instead of duplicating Research's tab-coupled
// search/render logic or navigating away from it. ──
assert.match(dashboard, /<div id="scout-catalog-modal" class="barcode-modal-overlay"/, 'a dedicated in-tab catalog-match modal must exist, reusing the shared barcode modal CSS');
assert.match(dashboard, /function scoutOpenCatalogSearch\(prefillQuery\)\{/, 'a dedicated function must open the catalog modal without switching tabs');
assert.doesNotMatch(dashboard.slice(dashboard.indexOf('function scoutOpenCatalogSearch'), dashboard.indexOf('function scoutOpenCatalogSearch')+1200), /switchTab\(/, 'opening the catalog match modal must never switch tabs -- that was the whole complaint');
assert.match(dashboard, /const matches = isUrl \? await scoutResolveCatalogUrl\(query\) : await searchQuickCatalog\(query, ''\);/, 'the in-tab catalog search must reuse the shared catalog search function, not duplicate Research\'s search logic');
assert.match(dashboard, /function scoutSelectCatalogMatch\(i\)\{/, 'picking a result must be a dedicated action');
assert.match(dashboard, /scoutSession\.catalogMatch = match;/, 'picking a catalog result must attach it to the scout session so BUY \+ ADD INVENTORY \/ SEND TO BUY TAB can use it');
assert.match(dashboard, /function scoutUseCompAsCatalogQuery\(candidateId\)\{/, 'picking an eBay comp as the correct card must be possible, feeding its exact listing title into the catalog search');
assert.match(dashboard, /onclick="scoutUseCompAsCatalogQuery\('\$\{escHtml\(c\.id\|\|''\)\}'\)">USE THIS<\/button>/, 'each eBay comp row must offer a USE THIS action, not just NOT A MATCH');

// ── Contract: Pokemon/comic results frequently come back from
// searchQuickCatalog() with no imageUrl (Research itself only fills these
// in with a second async lookup -- resolvePokemonCatalogImagesForVisibleCards/
// lazyLoadComicImages), and the modal's meta line (set/card number/variant,
// e.g. a parallel's "/250" print run) must never be clipped with an
// ellipsis -- that's exactly the detail that tells two similar results
// apart. Confirmed live: results showed with no pictures and a cut-off
// meta line. ──
assert.match(dashboard, /async function scoutHydrateCatalogImages\(\)\{/, 'a dedicated image-hydration pass must exist for rows searchQuickCatalog returned with no imageUrl');
assert.match(dashboard, /scoutHydrateCatalogImages\(\);/, 'the hydration pass must actually run after rendering search results');
{
  const fnStart = dashboard.indexOf('async function scoutHydrateCatalogImages(){');
  const fnEnd = dashboard.indexOf('\n}', fnStart);
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.doesNotMatch(fn, /catKey === 'pokemon'/, 'Pokemon has no offline image catalog to resolve against -- there must be no Pokemon branch left here');
  assert.match(fn, /if\(catKey === 'comic'\) \{/, 'must resolve missing comic cover images the same way Research does');
  assert.match(fn, /document\.getElementById\('scout-catalog-img-'\+i\)/, 'a resolved image must patch this exact row\'s own image slot, not re-render the whole list');
}
assert.doesNotMatch(dashboard.slice(dashboard.indexOf("const query = document.getElementById('scout-catalog-query')"), dashboard.indexOf('scoutHydrateCatalogImages();')), /white-space:nowrap/, 'the result meta line (set/card number/variant, including a parallel\'s print-run fraction) must wrap instead of being clipped with an ellipsis');

// ── Contract: card_number was hardcoded blank for every PriceCharting-
// sourced result regardless of source data, and no print-run field existed
// at all -- both are exactly the detail (e.g. "#91" and, for a numbered
// parallel, "/250") that tells two similar sports/graded card results
// apart. Confirmed live: a real "Purple /250" search showed neither.
// PriceCharting's product name usually carries both, so they're parsed out
// instead of discarded. ──
{
  const mappedStart = dashboard.indexOf('const mapped = rows.map(m => {');
  assert(mappedStart >= 0, 'the PriceCharting live-catalog row builder must exist');
  const mappedSlice = dashboard.slice(mappedStart, mappedStart + 3600);
  assert.match(mappedSlice, /const cardNumMatch = productName\.match\(\/#\(\\d\+\[A-Za-z\]\?\)\/\);/, 'must parse the card number out of PriceCharting\'s product name');
  assert.match(mappedSlice, /const printRunMatch = productName\.match\(\/\\\/\\s\*\(\\d\{1,4\}\)\\b\/\);/, 'must parse a numbered parallel\'s print run out of PriceCharting\'s product name');
  assert.match(mappedSlice, /card_number:cardNumMatch \? cardNumMatch\[1\] : '',/, 'card_number must actually use the parsed match, not stay hardcoded blank');
  assert.match(mappedSlice, /printRun:printRunMatch \? printRunMatch\[1\] : '',/, 'the parsed print run must be exposed on the row');
  assert.match(mappedSlice, /productId:m\.productId \|\| m\.id \|\| '',/, 'the row must carry the product id so a later per-item image/detail lookup is possible');
  // Store report (later, after a live screenshot of the actual stray
  // dropdown option): a sports card's Category was STILL landing as the
  // raw PriceCharting console/set name (e.g. "Baseball Cards 2023 Topps")
  // even after the fix above, because that fix only forced category:
  // 'Sports' when the SEARCH ITSELF was already scoped to sports (isSports)
  // -- a plain Research-tab search for a card by name with no category
  // filter selected first left isSports false even for a genuine baseball
  // card. Detects it from the actual returned product's own console name
  // too, not only from how the search was scoped.
  assert.match(mappedSlice, /const looksLikeSports = isSports \|\| \/sport\|\\b\(\?:baseball\|football\|basketball\|hockey\|soccer\|wrestling\|racing\)\\b\/i\.test\(m\.consoleName \|\| ''\);/,
    'must also detect sports from the returned product\'s own console name, not only from whether the search was pre-scoped to sports');
  assert.match(mappedSlice, /category:looksLikeSports \? 'Sports' : \(m\.consoleName \|\| cat \|\| 'Collectibles'\),/,
    'a sports card must set category to the fixed "Sports" bucket, not the raw console/set name');
}
assert.match(dashboard, /function scoutCatalogMetaHtml\(r\)\{/, 'the meta line (set/card number/print run/variant + view link) must be its own function, since hydration re-renders it in place once richer data arrives');
assert.match(dashboard, /r\.printRun\?'\/'\+r\.printRun:'',r\.variant\]/, 'the meta line must actually show the print run, not just parse/fetch it and drop it');
assert.match(dashboard, /r\.productUrl\?` · <a href="\$\{escHtml\(r\.productUrl\)\}" target="_blank" rel="noopener" style="color:var\(--blue\)">view<\/a>`:''/, 'each catalog result must offer a "view" link to the source product page, so a still-missing photo does not block confirming the exact card');

// ── Contract: PriceCharting's OWN game/console API schema has no concept
// of a card number or print run at all -- confirmed live against a real
// numbered parallel ("Purple /250"): PriceCharting's product name for it
// didn't contain the print run because the field doesn't exist in that
// schema. SportsCardsPro is PriceCharting's own sports-card-specific
// dataset, sharing the SAME numeric product id (confirmed: SportsCardsPro's
// own product page literally labels it "PriceCharting ID"), and its
// product schema DOES carry card-number/print-run as real fields
// (confirmed live: "Card Number: #91", "Print Run: 250" on their page for
// the exact same id) -- so a capped number of PriceCharting/SportsCardsPro
// rows missing an image or missing card_number/printRun get looked up
// there, not left blank or guessed from the name alone. ──
assert.match(dashboard, /card_number:\s*String\(p\['card-number'\] \|\| p\.cardNumber \|\| \(numM \? numM\[1\] : ''\) \|\| ''\),/, 'scpProductToQplRow must read the real card-number field, not only ever regex it out of the name');
assert.match(dashboard, /printRun:\s*String\(p\['print-run'\] \|\| p\.printRun \|\| ''\),/, 'scpProductToQplRow must read the real print-run field');
assert.match(dashboard, /card_number:\s*String\(p\['card-number'\] \|\| p\.cardNumber \|\| baseRow\.card_number \|\| ''\),/, 'scpDetailToQplRow (the fully-hydrated single-product response) must also read card-number');
assert.match(dashboard, /printRun:\s*String\(p\['print-run'\] \|\| p\.printRun \|\| baseRow\.printRun \|\| ''\),/, 'scpDetailToQplRow must also read print-run');
{
  const fnStart = dashboard.indexOf('async function scoutHydrateCatalogImages(){');
  const fnEnd = dashboard.indexOf('\nfunction scoutSelectCatalogMatch', fnStart);
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /\(r\.source === 'PriceCharting' \|\| r\.source === 'sportscardspro'\) && \(r\.productId \|\| r\.scpId\) && catKey !== 'pokemon' && catKey !== 'comic' && \(!r\.imageUrl \|\| !r\.card_number \|\| !r\.printRun\) && priceChartingHydrated < 6/, 'must be capped, and must trigger on a missing card_number/printRun too, not only a missing image');
  // The single-product SportsCardsPro API (/pricing/sportscardspro/product)
  // needs its own paid SCP_ACCESS_TOKEN, which stores that only have a
  // PriceCharting key don't have -- confirmed with the actual store owner
  // (no SCP subscription). /pricing/sportscardspro/image instead scrapes
  // SCP's public product page for card number / print run (same technique,
  // and same route, as the existing token-free image scrape), so this must
  // hit that route, not the token-gated one.
  assert.match(fn, /WORKER \+ '\/pricing\/sportscardspro\/image\?' \+ params\.toString\(\)/, 'must hit the token-free SportsCardsPro image/page-scrape route, not the paid single-product API');
  assert.doesNotMatch(fn, /\/pricing\/sportscardspro\/product\?id=/, 'must not depend on the paid SCP_ACCESS_TOKEN-gated endpoint for card number / print run');
  assert.match(fn, /if\(cardNum && cardNum !== r\.card_number\) \{ r\.card_number = cardNum; metaChanged = true; \}/, 'a newly-found card number must actually update the row');
  assert.match(fn, /if\(printRun && printRun !== r\.printRun\) \{ r\.printRun = printRun; metaChanged = true; \}/, 'a newly-found print run must actually update the row');
  assert.match(fn, /if\(metaChanged\) \{\s*\n\s*const metaEl = document\.getElementById\('scout-catalog-meta-'\+i\);\s*\n\s*if\(metaEl\) metaEl\.innerHTML = scoutCatalogMetaHtml\(r\);/, 'a newly-found card number/print run must actually re-render onto the visible meta line, not just sit on the row object unseen');
  assert.match(fn, /if\(!url && r\.source === 'PriceCharting' && r\.productId\) \{/, 'when SportsCardsPro has no image, PriceCharting\'s own single-product endpoint must still be tried for the image');
  assert.match(fn, /WORKER \+ '\/pricing\/pricecharting\/product\/' \+ encodeURIComponent\(r\.productId\)/, 'the PriceCharting image fallback must hit the single-product endpoint (og:image scrape fallback), not the search endpoint');
}
// The Worker route itself must scrape SportsCardsPro's public page (no
// token required) for card number / print run, not require SCP_ACCESS_TOKEN.
assert.match(worker, /Card number and print run only exist on SportsCardsPro's own schema/, 'the token-free scrape route must exist and be documented as the primary path for card number / print run');
assert.match(worker, /const cardNumMatch = scpHtml\.match\(\/Card Number/, 'the /pricing\\/sportscardspro\\/image route must scrape "Card Number" text off SCP\'s public page');
assert.match(worker, /const printRunMatch = scpHtml\.match\(\/Print Run/, 'the /pricing\\/sportscardspro\\/image route must scrape "Print Run" text off SCP\'s public page');
assert.match(worker, /return json\(\{ ok: true, imageUrl: imageUrl \|\| null, cardNumber, printRun \}\);/, 'the route must return cardNumber/printRun alongside imageUrl');

// Store report: scoutHydrateCatalogImages() already successfully scrapes a
// numbered card's print run onto scoutSession.catalogMatch.printRun (tested
// above), but neither way of actually getting a scouted item into inventory
// ever read it -- both hand-offs dropped it on the floor even though it had
// already been found, so it never reached the Serial #/Numbered field or
// the printed label.
{
  const sendToBuyStart = dashboard.indexOf('function scoutSendToBuyTab(){');
  const sendToBuyEnd = dashboard.indexOf('\n}', sendToBuyStart) + 2;
  const sendToBuyFn = dashboard.slice(sendToBuyStart, sendToBuyEnd);
  assert.match(sendToBuyFn, /serial_number: match\?\.printRun \? '\/' \+ match\.printRun : '',/,
    'scoutSendToBuyTab (queue into the Buy tray) must carry the catalog match\'s print run into serial_number -- buyItemToInventoryUpdates already passes serial_number through once accepted');
  // Store report: cards added through Pocket Scout had no PriceCharting
  // product page link saved at all -- also feeds the printed label's QR
  // code (labelQrPayload reads item.providerUrl).
  assert.match(sendToBuyFn, /providerUrl: match\?\.productUrl \|\| match\?\.url \|\| '',/,
    'scoutSendToBuyTab must carry the catalog match\'s product URL into providerUrl');
}
{
  const buyAddStart = dashboard.indexOf('async function scoutBuyAddInventory(){');
  const buyAddEnd = dashboard.indexOf('\n}', buyAddStart) + 2;
  const buyAddFn = dashboard.slice(buyAddStart, buyAddEnd);
  assert.match(buyAddFn, /serial_number: match\?\.printRun \? '\/' \+ match\.printRun : '',/,
    'scoutBuyAddInventory (direct one-shot buy+add) must also carry the catalog match\'s print run into serial_number');
  assert.match(buyAddFn, /providerUrl: match\?\.productUrl \|\| match\?\.url \|\| '',/,
    'scoutBuyAddInventory must also carry the catalog match\'s product URL into providerUrl');
}
// buyItemToInventoryUpdates() (the buy-tray -> inventory conversion used by
// EVERY accepted buy, not just Pocket Scout's) had no providerUrl field at
// all -- even a buy-tray item that already carried it (scoutSendToBuyTab,
// after the fix above) would have had it silently dropped right here.
{
  const mapperStart = dashboard.indexOf('function buyItemToInventoryUpdates(item){');
  const mapperEnd = dashboard.indexOf('\n}', mapperStart) + 2;
  const mapperFn = dashboard.slice(mapperStart, mapperEnd);
  assert.match(mapperFn, /providerUrl:item\.providerUrl \|\| '',/,
    'buyItemToInventoryUpdates must carry providerUrl through from the buy-tray item into the inventory row it builds');
}

// The main Research/Quick Lookup search (a separate flow from Pocket Scout,
// used for the general "add from search" path) has no equivalent hydration
// at all for PriceCharting-sourced results -- PriceCharting's own API has
// no print-run field (confirmed: not part of its game/console schema), and
// this store has no paid SCP_ACCESS_TOKEN, so the only way to get it is the
// same token-free SportsCardsPro page-scrape route Pocket Scout already
// uses. Scoped to sports-category results only (print run is meaningless
// for other categories) and throttled the same way as the existing image
// hydration it's modeled on.
assert.match(dashboard, /async function enrichPcPrintRunsAsync\(\)\{/, 'missing enrichPcPrintRunsAsync');
{
  const enrichStart = dashboard.indexOf('async function enrichPcPrintRunsAsync(){');
  const enrichEnd = dashboard.indexOf('\n}', enrichStart) + 2;
  const enrichFn = dashboard.slice(enrichStart, enrichEnd);
  assert.match(enrichFn, /r&&r\.source==='PriceCharting'&&!r\.printRun&&r\.name&&qplResultCategoryKey\(r\)==='sports'/, 'must only target PriceCharting-sourced sports results missing a print run');
  assert.match(enrichFn, /WORKER\+'\/pricing\/sportscardspro\/image\?'\+params/, 'must hit the token-free SportsCardsPro page-scrape route, not a paid SCP endpoint');
  assert.doesNotMatch(enrichFn, /\/pricing\/sportscardspro\/product\?id=/, 'must not depend on the paid SCP_ACCESS_TOKEN-gated single-product endpoint');
  assert.match(enrichFn, /qplResults\[idx\]\.printRun=d\.printRun;/, 'a found print run must actually be written back onto the result row');
  assert.match(enrichFn, /if\(typeof updateQplResultCard==='function'\)updateQplResultCard\(idx\);/, 'a found print run must re-render onto the visible result card, not just sit on the row object unseen');
}
assert.match(dashboard, /if\(qplResults\.some\(r => r\.source === 'PriceCharting' && !r\.printRun && qplResultCategoryKey\(r\) === 'sports'\)\) enrichPcPrintRunsAsync\(\);/,
  'print-run enrichment must be triggered independently of image hydration -- a result can already have its image (common) while still missing a print run PriceCharting\'s API never returns');

// A blank title + 0% confidence on a trading card is the model working as
// designed (see POCKET_SCOUT_IDENTITY_PROMPT), not a broken scan -- it must
// not render as "Unidentified item" / red "INSUFFICIENT DATA", which reads
// as an error.
assert.match(dashboard, /\(scoutSession\.routeToCardPipeline \? 'Trading card \/ sports card \/ comic' : 'Unidentified item'\)/, 'a title-less trading card must get a card-specific label, not the generic no-data one');
assert.match(dashboard, /if\(scoutSession\.routeToCardPipeline && !id\.title\)\{/, 'the confidence badge must special-case a title-less trading card instead of showing a scary 0%/red insufficient-data state for expected behavior');
// A picked catalog match must actually override the buy-tray output --
// checked structurally against the two add paths above, not just displayed.
assert.match(dashboard, /const category = match \? normalizeQuickCategory\(match\.category\) : scoutInventoryCategory\(identity\);/, 'a matched catalog card\'s real category must be used instead of the generic Collectibles bucket, in both add-to-inventory paths', );
assert.match(dashboard, /sourceProductId: match\?\.pricechartingProductId \|\| match\?\.productId \|\| '',/, 'the buy-tray item must carry the matched catalog product\'s id so it stays connected once accepted into inventory');
// Picking a catalog match is a deliberate operator action, not a passive
// re-render -- unlike scoutRenderResult's own comp-price prefill (which must
// never clobber a typed value), selecting a match must overwrite the
// comp-price field even if a rougher eBay-comp estimate was already there,
// since that's the whole point of confirming the exact card. Both add paths
// (direct buy and send-to-buy-tab) read that same field, so this is what
// makes the matched price actually flow through to both.
{
  const selectFnStart = dashboard.indexOf("function scoutSelectCatalogMatch(i){");
  const selectFnEnd = dashboard.indexOf('\nfunction scoutClearCatalogMatch', selectFnStart);
  const selectFn = dashboard.slice(selectFnStart, selectFnEnd);
  assert.match(selectFn, /if\(compPriceEl && Number\(match\.market\|\|0\)>0\) compPriceEl\.value = match\.market;/, 'selecting a catalog match must overwrite scout-comp-price unconditionally, not only when it was empty');
  assert.doesNotMatch(selectFn, /!compPriceEl\.value && Number\(match\.market/, 'must not still gate the overwrite on the field being empty');
  assert.match(selectFn, /scoutRefreshCompsForMatch\(match\);/, 'selecting a catalog match must re-run comps off the exact matched card, not leave the rougher scan-derived comps in place');
}
assert.match(dashboard, /market: Number\(document\.getElementById\('scout-comp-price'\)\?\.value\) \|\| match\?\.market \|\| result\?\.expectedSale \|\| null,/, 'the direct-buy path must save the same comp-price the operator sees (which a selected catalog match now sets) as the inventory market value, not silently ignore it in favor of a stale decision-engine estimate');
// A matched card's own comps must be searched off ITS name/set/card number
// (a specific parallel like the /250), not the rougher scan/manual query
// that mixes every parallel of the card together -- and must only replace
// the comps, never the real scan identity or the catalogMatch itself.
assert.match(dashboard, /async function scoutRefreshCompsForMatch\(match\)\{/, 'a dedicated comp-refresh function must exist for a confirmed catalog match');
assert.match(dashboard, /storeWorkerFetch\('\/pocket-scout\/session\/manual-search', \{ method:'POST', headers:\{'Content-Type':'application\/json'\}, body:JSON\.stringify\(\{ sessionId:scoutSession\.id, query \}\) \}\);/, 'the comp refresh must reuse the existing manual-search route, not a bespoke lookup');
{
  const refreshFnStart = dashboard.indexOf('async function scoutRefreshCompsForMatch(match){');
  const refreshFnEnd = dashboard.indexOf('\nfunction scoutClearCatalogMatch', refreshFnStart);
  const refreshFn = dashboard.slice(refreshFnStart, refreshFnEnd);
  assert.match(refreshFn, /scoutSession\.candidates = data\.candidates\|\|\[\];/, 'the refreshed candidates must replace the stale ones');
  assert.match(refreshFn, /scoutSession\.compSnapshot = data\.compSnapshot\|\|null;/, 'the refreshed comp snapshot must replace the stale one');
  assert.doesNotMatch(refreshFn, /scoutSession\.identity\s*=/, 'must not overwrite the real scan identity with manual-search\'s own generic {title,confidence:60} response');
  assert.doesNotMatch(refreshFn, /scoutSession\.catalogMatch\s*=/, 'must not touch catalogMatch -- this only refreshes comps, the match itself is already set by the caller');
}
// The operator's own photo of the physical item, not the catalog match's
// stock photo, must be what actually gets saved as the inventory image --
// the catalog photo is only useful for confirming identity mid-match.
assert.match(dashboard, /image: scoutSession\.photos\?\.\[0\]\?\.url \|\| match\?\.imageUrl \|\| '',/, 'the direct-buy path must prefer the operator\'s own scan photo over the catalog match\'s stock image');
assert.match(dashboard, /imageUrl: photoUrls\[0\] \|\| match\?\.imageUrl \|\| '', images: photoUrls,/, 'the buy-tray path must prefer the operator\'s own scan photo over the catalog match\'s stock image');

// ── Contract: pasting a PriceCharting/SportsCardsPro product-page URL into
// the catalog search box resolves it directly -- typing it in used to just
// run the raw URL string through the fuzzy text search and return 25
// unrelated junk results (Garbage Pail Kids, random comics), even though
// the URL itself already identifies the exact card. ──
assert.match(dashboard, /const SCOUT_CATALOG_URL_RE = \/\^https\?:\\\/\\\/\(\?:www\\\.\)\?\(\?:pricecharting\|sportscardspro\)\\\.com\\\/game\\\//i, 'a URL-detection regex for both catalog domains must exist');
assert.match(dashboard, /const isUrl = SCOUT_CATALOG_URL_RE\.test\(query\);/, 'scoutRunCatalogSearch must detect a pasted catalog URL');
assert.match(dashboard, /const matches = isUrl \? await scoutResolveCatalogUrl\(query\) : await searchQuickCatalog\(query, ''\);/, 'a detected URL must route to the resolver instead of the fuzzy text search');
assert.match(dashboard, /async function scoutResolveCatalogUrl\(pastedUrl\)\{/, 'a dedicated URL-resolver function must exist');
assert.match(dashboard, /WORKER \+ '\/pricing\/sportscardspro\/resolve-url\?' \+ new URLSearchParams\(\{ url:pastedUrl \}\)\.toString\(\)/, 'the resolver must call the dedicated resolve-url Worker route');
// The resolve-url route is a URL fetcher reachable from outside the store --
// it must only ever fetch the two catalog domains it's meant for, never an
// arbitrary caller-supplied host (that would be an open SSRF proxy).
assert.match(worker, /if \(host !== 'pricecharting\.com' && host !== 'sportscardspro\.com'\) \{/, 'the resolve-url route must allowlist only the two catalog hostnames, not fetch any URL a caller supplies');
assert.match(worker, /const slugMatch = parsed\.pathname\.match\(\/\^\\\/game\\\/\(\[\^\/\]\+\)\\\/\(\[\^\/\]\+\)\/\);/, 'the route must require a real product-page path, not just an allowlisted host');
// Store report: SportsCardsPro also serves a short permalink form,
// .../game/<numeric-id> with no console/product slug -- 100+ already-saved
// sports card links used exactly this shape and every one 400'd against the
// slug-only regex above, even though the link opened the correct product
// page in a browser. The short form must resolve too, without breaking the
// long slug form it sits alongside.
assert.match(worker, /const shortIdMatch = !slugMatch \? parsed\.pathname\.match\(\/\^\\\/game\\\/\(\\d\+\)\\\/\?\$\/\) : null;/, 'a bare .../game/<numeric-id> permalink (no slug) must be recognized as its own valid case, not rejected alongside genuine garbage input');
assert.match(worker, /if \(!slugMatch && !shortIdMatch\) return json\(\{ ok: false, error: 'That doesn\\'t look like a product page URL \(expected \.\.\.\/game\/<console>\/<product> or \.\.\.\/game\/<id>\)' \}, 400\);/, 'the 400 must only fire when neither the slug form nor the short-id form matched');
assert.match(worker, /let imageUrl = null, cardNumber = '', printRun = '', priceChartingId = shortIdMatch \? shortIdMatch\[1\] : '';/, 'the short-id form already IS the numeric PriceCharting id -- it must be used directly instead of re-scraping the page for an id it already has');
assert.match(worker, /const scrapeUrl = slugMatch\s*\n\s*\? `https:\/\/www\.sportscardspro\.com\/game\/\$\{consoleSlug\}\/\$\{productSlug\}`\s*\n\s*: `https:\/\/www\.sportscardspro\.com\/game\/\$\{shortIdMatch\[1\]\}`;/, 'the short-id form must scrape its own short URL (SportsCardsPro resolves it to the real page), not try to build a slug URL it has no slug for');
assert.match(worker, /if \(url\.pathname === '\/pricing\/sportscardspro\/resolve-url'\) \{/, 'the resolve-url route must exist');
assert.match(worker, /const idMatch = html\.match\(\/PriceCharting ID\[\^>\]\*>\\s\*\(\?:<\[\^>\]\+>\\s\*\)\*\(\\d\{2,10\}\)\/i\);/, 'the route must scrape the numeric PriceCharting id SCP\'s own page labels, to get the real price via the official API rather than guessing');
assert.match(worker, /const humanize = s => String\(s \|\| ''\)\.replace\(\/-\/g, ' '\)\.replace\(\/\\b\\w\/g, c => c\.toUpperCase\(\)\);/, 'must degrade to a humanized slug name (not blow up or return nothing) when the id/price lookup fails');

console.log('Pocket Scout contract checks passed');

// ── Functional: reimplement the pure decision math and check it against the
// product spec's own worked examples ──
const DEFAULTS = { minProfit:15, preferredProfit:25, minRoiPct:100, minConfidenceForBuy:80, marketplaceFeePct:13.25, paymentFeePct:2.9, paymentFeeFlat:0.30, packagingAllowance:2, defaultShippingBySize:{tiny:5,small:8,medium:13,large:20,oversize:35} };
function computeDecision({ activeMedian, activeLow, activeHigh, soldMedian, purchasePrice, sizeBucket, condition, confidence, settings }){
  const s = settings || DEFAULTS;
  const expectedSale = soldMedian || activeMedian || 0;
  const expectedLow = activeLow!=null ? Math.min(activeLow, expectedSale) : Math.round(expectedSale*0.8*100)/100;
  const expectedHigh = activeHigh!=null ? Math.max(activeHigh, expectedSale) : Math.round(expectedSale*1.2*100)/100;
  const conditionDiscount = { 'New/Sealed':1, 'Excellent':1, 'Good':0.9, 'Fair':0.75, 'Poor':0.55, 'Parts/Repair':0.35 }[condition] ?? 1;
  const saleLow = Math.round(expectedLow*conditionDiscount*100)/100;
  const saleHigh = Math.round(expectedHigh*conditionDiscount*100)/100;
  const feesAt = sale => Math.round((sale*(s.marketplaceFeePct+s.paymentFeePct)/100 + s.paymentFeeFlat)*100)/100;
  const shipping = s.defaultShippingBySize?.[sizeBucket] ?? s.defaultShippingBySize?.medium ?? 10;
  const packaging = s.packagingAllowance ?? 2;
  const netAt = sale => Math.round((sale - feesAt(sale) - shipping - packaging - purchasePrice)*100)/100;
  const netLow = netAt(saleLow), netHigh = netAt(saleHigh);
  const netMid = Math.round(((netLow+netHigh)/2)*100)/100;
  const roiPct = purchasePrice>0 ? Math.round((netMid/purchasePrice)*1000)/10 : (netMid>0 ? Infinity : 0);
  let decision;
  const hasData = expectedSale>0;
  if(!hasData || confidence<50) decision='maybe';
  else if(netMid>=s.preferredProfit && roiPct>=s.minRoiPct && confidence>=s.minConfidenceForBuy) decision='great_buy';
  else if(netMid>=s.minProfit && confidence>=60) decision='buy';
  else if(netMid>0) decision='maybe';
  else decision='pass';
  return { decision, netLow, netHigh, netMid, roiPct };
}

// Spec's own worked example: $44 sale, $6.99 purchase, high confidence should
// clearly be a buy. The reference spec used a single point estimate and a
// flat shipping guess; this implementation uses a conservative low/high
// range and size-bucket shipping instead, so the exact profit dollars won't
// match the spec's narrative numbers -- what must hold is that a genuinely
// strong flip is never rejected or downgraded to a bare "review".
{
  const r = computeDecision({ activeMedian:44.99, activeLow:38, activeHigh:52, soldMedian:41.50, purchasePrice:6.99, sizeBucket:'medium', condition:'Excellent', confidence:94 });
  assert.ok(['buy','great_buy'].includes(r.decision), 'a $40+ item bought for $6.99 at 94% confidence must be at least a BUY');
  assert.ok(r.netMid >= 15, 'net profit on the worked example must clear the minimum profit bar');
  assert.ok(r.roiPct >= 100, 'ROI on the worked example must clear the minimum ROI bar');
}

// Spec's explicit anti-example: $1 -> $4 is 300% ROI but not worth the labor -- must NOT be a buy.
{
  const r = computeDecision({ activeMedian:4, activeLow:3.5, activeHigh:4.5, soldMedian:null, purchasePrice:1, sizeBucket:'tiny', condition:'Excellent', confidence:90 });
  assert.notEqual(r.decision, 'great_buy', 'high ROI% on a trivial dollar amount must not trigger GREAT BUY');
  assert.notEqual(r.decision, 'buy', 'high ROI% on a trivial dollar amount must not trigger BUY either -- absolute profit dollars matter, not just ROI%');
}

// Low confidence must never auto-buy even with a great price.
{
  const r = computeDecision({ activeMedian:100, activeLow:80, activeHigh:120, soldMedian:90, purchasePrice:5, sizeBucket:'medium', condition:'Excellent', confidence:40 });
  assert.equal(r.decision, 'maybe', 'low identification confidence must fall back to MAYBE/REVIEW regardless of price');
}

// No pricing data at all must never fabricate a decision.
{
  const r = computeDecision({ activeMedian:null, activeLow:null, activeHigh:null, soldMedian:null, purchasePrice:5, sizeBucket:'medium', condition:'Excellent', confidence:90 });
  assert.equal(r.decision, 'maybe', 'zero pricing data must never resolve to BUY or PASS -- it is genuinely unknown');
}

// A real loss at the given store price must PASS.
{
  const r = computeDecision({ activeMedian:10, activeLow:8, activeHigh:12, soldMedian:9, purchasePrice:15, sizeBucket:'large', condition:'Good', confidence:90 });
  assert.equal(r.decision, 'pass', 'a store price above the realistic net-of-fees value must PASS');
}

console.log('Pocket Scout decision-engine functional checks passed');
