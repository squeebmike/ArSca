(function(){
'use strict';

// Whatnot bridge -- the two halves of getting inventory into Whatnot and
// sales back out, since Whatnot's Seller API isn't open to new sellers:
//
// 1. SEND TO WHATNOT: builds a CSV in the exact column order of Whatnot's
//    own template (Seller Hub -> Inventory -> Upload CSV, or a show's
//    Add -> Create Temporary Listing -> Upload CSV). Category, Sub Category,
//    Shipping Profile and Condition must match Whatnot's allowed values
//    exactly, so they come from a per-category mapping set once here
//    (optionally checked against the Values tab of Whatnot's template).
//    SKU is the dashboard item id, which is how part 2 finds items again.
//
// 2. IMPORT SHOW RESULTS: reads the show report CSV Whatnot exports after a
//    show, matches each sold row to its item (SKU first, exact title as a
//    fallback the user has to tick), and records each sale through the same
//    /inventory/record-external-sale path as "Sold on Whatnot" -- which also
//    pulls the item from eBay/Shopify. Each row carries a whatnot:<order>
//    reference, so importing the same report twice records nothing new.

var TEMPLATE_HEADER = ['Category','Sub Category','Title','Description','Quantity','Type','Price','Shipping Profile','Offerable','Hazmat','Condition','Cost Per Item','SKU','Image URL 1','Image URL 2','Image URL 3','Image URL 4','Image URL 5','Image URL 6','Image URL 7','Image URL 8'];
var UNSELLABLE = ['sold','archived','returned','deleted','hold','lost_damaged','bundled','sold_pending_pickup','sold_pending_shipment'];
// Sports cards: pick "<Sport> Singles" from the card's own set/name text
// ("Baseball Cards 2023 Topps Chrome") instead of one sub-category for all.
var SPORT_AUTO = 'Auto by sport';
var SPORT_SUBCATEGORIES = [
  [/\bbaseball\b|\bmlb\b/, 'Baseball Singles'], [/\bbasketball\b|\bnba\b|\bwnba\b/, 'Basketball Singles'],
  [/\bfootball\b|\bnfl\b/, 'Football Singles'], [/\bhockey\b|\bnhl\b/, 'Hockey Singles'],
  [/\bsoccer\b|\bmls\b|premier league|\bfifa\b/, 'Soccer Singles'], [/\bwrestling\b|\bwwe\b|\baew\b/, 'Wrestling Singles'],
  [/\bufc\b|\bmma\b/, 'UFC Singles'], [/\btennis\b/, 'Tennis Singles'], [/\bnascar\b/, 'NASCAR Cards'], [/\bformula 1\b|\bf1\b/, 'F1 Cards'],
];
// Suggested starting mapping for this store's categories, all values taken
// from Whatnot's Values tab. Shown as "suggested" until the store saves it;
// categories not listed here start blank.
var SUGGESTED_MAPPING = {
  'Pokemon TCG': { category:'Trading Card Games', subCategory:'Pokémon Cards', shippingProfile:'0-1 oz', condition:'Near Mint' },
  'Magic: The Gathering': { category:'Trading Card Games', subCategory:'Magic: The Gathering', shippingProfile:'0-1 oz', condition:'Near Mint' },
  'One Piece TCG': { category:'Trading Card Games', subCategory:'One Piece Cards', shippingProfile:'0-1 oz', condition:'Near Mint' },
  'Yu-Gi-Oh!': { category:'Trading Card Games', subCategory:'Yu-Gi-Oh! Cards', shippingProfile:'0-1 oz', condition:'Near Mint' },
  'Disney Lorcana': { category:'Trading Card Games', subCategory:'Lorcana', shippingProfile:'0-1 oz', condition:'Near Mint' },
  'Sports': { category:'Sports Cards', subCategory:SPORT_AUTO, shippingProfile:'Sports singles (3oz)', condition:'Raw - Near Mint or Better' },
  'Comic': { category:'Comics & Manga', subCategory:'Modern Comics', shippingProfile:'4-7 oz', condition:'Near Mint' },
};
// The store's own condition codes -> Whatnot's wording, in order of
// preference; the first one allowed for the item's sub-category wins.
var CONDITION_ALIASES = [
  [/^(nm|near mint|nm\/m|mint)$/, ['Near Mint', 'Raw - Near Mint or Better', 'Like New']],
  [/^(ex|excellent|lp|light(ly)? played)$/, ['Light Played', 'Raw - Excellent', 'Very Fine', 'Very Good']],
  [/^(mp|moderately played|played|vg|very good)$/, ['Moderately Played', 'Raw - Very Good', 'Very Good', 'Good']],
  [/^(hp|heavily played|fair)$/, ['Heavily Played', 'Fair', 'Raw - Poor', 'Poor']],
  [/^(dmg|damaged|poor)$/, ['Damaged', 'Poor', 'Raw - Poor']],
  [/^(new|sealed|factory sealed|brand new)$/, ['New', 'Brand New', 'Mint']],
];

var state = { settings:null, loading:false, source:'selected', category:'', query:'', dest:'show', type:'Auction', auctionRule:'one', auctionPct:50, offerable:false, includeCost:true, wholeDollars:true, report:null };

function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function norm(v){ return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function toast(msg){ if(typeof toast_dash === 'function') toast_dash(msg); }
function items(){ return (typeof all !== 'undefined' && Array.isArray(all)) ? all : []; }
function host(){ return document.getElementById('whatnot-bridge'); }

function isSellable(i){
  var status = String(i.status || i.inventoryStatus || '');
  return Number(i.qty || 0) > 0 && !i.archivedAt && UNSELLABLE.indexOf(status) < 0;
}
function categoryOf(i){ return String(i.category || '').trim() || 'Uncategorized'; }

function defaultSettings(){ return { mapping:{}, values:null, defaults:{ hazmat:'Not Hazmat' } }; }
async function loadSettings(){
  if(state.settings || state.loading) return;
  state.loading = true;
  try {
    var res = await storeWorkerFetch('/store/whatnot-settings');
    var data = await res.json().catch(function(){ return {}; });
    state.settings = Object.assign(defaultSettings(), (data && data.ok && data.settings) || {});
  } catch(e) {
    state.settings = defaultSettings();
  }
  // Whatnot's allowed values ship with the dashboard (scripts/whatnot-values.json,
  // from the Values tab of Whatnot's CSV template); a store that loads a newer
  // Values file uses that instead.
  try {
    var builtIn = await fetch('scripts/whatnot-values.json?v=2026-09-30b');
    state.builtInValues = builtIn.ok ? await builtIn.json() : null;
  } catch(e) { state.builtInValues = null; }
  state.loading = false;
}
function values(){
  var saved = state.settings && state.settings.values;
  var v = saved && saved.categories && saved.categories.length ? saved : state.builtInValues;
  return v || { categories:[], shippingProfiles:[], hazmat:[], types:[], subCategoriesByCategory:{}, conditionsBySubCategory:{} };
}
function mappingFor(cat){
  var saved = state.settings.mapping[cat];
  if(saved) return { map:saved, suggested:false };
  return SUGGESTED_MAPPING[cat] ? { map:SUGGESTED_MAPPING[cat], suggested:true } : { map:{}, suggested:false };
}
function sportSubCategory(i){
  var text = [i.sport, i.set, i.name, i.team, i.tags].join(' ').toLowerCase();
  var hit = SPORT_SUBCATEGORIES.find(function(pair){ return pair[0].test(text); });
  return hit ? hit[1] : 'Other Sports Cards';
}
function subCategoryFor(i, map){ return map.subCategory === SPORT_AUTO ? sportSubCategory(i) : (map.subCategory || ''); }
async function saveSettings(){
  try {
    var res = await storeWorkerFetch('/store/whatnot-settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ settings:state.settings }) });
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok || !data.ok) throw new Error(data.error || 'Could not save');
    toast('Whatnot settings saved');
  } catch(e) { toast('Whatnot settings not saved: ' + e.message); }
}

// ── Part 1: build the CSV ────────────────────────────────────────────────
function chosenItems(){
  var list = items().filter(isSellable);
  if(state.source === 'selected'){
    var ids = (typeof inventoryBulkSelectedIds !== 'undefined' && inventoryBulkSelectedIds) ? inventoryBulkSelectedIds : new Set();
    return list.filter(function(i){ return ids.has(i.id); });
  }
  if(state.source === 'category') return list.filter(function(i){ return categoryOf(i) === state.category; });
  var q = norm(state.query);
  if(!q) return [];
  return list.filter(function(i){ return norm([i.name, i.set, i.card_number, i.variant, i.category].join(' ')).indexOf(q) >= 0; });
}

function imageUrls(i){
  var raw = i.raw || {};
  var out = [];
  function add(u){ u = typeof u === 'string' ? u : (u && (u.url || u.src)) || ''; if(/^https?:\/\//i.test(u) && out.indexOf(u) < 0) out.push(u); }
  (Array.isArray(i.photos) ? i.photos : []).forEach(add);
  (Array.isArray(raw.photos) ? raw.photos : []).forEach(add);
  add(typeof inventoryImageUrl === 'function' ? inventoryImageUrl(i) : '');
  [raw.image, raw.imageUrl, raw.image_url, raw.thumbnail].forEach(add);
  return out.slice(0, 8);
}

function priceFor(i){
  var stats = typeof inventoryProfitStats === 'function' ? inventoryProfitStats(i) : { list:Number(i.listPrice || 0), market:Number(i.market || 0) };
  var list = Number(stats.list) > 0 ? Number(stats.list) : Number(stats.market || 0);
  var market = Number(stats.market) > 0 ? Number(stats.market) : list;
  var price = list;
  if(state.type === 'Auction'){
    if(state.auctionRule === 'one') price = 1;
    else if(state.auctionRule === 'pct') price = Math.max(1, market * Number(state.auctionPct || 0) / 100);
  }
  if(!(price > 0)) return '';
  return state.wholeDollars ? String(Math.max(1, Math.ceil(price - 0.001))) : price.toFixed(2);
}

// Uses Whatnot's own spelling of the type once its values are loaded
// (e.g. "Buy It Now"), matched ignoring case and spaces.
function typeValue(){
  var allowed = values().types || [];
  var want = norm(state.type).replace(/ /g, '');
  return allowed.find(function(v){ return norm(v).replace(/ /g, '') === want; }) || state.type;
}

function isGraded(i){
  var raw = i.raw || {};
  return !!String(i.grader || raw.grader || '').trim() || /^(psa|bgs|cgc|sgc|beckett|tag|cbcs)\b/i.test(String(i.condition || ''));
}
// Whatnot's allowed conditions depend on the sub-category (Pokémon Cards:
// "Near Mint"; Baseball Singles: "Raw - Near Mint or Better"). A graded item
// is "Graded"; otherwise the item's own condition is translated; otherwise
// the mapping's default. Blank when the sub-category has no condition list.
function conditionFor(i, map){
  var allowed = (values().conditionsBySubCategory || {})[subCategoryFor(i, map)] || [];
  if(!allowed.length) return values().categories.length ? '' : (map.condition || '');
  if(isGraded(i) && allowed.indexOf('Graded') >= 0) return 'Graded';
  var own = String(i.condition || '').trim().toLowerCase();
  var exact = allowed.find(function(v){ return v.toLowerCase() === own; });
  if(own && exact) return exact;
  var alias = CONDITION_ALIASES.find(function(pair){ return pair[0].test(own); });
  var preferred = alias && alias[1].find(function(v){ return allowed.indexOf(v) >= 0; });
  if(preferred) return preferred;
  return allowed.indexOf(map.condition) >= 0 ? map.condition : '';
}

function rowFor(i){
  var map = mappingFor(categoryOf(i)).map;
  var title = [i.name, i.set, i.card_number ? '#' + i.card_number : '', i.variant].filter(Boolean).join(' - ').slice(0, 140);
  var description = [i.name, i.set, i.card_number ? 'Card #' + i.card_number : '', i.variant, i.year, i.condition, i.comic_grade ? 'Grade ' + i.comic_grade : ''].filter(Boolean).join(' · ');
  var imgs = imageUrls(i);
  var cost = Number(i.cost || 0);
  return [
    map.category || '', subCategoryFor(i, map), title, description, String(Math.max(1, Number(i.qty || 1))),
    typeValue(), priceFor(i), map.shippingProfile || '',
    state.type === 'Buy It Now' && state.offerable ? 'TRUE' : 'FALSE',
    (state.settings.defaults && state.settings.defaults.hazmat) || 'Not Hazmat',
    conditionFor(i, map), state.includeCost && cost > 0 ? cost.toFixed(2) : '', i.id,
  ].concat([0,1,2,3,4,5,6,7].map(function(n){ return imgs[n] || ''; }));
}

function checks(list){
  var unmapped = {}, bySport = {};
  var noPhoto = 0, noPrice = 0;
  list.forEach(function(i){
    var m = mappingFor(categoryOf(i)).map;
    if(!m.category || !m.shippingProfile || mappingProblems(m).length) unmapped[categoryOf(i)] = true;
    if(m.subCategory === SPORT_AUTO){ var sub = sportSubCategory(i); bySport[sub] = (bySport[sub] || 0) + 1; }
    if(!imageUrls(i).length) noPhoto++;
    if(state.type !== 'Giveaway' && !priceFor(i)) noPrice++;
  });
  return { unmapped:Object.keys(unmapped), noPhoto:noPhoto, noPrice:noPrice, bySport:bySport };
}

// Which of a mapping's values Whatnot would reject.
function mappingProblems(m){
  var v = values();
  if(!v.categories.length) return [];
  var out = [];
  if(m.category && v.categories.indexOf(m.category) < 0) out.push('category');
  var subs = (v.subCategoriesByCategory || {})[m.category] || [];
  if(m.subCategory && m.subCategory !== SPORT_AUTO && subs.indexOf(m.subCategory) < 0) out.push('subCategory');
  if(m.subCategory === SPORT_AUTO && m.category !== 'Sports Cards') out.push('subCategory');
  if(m.shippingProfile && v.shippingProfiles.indexOf(m.shippingProfile) < 0) out.push('shippingProfile');
  var conds = (v.conditionsBySubCategory || {})[m.subCategory === SPORT_AUTO ? 'Baseball Singles' : m.subCategory] || [];
  if(m.condition && conds.length && conds.indexOf(m.condition) < 0) out.push('condition');
  return out;
}

function datalist(id, list){ return '<datalist id="' + id + '">' + (list || []).map(function(x){ return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; }
function datalists(){
  var v = values();
  return datalist('wb-values-categories', v.categories) + datalist('wb-values-shippingProfiles', v.shippingProfiles);
}

function mappingRows(categories){
  var v = values();
  return categories.map(function(cat, n){
    var entry = mappingFor(cat), m = entry.map, problems = mappingProblems(m);
    var subs = ((v.subCategoriesByCategory || {})[m.category] || []).slice();
    if(m.category === 'Sports Cards') subs.unshift(SPORT_AUTO);
    var conds = (v.conditionsBySubCategory || {})[m.subCategory === SPORT_AUTO ? 'Baseball Singles' : m.subCategory] || [];
    function input(field, listId, placeholder){
      var bad = problems.indexOf(field) >= 0;
      return '<input class="tsi" list="' + listId + '" value="' + esc(m[field] || '') + '" placeholder="' + esc(placeholder) + '" style="margin-bottom:0;' + (bad ? 'border-color:var(--red);' : '') + '" title="' + (bad ? 'Not on Whatnot\'s list for this category' : '') + '" onchange="WB.setMap(' + esc(JSON.stringify(cat)) + ',\'' + field + '\',this.value)">';
    }
    return datalist('wb-sub-' + n, subs) + datalist('wb-cond-' + n, conds) +
      '<div style="display:grid;grid-template-columns:minmax(110px,1fr) repeat(4,minmax(120px,1fr));gap:6px;align-items:center;margin-bottom:6px">' +
      '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text)">' + esc(cat) + (entry.suggested ? '<br><span style="color:var(--gold)">suggested -- check, then SAVE</span>' : '') + '</div>' +
      input('category', 'wb-values-categories', 'Whatnot category') + input('subCategory', 'wb-sub-' + n, 'Sub category') +
      input('shippingProfile', 'wb-values-shippingProfiles', 'Shipping profile') + input('condition', 'wb-cond-' + n, 'Default condition') + '</div>';
  }).join('') +
  '<div style="margin-top:2px">Each item\'s own condition is translated to Whatnot\'s wording for its sub-category (NM becomes "Near Mint" for Pokémon, "Raw - Near Mint or Better" for baseball); graded items become "Graded". The default condition is used only when an item has none.</div>';
}

function renderSend(){
  var list = chosenItems();
  var cats = [];
  list.forEach(function(i){ if(cats.indexOf(categoryOf(i)) < 0) cats.push(categoryOf(i)); });
  var allCats = [];
  items().filter(isSellable).forEach(function(i){ if(allCats.indexOf(categoryOf(i)) < 0) allCats.push(categoryOf(i)); });
  allCats.sort();
  var c = checks(list);
  var selectedCount = (typeof inventoryBulkSelectedIds !== 'undefined' && inventoryBulkSelectedIds) ? inventoryBulkSelectedIds.size : 0;
  var valuesLoaded = values().categories.length > 0;
  var customValues = !!(state.settings.values && state.settings.values.categories && state.settings.values.categories.length);
  function opt(name, value, label, current){ return '<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px"><input type="radio" name="' + name + '" value="' + esc(value) + '"' + (current === value ? ' checked' : '') + ' onchange="WB.set(\'' + name + '\',this.value)"> ' + esc(label) + '</label>'; }
  var warn = [];
  if(c.unmapped.length) warn.push('Set a Whatnot category and shipping profile for: ' + c.unmapped.map(esc).join(', '));
  if(c.noPhoto) warn.push(c.noPhoto + ' item' + (c.noPhoto === 1 ? ' has' : 's have') + ' no photo -- Whatnot needs one before a shop listing can be published');
  Object.keys(c.bySport).length && warn.push('Sports sub-categories: ' + Object.keys(c.bySport).map(function(k){ return c.bySport[k] + ' ' + esc(k); }).join(', '));
  if(c.noPrice) warn.push(c.noPrice + ' item' + (c.noPrice === 1 ? ' has' : 's have') + ' no price');
  return '<div class="panel" style="margin-bottom:14px">' +
    '<div class="ph">SEND ITEMS TO WHATNOT <span style="font-size:9px;color:var(--dim)">CSV in Whatnot\'s own template format</span></div>' + datalists() +
    '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);display:grid;gap:10px">' +
      '<div><b style="color:var(--text)">ITEMS</b><br>' +
        opt('source', 'selected', 'Checked in Inventory (' + selectedCount + ')', state.source) +
        opt('source', 'category', 'A whole category', state.source) +
        opt('source', 'search', 'Search', state.source) +
        (state.source === 'category' ? '<select class="tsi" style="margin:6px 0 0;max-width:260px" onchange="WB.set(\'category\',this.value)"><option value="">Pick a category</option>' + allCats.map(function(x){ return '<option' + (x === state.category ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' : '') +
        (state.source === 'search' ? '<input class="tsi" style="margin:6px 0 0" placeholder="Name, set, number..." value="' + esc(state.query) + '" onchange="WB.set(\'query\',this.value)">' : '') +
      '</div>' +
      '<div><b style="color:var(--text)">GOING TO</b><br>' + opt('dest', 'show', 'A live show (temporary listings)', state.dest) + opt('dest', 'shop', 'My Whatnot shop (inventory drafts)', state.dest) + '</div>' +
      '<div><b style="color:var(--text)">LISTING TYPE</b><br>' + opt('type', 'Auction', 'Auction', state.type) + opt('type', 'Buy It Now', 'Buy It Now', state.type) + opt('type', 'Giveaway', 'Giveaway', state.type) +
        (state.type === 'Auction' ? '<div style="margin-top:6px">Starting bid: ' + opt('auctionRule', 'one', '$1', state.auctionRule) + opt('auctionRule', 'pct', '% of market', state.auctionRule) + opt('auctionRule', 'list', 'my list price', state.auctionRule) +
          (state.auctionRule === 'pct' ? '<input type="number" min="1" max="200" value="' + esc(state.auctionPct) + '" style="width:64px;background:var(--surf2);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:4px" onchange="WB.set(\'auctionPct\',this.value)"> %' : '') + '</div>' : '') +
        (state.type === 'Buy It Now' ? '<label style="display:block;margin-top:6px"><input type="checkbox"' + (state.offerable ? ' checked' : '') + ' onchange="WB.set(\'offerable\',this.checked)"> Let buyers make offers</label>' : '') +
      '</div>' +
      '<div><label><input type="checkbox"' + (state.wholeDollars ? ' checked' : '') + ' onchange="WB.set(\'wholeDollars\',this.checked)"> Round prices up to whole dollars</label> &nbsp; <label><input type="checkbox"' + (state.includeCost ? ' checked' : '') + ' onchange="WB.set(\'includeCost\',this.checked)"> Include my cost (Whatnot uses it for your profit reports; buyers never see it)</label></div>' +
      (cats.length ? '<div><b style="color:var(--text)">WHATNOT CATEGORY FOR EACH OF YOUR CATEGORIES</b> <span>(set once, saved for every export)</span>' +
        '<div style="margin-top:6px;overflow-x:auto">' + mappingRows(cats) + '</div>' +
        '<button class="hbtn" style="margin-bottom:0" onclick="WB.saveMapping()">SAVE CATEGORY SETTINGS</button></div>' : '') +
      '<div>' + (valuesLoaded ? '<span style="color:var(--g)">Using Whatnot\'s allowed values' + (customValues ? ' (your uploaded Values file)' : ' (Whatnot template, Sep 2026)') + '</span> -- the boxes offer Whatnot\'s own choices and turn red if a value isn\'t on its list. If Whatnot changes its lists, load the new <b>Values</b> tab here.' : 'Load the <b>Values</b> tab of Whatnot\'s CSV template (in Google Sheets: File -> Download -> CSV while on the Values tab).') +
        ' <label class="hbtn" style="display:inline-block;margin:6px 0 0;cursor:pointer">LOAD WHATNOT VALUES<input type="file" accept=".csv,text/csv" style="display:none" onchange="WB.loadValues(this.files[0]);this.value=\'\'"></label></div>' +
      (warn.length ? '<div style="color:var(--gold)">' + warn.join('<br>') + '</div>' : '') +
      '<button class="hbtn" style="width:100%;padding:12px;margin-bottom:0;background:rgba(0,255,179,.12);border-color:rgba(0,255,179,.35);color:var(--g)"' + (list.length ? '' : ' disabled') + ' onclick="WB.download()">DOWNLOAD WHATNOT CSV (' + list.length + ' item' + (list.length === 1 ? '' : 's') + ')</button>' +
      '<div id="wb-after-download"></div>' +
    '</div></div>';
}

function afterDownloadHtml(count){
  var steps = state.dest === 'show'
    ? 'On whatnot.com: Seller Hub -> Shows -> open your show -> Add -> Create Temporary Listing -> Upload CSV -> pick this file.'
    : 'On whatnot.com: Seller Hub -> Inventory -> Upload CSV (the cloud icon) -> pick this file -> Import. They arrive as drafts; check them and publish.';
  return '<div style="margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:8px;color:var(--text)">Downloaded ' + count + ' item' + (count === 1 ? '' : 's') + '. ' + esc(steps) + ' After the show, bring the results back below with IMPORT SHOW RESULTS.</div>';
}

// ── Part 2: import the show report ───────────────────────────────────────
var COLUMN_GUESSES = {
  sku: [/^sku$/, /sku/],
  title: [/product name/, /listing title/, /item name/, /^title$/, /^product$/, /name/],
  price: [/sold price/, /sale price/, /winning bid/, /final price/, /item price/, /^price$/, /subtotal/, /price/],
  quantity: [/^quantity$/, /quantity/, /^qty$/],
  order: [/^order id$/, /order id/, /order number/, /^order$/, /order/],
  date: [/placed at/, /sold at/, /order date/, /^date$/, /date/, /created/],
  status: [/cancel/, /status/, /refund/],
  fee: [/total fees?/, /seller fees?/, /commission/, /fees?/],
};
function guessColumns(header){
  var h = header.map(function(x){ return norm(x); });
  var used = {};
  var out = {};
  Object.keys(COLUMN_GUESSES).forEach(function(key){
    out[key] = -1;
    COLUMN_GUESSES[key].some(function(re){
      var idx = h.findIndex(function(name, n){ return !used[n] && re.test(name) && !(key === 'order' && /numeric/.test(name)); });
      if(idx >= 0){ out[key] = idx; used[idx] = true; return true; }
      return false;
    });
  });
  return out;
}
function money(v){ var n = Number(String(v || '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; }
function isCancelled(v){ var s = String(v || '').trim().toLowerCase(); return /cancel|refund|fail|void/.test(s) || s === 'true' || s === 'yes'; }

function buildReportRows(){
  var r = state.report; if(!r) return [];
  var cols = r.cols;
  var fee = typeof whatnotFeeSettings === 'function' ? whatnotFeeSettings() : { pct:10.9, flat:0.3 };
  var byId = {};
  items().forEach(function(i){ byId[i.id] = i; });
  return r.rows.map(function(cells, n){
    function cell(key){ return cols[key] >= 0 ? String(cells[cols[key]] || '').trim() : ''; }
    var sku = cell('sku'), title = cell('title'), price = money(cell('price'));
    var qty = Math.max(1, Math.round(money(cell('quantity'))) || 1);
    var item = sku ? (byId[sku] || items().find(function(i){ return i.raw && i.raw.sku === sku; })) : null;
    var how = item ? 'sku' : '';
    if(!item && title){
      var t = norm(title);
      var hits = items().filter(function(i){ return isSellable(i) && norm([i.name, i.set, i.card_number ? '#' + i.card_number : '', i.variant].filter(Boolean).join(' - ')) === t || isSellable(i) && norm(i.name) === t; });
      if(hits.length === 1){ item = hits[0]; how = 'title'; }
    }
    var feeCol = cell('fee');
    var feeAmount = feeCol ? Math.abs(money(feeCol)) : Math.round((price * fee.pct / 100 + fee.flat) * 100) / 100;
    var order = cell('order');
    var ref = 'whatnot:' + (order || [cell('date'), sku || norm(title), price].join('|')) + (order && (sku || title) ? ':' + (sku || norm(title)).slice(0, 40) : '');
    var reason = '';
    if(cols.status >= 0 && isCancelled(cell('status'))) reason = 'Cancelled or refunded';
    else if(!(price > 0)) reason = 'No sale price';
    else if(!item) reason = 'No matching item';
    else if(!isSellable(item)) reason = 'Already sold in the dashboard';
    var soldAt = cell('date') && !isNaN(Date.parse(cell('date'))) ? new Date(cell('date')).toISOString() : '';
    return { n:n, sku:sku, title:title, price:price, qty:qty, item:item, how:how, feeAmount:feeAmount, ref:ref.slice(0, 120), soldAt:soldAt, reason:reason, include: !reason && how === 'sku', done:false, result:'' };
  });
}

function renderImport(){
  var r = state.report;
  var body = '';
  if(r){
    var rows = r.built;
    var ready = rows.filter(function(x){ return x.include && !x.done; });
    var colSelect = function(key, label){
      return '<label style="display:grid;gap:2px">' + label + '<select class="tsi" style="margin-bottom:0" onchange="WB.setCol(\'' + key + '\',this.value)"><option value="-1">(none)</option>' +
        r.header.map(function(h, n){ return '<option value="' + n + '"' + (r.cols[key] === n ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') + '</select></label>';
    };
    body = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin:8px 0">' +
        colSelect('sku', 'SKU') + colSelect('title', 'Item title') + colSelect('price', 'Sold price') + colSelect('quantity', 'Quantity') +
        colSelect('order', 'Order ID') + colSelect('date', 'Date') + colSelect('status', 'Cancelled / status') + colSelect('fee', 'Fees (optional)') + '</div>' +
      '<div style="margin-bottom:6px">' + rows.length + ' rows · ' + rows.filter(function(x){ return x.how === 'sku' && !x.reason; }).length + ' matched by SKU · ' + rows.filter(function(x){ return x.how === 'title' && !x.reason; }).length + ' matched by title (tick to include) · ' + rows.filter(function(x){ return x.reason; }).length + ' skipped</div>' +
      '<div style="max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px">' + rows.slice(0, 300).map(function(x){
        var status = x.done ? '<span style="color:var(--g)">' + esc(x.result) + '</span>' : x.reason ? '<span style="color:var(--dim)">' + esc(x.reason) + '</span>' : (x.how === 'title' ? '<span style="color:var(--gold)">matched by title</span>' : '<span style="color:var(--g)">matched</span>');
        return '<label style="display:grid;grid-template-columns:24px 1fr auto;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);align-items:center">' +
          '<input type="checkbox"' + (x.include ? ' checked' : '') + (x.reason || x.done ? ' disabled' : '') + ' onchange="WB.toggleRow(' + x.n + ',this.checked)">' +
          '<span style="color:var(--text)">' + esc(x.item ? x.item.name : x.title || x.sku || 'Row ' + (x.n + 1)) + (x.qty > 1 ? ' ×' + x.qty : '') + '<br><span style="color:var(--dim)">' + esc(x.title) + '</span></span>' +
          '<span style="text-align:right">$' + x.price.toFixed(2) + '<br>' + status + '</span></label>';
      }).join('') + '</div>' +
      '<div style="margin-top:6px">Fees: taken from the report when it has a fee column, otherwise estimated with your Whatnot fee setting below. Items you already rang up in Whatnot Mode during the show show as "Already sold".</div>' +
      '<button class="hbtn" style="width:100%;padding:12px;margin:8px 0 0;background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.35);color:var(--gold)"' + (ready.length && !state.importing ? '' : ' disabled') + ' onclick="WB.recordSales()">' + (state.importing ? 'RECORDING…' : 'RECORD ' + ready.length + ' SALE' + (ready.length === 1 ? '' : 'S')) + '</button>';
  }
  return '<div class="panel" style="margin-bottom:14px">' +
    '<div class="ph">IMPORT SHOW RESULTS <span style="font-size:9px;color:var(--dim)">marks sold items and records the sales</span></div>' +
    '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim)">After the show, export the report from Whatnot (Seller Hub -> your show -> Export Show Report) and load it here. Sales are recorded once, even if you load the same report again.' +
    ' <label class="hbtn" style="display:inline-block;margin:6px 0 0;cursor:pointer">LOAD SHOW REPORT CSV<input type="file" accept=".csv,text/csv" style="display:none" onchange="WB.loadReport(this.files[0]);this.value=\'\'"></label>' +
    body + '</div></div>';
}

async function render(){
  var el = host(); if(!el) return;
  if(!state.settings){ el.innerHTML = '<div class="panel" style="padding:14px;font-family:var(--font-mono);font-size:10px;color:var(--dim)">Loading Whatnot tools…</div>'; await loadSettings(); }
  el.innerHTML = renderSend() + renderImport();
}

// The Values tab pairs columns: "subcategory categories" + "subcategories"
// (which category each sub-category belongs to), and "condition
// categories" + "conditions" (which sub-category each condition belongs to).
function parseWhatnotValues(rows){
  var header = (rows[0] || []).map(function(h){ return norm(h); });
  var out = { categories:[], shippingProfiles:[], hazmat:[], types:['Auction','Buy It Now','Giveaway'], subCategoriesByCategory:{}, conditionsBySubCategory:{} };
  function column(n){ var list = []; rows.slice(1).forEach(function(r){ var v = String(r[n] || '').trim(); if(v && list.indexOf(v) < 0) list.push(v); }); return list; }
  function pairs(keyCol, valCol, target){
    rows.slice(1).forEach(function(r){
      var k = String(r[keyCol] || '').trim(), v = String(r[valCol] || '').trim();
      if(!k || !v) return;
      var list = target[k] = target[k] || [];
      if(list.indexOf(v) < 0) list.push(v);
    });
  }
  header.forEach(function(h, n){
    if(h === 'categories' || h === 'category') out.categories = column(n);
    else if(/^ship/.test(h)) out.shippingProfiles = column(n);
    else if(/^hazmat/.test(h)) out.hazmat = column(n);
    else if(/^types?$/.test(h)) out.types = column(n);
    else if(/^sub ?categor(y|ies) categor/.test(h) && header[n + 1]) pairs(n, n + 1, out.subCategoriesByCategory);
    else if(/^condition categor/.test(h) && header[n + 1]) pairs(n, n + 1, out.conditionsBySubCategory);
  });
  return out;
}

function readFile(file){ return new Promise(function(resolve, reject){ var r = new FileReader(); r.onload = function(){ resolve(String(r.result || '')); }; r.onerror = function(){ reject(r.error); }; r.readAsText(file); }); }

window.WB = {
  set: function(key, value){
    if(key === 'auctionPct') value = Number(value) || 50;
    state[key] = value; render();
  },
  setMap: function(cat, field, value){
    if(!state.settings.mapping[cat]) state.settings.mapping[cat] = Object.assign({}, SUGGESTED_MAPPING[cat] || {});
    var m = state.settings.mapping[cat];
    m[field] = String(value || '').trim();
    if(field === 'category' && m.subCategory && mappingProblems(m).indexOf('subCategory') >= 0) m.subCategory = '';
    render();
  },
  saveMapping: function(){
    chosenItems().forEach(function(i){ var cat = categoryOf(i); if(!state.settings.mapping[cat] && SUGGESTED_MAPPING[cat]) state.settings.mapping[cat] = Object.assign({}, SUGGESTED_MAPPING[cat]); });
    saveSettings().then(render);
  },
  loadValues: async function(file){
    if(!file) return;
    try {
      var parsed = parseWhatnotValues(parseCSV(await readFile(file)));
      if(!parsed.categories.length) throw new Error('No "categories" column found -- make sure you downloaded the Values tab');
      state.settings.values = parsed;
      await saveSettings();
      toast('Loaded Whatnot values: ' + parsed.categories.length + ' categories, ' + Object.keys(parsed.subCategoriesByCategory).length + ' with sub-categories, ' + parsed.shippingProfiles.length + ' shipping profiles');
      render();
    } catch(e) { toast('Could not read that file: ' + e.message); }
  },
  download: function(){
    var list = chosenItems();
    if(!list.length){ toast('No items to export'); return; }
    var rows = [TEMPLATE_HEADER].concat(list.map(rowFor));
    downloadCSV('whatnot-' + (state.dest === 'show' ? 'show' : 'shop') + '-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
    if(typeof logOpsEvent === 'function') logOpsEvent('whatnot_csv_export', 'Exported ' + list.length + ' item(s) to a Whatnot CSV', { count:list.length, dest:state.dest, type:state.type });
    var after = document.getElementById('wb-after-download'); if(after) after.innerHTML = afterDownloadHtml(list.length);
  },
  loadReport: async function(file){
    if(!file) return;
    try {
      var rows = parseCSV(await readFile(file));
      if(rows.length < 2) throw new Error('That file has no rows');
      state.report = { header:rows[0], rows:rows.slice(1), cols:guessColumns(rows[0]) };
      if(state.report.cols.sku < 0 && state.report.cols.title < 0) toast('Could not find a SKU or title column -- pick them from the dropdowns');
      state.report.built = buildReportRows();
      render();
    } catch(e) { toast('Could not read that report: ' + e.message); }
  },
  setCol: function(key, value){ state.report.cols[key] = Number(value); state.report.built = buildReportRows(); render(); },
  toggleRow: function(n, on){ var x = state.report.built.find(function(r){ return r.n === n; }); if(x) x.include = on; render(); },
  recordSales: async function(){
    if(state.importing || !state.report) return;
    var rows = state.report.built.filter(function(x){ return x.include && !x.done; });
    if(!rows.length) return;
    if(!confirm('Record ' + rows.length + ' Whatnot sale' + (rows.length === 1 ? '' : 's') + ' and mark those items sold?')) return;
    state.importing = true; render();
    var recorded = 0, dupes = 0, failed = 0;
    for(var k = 0; k < rows.length; k++){
      var x = rows[k];
      try {
        var res = await storeWorkerFetch('/inventory/record-external-sale', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ itemId:x.item.id, channel:'Whatnot', salePrice:x.price, feeAmount:x.feeAmount, quantitySold:x.qty, soldAt:x.soldAt || undefined, externalRef:x.ref }) });
        var d = await res.json().catch(function(){ return {}; });
        if(d.ok && d.duplicate){ x.done = true; x.result = 'Already recorded'; dupes++; }
        else if(d.ok){ x.done = true; x.result = 'Recorded'; recorded++; }
        else if(res.status === 409){ x.done = true; x.result = 'Already sold'; dupes++; }
        else { x.result = d.error || 'Failed'; x.reason = x.result; failed++; }
      } catch(e) { x.result = e.message; x.reason = e.message; failed++; }
    }
    state.importing = false;
    toast('Whatnot import: ' + recorded + ' recorded' + (dupes ? ', ' + dupes + ' already recorded' : '') + (failed ? ', ' + failed + ' failed' : ''));
    if(typeof logOpsEvent === 'function') logOpsEvent('whatnot_report_import', 'Imported Whatnot show report', { recorded:recorded, duplicates:dupes, failed:failed });
    render();
    if(recorded && typeof loadInventory === 'function') loadInventory().catch(function(){});
  },
};
window.renderWhatnotBridge = render;
if(typeof activeTab !== 'undefined' && activeTab === 'whatnot') render();
})();
