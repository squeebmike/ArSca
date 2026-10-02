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
// presale: a FOC presale placeholder for a book that hasn't arrived --
// never exported until RECEIVE SHIPMENT turns it into real stock.
var UNSELLABLE = ['sold','archived','returned','deleted','hold','lost_damaged','bundled','sold_pending_pickup','sold_pending_shipment','presale'];
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

var state = { settings:null, loading:false, source:'selected', category:'', query:'', shipment:'', cycles:null, dest:'show', type:'Auction', auctionRule:'one', auctionPct:50, offerable:false, includeCost:true, wholeDollars:true, report:null, shows:null };

function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function norm(v){ return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function toast(msg){ if(typeof toast_dash === 'function') toast_dash(msg); }
function items(){ return (typeof all !== 'undefined' && Array.isArray(all)) ? all : []; }
function host(){ return document.getElementById('whatnot-bridge'); }

function isSellable(i){
  var status = String(i.status || i.inventoryStatus || '');
  var lifecycle = String(i.lifecycle || '');
  return Number(i.qty || 0) > 0 && !i.archivedAt && UNSELLABLE.indexOf(status) < 0 && UNSELLABLE.indexOf(lifecycle) < 0;
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
  if(state.source === 'shipment') return state.shipment ? list.filter(function(i){ return focCycleOf(i) === state.shipment; }) : [];
  var q = norm(state.query);
  if(!q) return [];
  return list.filter(function(i){ return norm([i.name, i.set, i.card_number, i.variant, i.category].join(' ')).indexOf(q) >= 0; });
}

// FOC shipments: books created by RECEIVE SHIPMENT (source foc_receive) and
// eBay presale rows switched to in stock both carry the cycle they came in.
function focCycleOf(i){ var raw = i.raw || {}; return String(raw.focCycleId || i.focCycleId || ''); }
function shipments(){
  var groups = {};
  items().filter(isSellable).forEach(function(i){
    var id = focCycleOf(i); if(!id) return;
    var g = groups[id] = groups[id] || { id:id, count:0, receivedAt:'' };
    g.count++;
    var at = String((i.raw || {}).focReceivedAt || '');
    if(at > g.receivedAt) g.receivedAt = at;
  });
  return Object.keys(groups).map(function(k){ return groups[k]; }).sort(function(a, b){ return b.receivedAt.localeCompare(a.receivedAt); });
}
function shipmentLabel(g){
  var cycle = (state.cycles || {})[g.id];
  var parts = [];
  if(cycle) parts.push((cycle.distributor || 'FOC') + ' FOC ' + cycle.foc_date);
  if(g.receivedAt) parts.push('received ' + g.receivedAt.slice(0, 10));
  if(!parts.length) parts.push('FOC shipment');
  return parts.join(' · ') + ' · ' + g.count + ' book' + (g.count === 1 ? '' : 's') + ' in stock';
}
// FOC week names for the shipment list; best-effort (the list still works
// with receive dates alone).
async function loadCycles(){
  if(state.cycles) return;
  state.cycles = {};
  try {
    var sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    var storeId = typeof getActiveStoreId === 'function' ? getActiveStoreId() : '';
    if(!sb || !storeId) return;
    var res = await sb.from('foc_cycles').select('id,foc_date,distributor').eq('store_id', storeId).order('foc_date', { ascending:false }).limit(200);
    (res.data || []).forEach(function(c){ state.cycles[c.id] = c; });
  } catch(e) { /* labels fall back to receive dates */ }
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

// Comic details saved on the item: comicMetadata (Metron lookup) or
// focComicDetail (from the FOC/Lunar catalog for presales). Same shape.
function comicDetail(i){
  var raw = i.raw || {};
  var m = i.comicMetadata || raw.comicMetadata || raw.focComicDetail || null;
  if(!m || typeof m !== 'object') return null;
  function list(v){ return (Array.isArray(v) ? v : []).map(function(x){ return String(x && (x.name || x.creator) || x || '').trim(); }).filter(Boolean); }
  return {
    series: String(m.seriesName || m.series || '').trim(), number: String(m.number || m.issueNumber || '').trim(),
    publisher: String(m.publisher || raw.publisher || i.publisher || '').trim(),
    date: String(m.storeDate || m.coverDate || raw.onSaleDate || '').trim(),
    writers: list(m.writers), artists: list(m.artists), coverArtists: list(m.coverArtists), characters: list(m.characters),
    synopsis: String(m.description || '').replace(/\s+/g, ' ').trim(),
  };
}
function gradeText(i){
  var raw = i.raw || {};
  var grader = String(i.grader || raw.grader || '').trim();
  var grade = String(raw.grade || i.comic_grade || raw.comic_grade || '').trim();
  var cert = String(i.cert_number || raw.cert_number || '').trim();
  if(!grader && !grade) return '';
  return [grader, grade].filter(Boolean).join(' ') + (cert ? ' (cert #' + cert + ')' : '');
}
// A full, readable description: what it is, the key facts a buyer asks
// about, then the synopsis for comics. Plain text with line breaks.
function descriptionFor(i){
  var raw = i.raw || {};
  var lines = [String(i.name || '').trim()];
  var c = comicDetail(i);
  if(c){
    var issue = [c.series, c.number ? '#' + c.number : ''].filter(Boolean).join(' ');
    if(issue && lines[0].toLowerCase().indexOf(issue.toLowerCase()) < 0) lines.push(issue);
    if(i.variant) lines.push('Cover: ' + i.variant);
    var facts = [c.publisher ? 'Publisher: ' + c.publisher : '', c.date ? 'Release date: ' + c.date : ''].filter(Boolean).join(' · ');
    if(facts) lines.push(facts);
    var credits = [c.writers.length ? 'Writer: ' + c.writers.join(', ') : '', c.artists.length ? 'Artist: ' + c.artists.join(', ') : '', c.coverArtists.length ? 'Cover artist: ' + c.coverArtists.join(', ') : ''].filter(Boolean).join(' · ');
    if(credits) lines.push(credits);
  } else {
    var what = [i.set, i.card_number ? 'Card #' + i.card_number : '', i.variant, raw.parallel, raw.numbered ? 'Numbered ' + raw.numbered : ''].filter(Boolean).join(' · ');
    if(what) lines.push(what);
    var flags = [i.is_rookie || raw.is_rookie ? 'Rookie' : '', i.is_auto || raw.is_auto ? 'Autograph' : '', i.is_patch || raw.is_patch ? 'Patch' : '', i.is_signed || raw.is_signed ? 'Signed' + (i.signed_by || raw.signed_by ? ' by ' + (i.signed_by || raw.signed_by) : '') : ''].filter(Boolean).join(' · ');
    if(flags) lines.push(flags);
  }
  var graded = gradeText(i);
  lines.push(graded ? 'Graded: ' + graded : (i.condition ? 'Condition: ' + i.condition : ''));
  if(raw.key_notes) lines.push('Key: ' + raw.key_notes);
  var text = lines.filter(Boolean).join('\n');
  if(c && c.synopsis) text += '\n\n' + c.synopsis;
  return text.slice(0, 2000);
}

// Whatnot's listing form has more fields (Publisher, Series Title, Issue
// Number...) than its CSV template has columns, and its importer rejects a
// file with any extra column ("doesn't match any known template") -- so
// those details go in the description instead, and the CSV stays exactly
// the template's columns.
function rowFor(i){
  var map = mappingFor(categoryOf(i)).map;
  var title = [i.name, i.set, i.card_number ? '#' + i.card_number : '', i.variant].filter(Boolean).join(' - ').slice(0, 140);
  var description = descriptionFor(i);
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
        opt('source', 'shipment', 'A FOC shipment', state.source) +
        opt('source', 'category', 'A whole category', state.source) +
        opt('source', 'search', 'Search', state.source) +
        (state.source === 'shipment' ? (shipments().length ? '<select class="tsi" style="margin:6px 0 0;max-width:420px" onchange="WB.set(\'shipment\',this.value)"><option value="">Pick a shipment</option>' + shipments().map(function(g){ return '<option value="' + esc(g.id) + '"' + (g.id === state.shipment ? ' selected' : '') + '>' + esc(shipmentLabel(g)) + '</option>'; }).join('') + '</select>' : '<div style="margin-top:6px">No received books in stock from a FOC week yet. Presale placeholders don\'t count -- they show up here after RECEIVE SHIPMENT on the Comics / FOC tab.</div>') : '') +
        (state.source === 'category' ? '<select class="tsi" style="margin:6px 0 0;max-width:260px" onchange="WB.set(\'category\',this.value)"><option value="">Pick a category</option>' + allCats.map(function(x){ return '<option' + (x === state.category ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' : '') +
        (state.source === 'search' ? '<input class="tsi" style="margin:6px 0 0" placeholder="Name, set, number..." value="' + esc(state.query) + '" onchange="WB.set(\'query\',this.value)">' : '') +
      '</div>' +
      '<div><b style="color:var(--text)">GOING TO</b><br>' + opt('dest', 'show', 'A live show (temporary listings)', state.dest) + opt('dest', 'shop', 'My Whatnot shop (inventory drafts)', state.dest) + '</div>' +
      '<div><b style="color:var(--text)">LISTING TYPE</b><br>' + opt('type', 'Auction', 'Auction', state.type) + opt('type', 'Buy It Now', 'Buy It Now', state.type) + opt('type', 'Giveaway', 'Giveaway', state.type) +
        (state.type === 'Auction' ? '<div style="margin-top:6px">Starting bid: ' + opt('auctionRule', 'one', '$1', state.auctionRule) + opt('auctionRule', 'pct', '% of market', state.auctionRule) + opt('auctionRule', 'list', 'my list price', state.auctionRule) +
          (state.auctionRule === 'pct' ? '<input type="number" min="1" max="200" value="' + esc(state.auctionPct) + '" style="width:64px;background:var(--surf2);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:4px" onchange="WB.set(\'auctionPct\',this.value)"> %' : '') + '</div>' : '') +
        (state.type === 'Buy It Now' ? '<label style="display:block;margin-top:6px"><input type="checkbox"' + (state.offerable ? ' checked' : '') + ' onchange="WB.set(\'offerable\',this.checked)"> Let buyers make offers</label>' : '') +
      '</div>' +
      '<div><label><input type="checkbox"' + (state.wholeDollars ? ' checked' : '') + ' onchange="WB.set(\'wholeDollars\',this.checked)"> Round prices up to whole dollars</label> &nbsp; <label><input type="checkbox"' + (state.includeCost ? ' checked' : '') + ' onchange="WB.set(\'includeCost\',this.checked)"> Include my cost (Whatnot uses it for your profit reports; buyers never see it)</label>' +
        '</div>' +
      (cats.length ? '<div><b style="color:var(--text)">WHATNOT CATEGORY FOR EACH OF YOUR CATEGORIES</b> <span>(set once, saved for every export)</span>' +
        '<div style="margin-top:6px;overflow-x:auto">' + mappingRows(cats) + '</div>' +
        '<button class="hbtn" style="margin-bottom:0" onclick="WB.saveMapping()">SAVE CATEGORY SETTINGS</button></div>' : '') +
      '<div>' + (valuesLoaded ? '<span style="color:var(--g)">Using Whatnot\'s allowed values' + (customValues ? ' (your uploaded Values file)' : ' (Whatnot template, Sep 2026)') + '</span> -- the boxes offer Whatnot\'s own choices and turn red if a value isn\'t on its list. If Whatnot changes its lists, load the new <b>Values</b> tab here.' : 'Load the <b>Values</b> tab of Whatnot\'s CSV template (in Google Sheets: File -> Download -> CSV while on the Values tab).') +
        ' <label class="hbtn" style="display:inline-block;margin:6px 0 0;cursor:pointer">LOAD WHATNOT VALUES<input type="file" accept=".csv,text/csv" style="display:none" onchange="WB.loadValues(this.files[0]);this.value=\'\'"></label></div>' +
      previewHtml(list) +
      (warn.length ? '<div style="color:var(--gold)">' + warn.join('<br>') + '</div>' : '') +
      '<button class="hbtn" style="width:100%;padding:12px;margin-bottom:0;background:rgba(0,255,179,.12);border-color:rgba(0,255,179,.35);color:var(--g)"' + (list.length ? '' : ' disabled') + ' onclick="WB.download()">DOWNLOAD WHATNOT CSV (' + list.length + ' item' + (list.length === 1 ? '' : 's') + ')</button>' +
      '<div id="wb-after-download"></div>' +
    '</div></div>';
}

// What will actually go in the file, so the choice isn't a blind count.
function previewHtml(list){
  if(!list.length) return '';
  var rows = list.slice(0, 200).map(function(i){
    var price = priceFor(i);
    var photo = imageUrls(i).length ? '' : ' <span style="color:var(--gold)">· no photo</span>';
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text)">' + esc(i.name || 'Item') + (Number(i.qty) > 1 ? ' ×' + Number(i.qty) : '') + photo + '</span><span>' + (price ? '$' + esc(price) : '') + '</span></div>';
  }).join('');
  return '<details' + (list.length <= 12 ? ' open' : '') + ' style="border:1px solid var(--border);border-radius:8px;padding:6px 10px"><summary style="cursor:pointer;color:var(--text)">See the ' + list.length + ' item' + (list.length === 1 ? '' : 's') + ' going in this file</summary><div style="max-height:260px;overflow:auto;margin-top:6px">' + rows + '</div>' + (list.length > 200 ? '<div style="margin-top:4px">…and ' + (list.length - 200) + ' more</div>' : '') + '</details>';
}

function afterDownloadHtml(count){
  var steps = state.dest === 'show'
    ? 'On whatnot.com: Seller Hub -> Shows -> open your show -> Add -> Create Temporary Listing -> Upload CSV -> pick this file.'
    : 'On whatnot.com: Seller Hub -> Inventory -> Upload CSV (the cloud icon) -> pick this file -> Import. They arrive as drafts; check them and publish.';
  // Whatnot's CSV has no flash-sale column (and rejects extra columns), but
  // its Inventory bulk-edit table has a per-row Price & Format popup with the
  // Flash Sale switch.
  var flash = state.type === 'Buy It Now' ? ' For flash sales: Seller Hub -> Inventory -> turn on Bulk edit -> on each row, the Price & Format arrow -> Flash Sale on -> pick the discount and duration -> Apply.' : '';
  return '<div style="margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:8px;color:var(--text)">Downloaded ' + count + ' item' + (count === 1 ? '' : 's') + '. ' + esc(steps) + esc(flash) + ' After the show, bring the results back below with IMPORT SHOW RESULTS.</div>';
}

// ── Part 2: import the show report ───────────────────────────────────────
// Every non-cancelled row counts toward the show's profit, recorded or not:
// SKU and hand-linked rows record against their item, rows with no item
// (listed straight on Whatnot) record from their title and a typed-in cost,
// and $0 rows are giveaways whose cost comes off the show. Sales the live
// sticker helper already recorded during the show are recognised and never
// recorded a second time.
var COLUMN_GUESSES = {
  sku: [/^sku$/, /sku/],
  buyer: [/buyer user ?name/, /^buyer$/, /buyer name/, /^username$/, /buyer/],
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
function round2(n){ return Math.round(n * 100) / 100; }
// Random / mystery listings ("random comic", "mystery pack", "grab bag",
// "blind bag") are sold without picking a book: they never take a specific
// book from stock. Each one costs the saved random-book cost, or comes out of
// a "random pool" bin item when one is set (one per sale).
var RANDOM_RE = /\b(random|mystery|grab ?bag|blind ?(bag|box|pull|pack)?)\b/i;
function randomSettings(){ var r = (state.settings && state.settings.random) || {}; return { cost:Math.max(0, Number(r.cost) || 0), poolItemId:String(r.poolItemId || '') }; }
function randomPoolItem(){ var id = randomSettings().poolItemId; return id ? items().find(function(i){ return String(i.id) === id; }) || null : null; }
function sb(){ return typeof getSupabaseClient === 'function' ? getSupabaseClient() : null; }
function storeId(){ return typeof getActiveStoreId === 'function' ? getActiveStoreId() : ''; }

// Sales the live sticker helper recorded (reference "whatnot-live:<id>"),
// as { itemId, amount }, so the report import can skip them.
async function loadLiveSales(){
  var client = sb(), store = storeId();
  if(!client || !store) return [];
  try {
    var since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    var res = await client.from('pos_payments').select('sale_id,amount,reference').eq('store_id', store).like('reference', 'whatnot-live:%').gte('created_at', since).limit(1000);
    var pays = (res && res.data) || [];
    var itemBySale = {};
    for(var i = 0; i < pays.length; i += 100){
      var ids = pays.slice(i, i + 100).map(function(p){ return p.sale_id; });
      var lr = await client.from('pos_sale_lines').select('sale_id,item_id').in('sale_id', ids);
      ((lr && lr.data) || []).forEach(function(l){ itemBySale[l.sale_id] = l.item_id; });
    }
    return pays.map(function(p){ return { itemId:String(itemBySale[p.sale_id] || ''), amount:Number(p.amount || 0) }; }).filter(function(x){ return x.itemId; });
  } catch(e) { return []; }
}
async function loadShows(){
  var client = sb(), store = storeId();
  if(!client || !store) return [];
  try {
    var res = await client.from('whatnot_shows').select('id,title,started_at,ended_at,status,report_summary').eq('store_id', store).order('started_at', { ascending:false }).limit(25);
    return (res && res.data) || [];
  } catch(e) { return []; }
}

function buildReportRows(){
  var r = state.report; if(!r) return [];
  var cols = r.cols;
  var fee = typeof whatnotFeeSettings === 'function' ? whatnotFeeSettings() : { pct:10.9, flat:0.3 };
  var byId = {};
  items().forEach(function(i){ byId[i.id] = i; });
  var live = (r.live || []).map(function(x){ return { itemId:x.itemId, amount:x.amount, used:false }; });
  r.links = r.links || {}; r.costs = r.costs || {}; r.picks = r.picks || {}; r.modes = r.modes || {};
  return r.rows.map(function(cells, n){
    function cell(key){ return cols[key] >= 0 ? String(cells[cols[key]] || '').trim() : ''; }
    var sku = cell('sku'), title = cell('title'), price = money(cell('price')), buyer = cell('buyer').replace(/^@/, '');
    var qty = Math.max(1, Math.round(money(cell('quantity'))) || 1);
    var item = sku ? (byId[sku] || items().find(function(i){ return i.raw && i.raw.sku === sku; })) : null;
    var how = item ? 'sku' : '';
    // Random unless this row was told otherwise; a SKU match is a real item.
    var mode = r.modes[n] || (!item && RANDOM_RE.test(title) ? 'random' : 'stock');
    var lot = null;
    if(mode === 'random'){ item = randomPoolItem(); how = item ? 'pool' : ''; }
    else {
      var linked = (r.links[n] || []).map(function(id){ return byId[id]; }).filter(Boolean);
      if(linked.length){
        var base = item && linked.indexOf(item) < 0 ? [item] : [];
        lot = base.concat(linked);
        item = lot[0]; how = lot.length > 1 ? 'lot' : (how || 'manual');
        if(lot.length < 2) lot = null;
      }
      if(!item && title){
        var t = norm(title);
        var hits = items().filter(function(i){ return isSellable(i) && norm([i.name, i.set, i.card_number ? '#' + i.card_number : '', i.variant].filter(Boolean).join(' - ')) === t || isSellable(i) && norm(i.name) === t; });
        if(hits.length === 1){ item = hits[0]; how = 'title'; }
      }
    }
    var cancelled = cols.status >= 0 && isCancelled(cell('status'));
    var giveaway = !cancelled && (!(price > 0) || /giveaway/i.test(title));
    var feeCol = cell('fee');
    var feeAmount = feeCol ? Math.abs(money(feeCol)) : giveaway ? 0 : round2(price * fee.pct / 100 + fee.flat);
    var order = cell('order');
    var ref = 'whatnot:' + (order || [cell('date'), sku || norm(title), price].join('|')) + (order && (sku || title) ? ':' + (sku || norm(title)).slice(0, 40) : '');
    var liveHit = null;
    if(item && !lot && !cancelled && !giveaway) liveHit = live.find(function(l){ return !l.used && l.itemId === String(item.id) && Math.abs(l.amount - price) < 0.01; }) || null;
    if(liveHit) liveHit.used = true;
    var reason = '';
    if(cancelled) reason = 'Cancelled or refunded';
    else if(liveHit) reason = 'Recorded live during the show';
    else if(how === 'pool' && !isSellable(item)) reason = 'Random pool bin is empty -- add books to it';
    else if(lot && lot.some(function(i){ return !isSellable(i); })) reason = 'An item in this lot is already sold';
    else if(item && !isSellable(item)) reason = 'Already sold in the dashboard';
    var typed = r.costs[n] != null && r.costs[n] !== '' ? Math.max(0, Number(r.costs[n]) || 0) : null;
    var cost = lot ? round2(lot.reduce(function(a, i){ return a + Number(i.cost || 0); }, 0))
      : item ? round2(Number(item.cost || 0) * qty)
      : typed != null ? typed
      : mode === 'random' ? round2(randomSettings().cost * qty) : null;
    var soldAt = cell('date') && !isNaN(Date.parse(cell('date'))) ? new Date(cell('date')).toISOString() : '';
    // Default: SKU, hand-linked and no-item rows go in; a title match waits for a tick.
    var include = !reason && (r.picks[n] != null ? r.picks[n] : how !== 'title');
    return { n:n, sku:sku, title:title, buyer:buyer, price:price, qty:qty, item:item, lot:lot, mode:mode, how:how, giveaway:giveaway, cancelled:cancelled, cost:cost, feeAmount:feeAmount, ref:ref.slice(0, 120), soldAt:soldAt, reason:reason, include:include, done:false, result:'' };
  });
}

// The show's money, from every non-cancelled row of the report.
function showSummary(rows){
  var s = { gross:0, fees:0, cogs:0, giveawayCost:0, shipping:round2(Math.max(0, Number(state.report && state.report.shipping) || 0)), net:0, sold:0, giveaways:0, random:0, cancelled:0, missingCost:0, buyers:[] };
  var byBuyer = {};
  rows.forEach(function(x){
    if(x.cancelled){ s.cancelled++; return; }
    if(x.cost == null) s.missingCost++;
    if(x.mode === 'random') s.random += x.qty;
    var cost = x.cost || 0;
    s.fees += x.feeAmount;
    if(x.giveaway){ s.giveaways++; s.giveawayCost += cost; }
    else { s.sold += x.qty; s.gross += x.price; s.cogs += cost; }
    if(x.buyer){ var b = byBuyer[x.buyer] || (byBuyer[x.buyer] = { buyer:x.buyer, items:0, total:0 }); b.items += x.qty; b.total += x.giveaway ? 0 : x.price; }
  });
  ['gross','fees','cogs','giveawayCost'].forEach(function(k){ s[k] = round2(s[k]); });
  s.net = round2(s.gross - s.fees - s.cogs - s.giveawayCost - s.shipping);
  s.margin = s.gross > 0 ? Math.round(s.net / s.gross * 1000) / 10 : 0;
  s.buyers = Object.keys(byBuyer).map(function(k){ byBuyer[k].total = round2(byBuyer[k].total); return byBuyer[k]; }).sort(function(a, b){ return b.total - a.total; });
  return s;
}
function reportDates(rows){
  var ds = rows.map(function(x){ return x.soldAt; }).filter(Boolean).sort();
  return { first:ds[0] || '', last:ds[ds.length - 1] || '' };
}
// The show this report belongs to: one started the same day, if any.
function guessShowId(shows, rows){
  var first = reportDates(rows).first;
  if(!first) return '';
  var day = new Date(first).toDateString();
  var hit = shows.find(function(sh){ return sh.started_at && new Date(sh.started_at).toDateString() === day; });
  return hit ? hit.id : '';
}
// Splits an amount by weight in cents; the parts add up exactly.
function splitMoney(amount, weights, total){
  var cents = Math.round(amount * 100), parts = weights.map(function(w){ return Math.floor(cents * w / total); });
  parts[parts.length - 1] += cents - parts.reduce(function(a, p){ return a + p; }, 0);
  return parts.map(function(c){ return c / 100; });
}
function usd(n){ return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
function showLabel(sh){ return (sh.started_at ? new Date(sh.started_at).toLocaleDateString() + ' · ' : '') + (sh.title || 'Whatnot show'); }

function summaryHtml(s){
  var line = function(label, v, color){ return '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + label + '</span><b style="color:' + (color || 'var(--text)') + '">' + v + '</b></div>'; };
  return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin:8px 0;display:grid;gap:4px;color:var(--text)">' +
    '<div class="ph" style="margin:0">SHOW PROFIT</div>' +
    line('Sales (' + s.sold + ' item' + (s.sold === 1 ? '' : 's') + ')', usd(s.gross)) +
    line('Whatnot fees', '-' + usd(s.fees)) +
    line('Cost of goods', '-' + usd(s.cogs)) +
    line('Giveaways (' + s.giveaways + ')', '-' + usd(s.giveawayCost)) +
    '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span>Shipping you paid</span><input class="tsi" style="margin:0;width:110px;text-align:right" type="number" min="0" step="0.01" placeholder="$0.00" value="' + (s.shipping ? esc(s.shipping) : '') + '" onchange="WB.setShipping(this.value)"></div>' +
    line('Net profit', usd(s.net) + (s.gross > 0 ? ' (' + s.margin + '%)' : ''), s.net >= 0 ? 'var(--g)' : 'var(--red)') +
    (s.missingCost ? '<div style="color:var(--gold)">' + s.missingCost + ' row' + (s.missingCost === 1 ? ' has' : 's have') + ' no cost yet -- type it in below (or link the item) or profit reads high.</div>' : '') +
    (s.random ? '<div style="color:var(--dim)">' + s.random + ' random/mystery sale' + (s.random === 1 ? '' : 's') + ' -- never taken from a specific book.</div>' : '') +
    (s.cancelled ? '<div style="color:var(--dim)">' + s.cancelled + ' cancelled/refunded row' + (s.cancelled === 1 ? '' : 's') + ' left out.</div>' : '') +
    (s.buyers.length ? '<div style="color:var(--dim)">Top buyers: ' + s.buyers.slice(0, 5).map(function(b){ return '@' + esc(b.buyer) + ' ' + usd(b.total) + ' (' + b.items + ')'; }).join(' · ') + '</div>' : '') +
  '</div>';
}

function rowHtml(x){
  var status = x.done ? '<span style="color:var(--g)">' + esc(x.result) + '</span>'
    : x.reason ? '<span style="color:var(--dim)">' + esc(x.reason) + '</span>'
    : x.mode === 'random' ? '<span style="color:var(--gold)">random' + (x.how === 'pool' ? ' · from pool' : '') + '</span>'
    : x.how === 'title' ? '<span style="color:var(--gold)">matched by title</span>'
    : x.how === 'lot' ? '<span style="color:var(--g)">lot of ' + x.lot.length + '</span>'
    : x.how === 'manual' ? '<span style="color:var(--g)">linked</span>'
    : x.item ? '<span style="color:var(--g)">matched</span>'
    : '<span style="color:var(--gold)">not in inventory</span>';
  var name = x.mode === 'random' ? (x.title || 'Random') : x.lot ? x.lot.map(function(i){ return i.name; }).join(' + ') : x.item ? x.item.name : x.title || x.sku || 'Row ' + (x.n + 1);
  var extra = '';
  if(!x.cancelled && !x.done){
    var btn = function(mode, label){ return '<button class="hbtn" style="margin:0;padding:4px 8px;font-size:9px' + (x.mode === mode ? ';border-color:var(--g);color:var(--g)' : '') + '" onclick="WB.setMode(' + x.n + ',\'' + mode + '\')">' + label + '</button>'; };
    var needCost = !x.item || (x.mode === 'random' && x.how !== 'pool');
    extra = '<div style="grid-column:2 / -1;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      btn('stock', 'FROM STOCK') + btn('random', 'RANDOM – NOT FROM STOCK') +
      (needCost ? '<input class="tsi" style="margin:0;flex:0 0 110px;width:110px" type="number" min="0" step="0.01" placeholder="cost $" value="' + (x.cost == null ? '' : esc(x.cost)) + '" onchange="WB.setCost(' + x.n + ',this.value)">' : '') +
      (x.mode === 'stock' ? '<input class="tsi" style="margin:0;flex:1 1 150px;min-width:0" list="wb-inventory" placeholder="' + (x.item ? '+ add another item (lot)…' : 'or link to an item…') + '" onchange="WB.linkRow(' + x.n + ',this.value)">' : '') +
      ((state.report.links[x.n] || []).length ? '<button class="hbtn" style="margin:0;padding:4px 8px;font-size:9px" onclick="WB.unlink(' + x.n + ')">CLEAR LINKS</button>' : '') +
    '</div>';
  }
  return '<div style="display:grid;grid-template-columns:24px 1fr auto;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);align-items:start">' +
    '<input type="checkbox"' + (x.include ? ' checked' : '') + (x.reason || x.done ? ' disabled' : '') + ' onchange="WB.toggleRow(' + x.n + ',this.checked)">' +
    '<span style="color:var(--text);min-width:0">' + esc(name) + (x.qty > 1 ? ' ×' + x.qty : '') + (x.giveaway ? ' <b style="color:var(--gold)">GIVEAWAY</b>' : '') +
      '<br><span style="color:var(--dim)">' + esc(x.title) + (x.buyer ? ' · @' + esc(x.buyer) : '') + (x.cost != null ? ' · cost ' + usd(x.cost) : '') + '</span></span>' +
    '<span style="text-align:right">' + (x.giveaway ? '$0' : '$' + x.price.toFixed(2)) + '<br>' + status + '</span>' + extra + '</div>';
}

function randomSettingsHtml(){
  var rs = randomSettings(), pool = randomPoolItem();
  return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin:8px 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
    '<b style="color:var(--text)">RANDOM BOOKS</b> cost each $<input class="tsi" style="margin:0;width:90px" type="number" min="0" step="0.01" value="' + (rs.cost || '') + '" placeholder="0.00" onchange="WB.setRandom(\'cost\',this.value)">' +
    ' pool bin <input class="tsi" style="margin:0;flex:1 1 180px;min-width:0" list="wb-inventory" placeholder="none -- pick an item to count random books down" value="' + (pool ? esc(pool.name + ' — ' + pool.id) : '') + '" onchange="WB.setRandom(\'pool\',this.value)">' +
    (pool ? '<span style="color:var(--dim)">' + esc(String(pool.qty != null ? pool.qty : pool.quantity != null ? pool.quantity : '?')) + ' left</span>' : '') +
    '<div style="flex-basis:100%;color:var(--dim)">Titles with "random", "mystery", "grab bag" or "blind" start as RANDOM: they never take a specific book. With a pool bin set, each one takes 1 from the bin (at the bin\'s cost) instead.</div></div>';
}

function inventoryDatalist(){
  return '<datalist id="wb-inventory">' + items().filter(isSellable).slice(0, 3000).map(function(i){ return '<option value="' + esc((i.name || 'Item') + ' — ' + i.id) + '">'; }).join('') + '</datalist>';
}

function pastShowsHtml(){
  var list = (state.shows || []).filter(function(sh){ return sh.report_summary && typeof sh.report_summary === 'object'; });
  if(!list.length) return '';
  return '<div style="margin-top:12px"><div class="ph" style="margin:0 0 4px">PAST SHOWS</div>' + list.slice(0, 12).map(function(sh){
    var s = sh.report_summary;
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text);min-width:0">' + esc(showLabel(sh)) + '<br><span style="color:var(--dim)">' + (s.sold || 0) + ' sold · ' + (s.giveaways || 0) + ' giveaways · fees ' + usd(Number(s.fees || 0)) + '</span></span>' +
      '<span style="text-align:right">' + usd(Number(s.gross || 0)) + '<br><b style="color:' + (Number(s.net || 0) >= 0 ? 'var(--g)' : 'var(--red)') + '">net ' + usd(Number(s.net || 0)) + '</b></span></div>';
  }).join('') + '</div>';
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
    var count = function(fn){ return rows.filter(fn).length; };
    body = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin:8px 0">' +
        colSelect('sku', 'SKU') + colSelect('title', 'Item title') + colSelect('price', 'Sold price') + colSelect('quantity', 'Quantity') +
        colSelect('buyer', 'Buyer') + colSelect('order', 'Order ID') + colSelect('date', 'Date') + colSelect('status', 'Cancelled / status') + colSelect('fee', 'Fees (optional)') + '</div>' +
      summaryHtml(showSummary(rows)) +
      randomSettingsHtml() +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">Show: <select class="tsi" style="margin:0;max-width:320px" onchange="WB.setShow(this.value)"><option value="">New show from this report</option>' +
        (state.shows || []).map(function(sh){ return '<option value="' + esc(sh.id) + '"' + (sh.id === r.showId ? ' selected' : '') + '>' + esc(showLabel(sh)) + '</option>'; }).join('') + '</select>' +
        '<button class="hbtn" style="margin:0" onclick="WB.saveSummary()">SAVE SHOW PROFIT</button>' + (r.savedAt ? '<span style="color:var(--g)">saved</span>' : '') + '</div>' +
      '<div style="margin-bottom:6px">' + rows.length + ' rows · ' + count(function(x){ return x.how === 'sku' && !x.reason; }) + ' matched by SKU · ' + count(function(x){ return x.how === 'title' && !x.reason; }) + ' matched by title (tick to include) · ' + count(function(x){ return !x.item && !x.reason && x.mode !== 'random'; }) + ' not in inventory · ' + count(function(x){ return x.mode === 'random' && !x.cancelled; }) + ' random · ' + count(function(x){ return x.reason === 'Recorded live during the show'; }) + ' recorded live · ' + count(function(x){ return x.reason && x.reason !== 'Recorded live during the show'; }) + ' skipped</div>' +
      '<div style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px">' + rows.slice(0, 300).map(rowHtml).join('') + '</div>' + inventoryDatalist() +
      '<div style="margin-top:6px">Fees: taken from the report when it has a fee column, otherwise estimated with your Whatnot fee setting. Sales the live sticker helper already recorded are skipped, so nothing counts twice. Rows not in inventory are recorded as sales with the cost you type in; $0 rows are giveaways and their cost comes off the show.</div>' +
      '<button class="hbtn" style="width:100%;padding:12px;margin:8px 0 0;background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.35);color:var(--gold)"' + (ready.length && !state.importing ? '' : ' disabled') + ' onclick="WB.recordSales()">' + (state.importing ? 'RECORDING…' : 'RECORD ' + ready.length + ' SALE' + (ready.length === 1 ? '' : 'S')) + '</button>';
  }
  return '<div class="panel" style="margin-bottom:14px">' +
    '<div class="ph">IMPORT SHOW RESULTS <span style="font-size:9px;color:var(--dim)">records the sales and works out the show\'s profit</span></div>' +
    '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim)">After the show, export the report from Whatnot (Seller Hub -> your show -> Export Show Report) and load it here. Sales are recorded once, even if you load the same report again.' +
    ' <label class="hbtn" style="display:inline-block;margin:6px 0 0;cursor:pointer">LOAD SHOW REPORT CSV<input type="file" accept=".csv,text/csv" style="display:none" onchange="WB.loadReport(this.files[0]);this.value=\'\'"></label>' +
    body + pastShowsHtml() + '</div></div>';
}
async function render(){
  var el = host(); if(!el) return;
  if(!state.settings){ el.innerHTML = '<div class="panel" style="padding:14px;font-family:var(--font-mono);font-size:10px;color:var(--dim)">Loading Whatnot tools…</div>'; await Promise.all([loadSettings(), loadCycles(), loadShows().then(function(list){ if(!state.shows) state.shows = list; })]); }
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
      var loaded = await Promise.all([loadLiveSales(), loadShows()]);
      state.shows = loaded[1];
      state.report = { header:rows[0], rows:rows.slice(1).filter(function(r){ return r.some(function(c){ return String(c || '').trim(); }); }), cols:guessColumns(rows[0]), live:loaded[0], fileName:file.name || '' };
      if(state.report.cols.sku < 0 && state.report.cols.title < 0) toast('Could not find a SKU or title column -- pick them from the dropdowns');
      state.report.built = buildReportRows();
      state.report.showId = guessShowId(state.shows, state.report.built);
      render();
    } catch(e) { toast('Could not read that report: ' + e.message); }
  },
  setCol: function(key, value){ state.report.cols[key] = Number(value); state.report.built = buildReportRows(); render(); },
  toggleRow: function(n, on){ state.report.picks[n] = !!on; var x = state.report.built.find(function(r){ return r.n === n; }); if(x) x.include = on; render(); },
  setCost: function(n, value){ state.report.costs[n] = value; WB.rebuild(); },
  // Links a row to an item; a second item makes it a lot.
  linkRow: function(n, value){
    var m = String(value || '').match(/ — (\S+)$/);
    if(!m){ if(value) toast('Pick an item from the list'); return; }
    var list = state.report.links[n] || [];
    if(list.indexOf(m[1]) < 0) list.push(m[1]);
    state.report.links[n] = list; state.report.modes[n] = 'stock'; delete state.report.picks[n]; WB.rebuild();
  },
  unlink: function(n){ delete state.report.links[n]; WB.rebuild(); },
  setMode: function(n, mode){ state.report.modes[n] = mode === 'random' ? 'random' : 'stock'; delete state.report.picks[n]; WB.rebuild(); },
  setShipping: function(value){ state.report.shipping = Math.max(0, Number(value) || 0); state.report.savedAt = ''; render(); },
  setRandom: async function(field, value){
    var r = Object.assign({}, (state.settings && state.settings.random) || {});
    if(field === 'cost') r.cost = Math.max(0, Number(value) || 0);
    else { var m = String(value || '').match(/ — (\S+)$/); r.poolItemId = m ? m[1] : ''; }
    state.settings.random = r;
    await saveSettings();
    if(state.report) WB.rebuild(); else render();
  },
  // Rebuild after a cost/link change, keeping what was already recorded.
  rebuild: function(){
    var done = {};
    state.report.built.forEach(function(x){ if(x.done) done[x.n] = x; });
    state.report.built = buildReportRows().map(function(x){ return done[x.n] || x; });
    render();
  },
  setShow: function(id){ state.report.showId = String(id || ''); state.report.savedAt = ''; render(); },
  saveSummary: async function(silent){
    var r = state.report, client = sb(), store = storeId();
    if(!r) return false;
    if(!client || !store){ if(!silent) toast('Sign in to save the show'); return false; }
    try {
      var summary = showSummary(r.built);
      var dates = reportDates(r.built);
      if(!r.showId){
        var day = dates.first ? new Date(dates.first) : new Date();
        var ins = await client.from('whatnot_shows').insert({ store_id:store, platform:'whatnot', title:'Whatnot show ' + day.toLocaleDateString(), category:'Mixed', status:'ended', started_at:day.toISOString(), ended_at:dates.last || day.toISOString() }).select('*').limit(1);
        if(ins.error) throw ins.error;
        r.showId = ins.data[0].id;
        state.shows = [ins.data[0]].concat(state.shows || []);
      }
      var saved = Object.assign({}, summary, { savedAt:new Date().toISOString(), fileName:r.fileName || '', firstSaleAt:dates.first, lastSaleAt:dates.last,
        items:r.built.filter(function(x){ return !x.cancelled; }).slice(0, 400).map(function(x){ return { title:x.mode === 'random' ? x.title : x.lot ? x.lot.map(function(i){ return i.name; }).join(' + ') : x.item ? x.item.name : x.title, buyer:x.buyer, price:x.price, qty:x.qty, cost:x.cost, fee:x.feeAmount, giveaway:x.giveaway, random:x.mode === 'random', itemIds:x.lot ? x.lot.map(function(i){ return i.id; }) : x.item ? [x.item.id] : [] }; }) });
      var up = await client.from('whatnot_shows').update({ report_summary:saved }).eq('id', r.showId).eq('store_id', store);
      if(up && up.error) throw up.error;
      (state.shows || []).forEach(function(sh){ if(sh.id === r.showId) sh.report_summary = saved; });
      r.savedAt = saved.savedAt;
      if(!silent) toast('Show profit saved: net ' + usd(summary.net));
      render();
      return true;
    } catch(e) { if(!silent) toast('Could not save the show: ' + (e.message || e)); return false; }
  },
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
        var res, d;
        if(x.lot){
          // A lot: each item comes out of stock, the price and fee split by list price.
          var weights = x.lot.map(function(i){ return Math.max(0.01, Number(priceFor(i)) || 0); });
          var total = weights.reduce(function(a, w){ return a + w; }, 0);
          var priceParts = splitMoney(x.giveaway ? 0 : x.price, weights, total), feeParts = splitMoney(x.feeAmount, weights, total);
          var allOk = true, anyNew = false, err = '';
          for(var j = 0; j < x.lot.length; j++){
            var part = { channel:'Whatnot', itemId:x.lot[j].id, salePrice:priceParts[j], feeAmount:feeParts[j], quantitySold:1, soldAt:x.soldAt || undefined, externalRef:(x.ref.slice(0, 110) + ':lot' + j) };
            if(x.giveaway || !(priceParts[j] > 0)) part.giveaway = true;
            res = await storeWorkerFetch('/inventory/record-external-sale', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(part) });
            d = await res.json().catch(function(){ return {}; });
            if(d.ok && !d.duplicate) anyNew = true;
            else if(!(d.ok || res.status === 409)){ allOk = false; err = d.error || 'Failed'; }
          }
          d = allOk ? { ok:true, duplicate:!anyNew } : { ok:false, error:err };
        } else {
          var payload = { channel:'Whatnot', salePrice:x.giveaway ? 0 : x.price, feeAmount:x.feeAmount, quantitySold:x.qty, soldAt:x.soldAt || undefined, externalRef:x.ref };
          if(x.giveaway) payload.giveaway = true;
          if(x.item) payload.itemId = x.item.id;
          else { payload.title = (x.mode === 'random' ? 'Random: ' : '') + (x.title || x.sku || 'Whatnot item'); payload.cost = x.cost || 0; }
          res = await storeWorkerFetch('/inventory/record-external-sale', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
          d = await res.json().catch(function(){ return {}; });
        }
        if(d.ok && d.duplicate){ x.done = true; x.result = 'Already recorded'; dupes++; }
        else if(d.ok){ x.done = true; x.result = 'Recorded'; recorded++; }
        else if(res.status === 409){ x.done = true; x.result = 'Already sold'; dupes++; }
        else { x.result = d.error || 'Failed'; x.reason = x.result; failed++; }
      } catch(e) { x.result = e.message; x.reason = e.message; failed++; }
    }
    state.importing = false;
    toast('Whatnot import: ' + recorded + ' recorded' + (dupes ? ', ' + dupes + ' already recorded' : '') + (failed ? ', ' + failed + ' failed' : ''));
    if(typeof logOpsEvent === 'function') logOpsEvent('whatnot_report_import', 'Imported Whatnot show report', { recorded:recorded, duplicates:dupes, failed:failed });
    await WB.saveSummary(true);
    render();
    if(recorded && typeof loadInventory === 'function') loadInventory().catch(function(){});
  },
};
// From the FOC cover wall: SEND TO WHATNOT opens this panel with that
// week's received books chosen (fetching just-received rows first).
window.sendFocShipmentToWhatnot = async function(cycleId){
  if(typeof refreshBuiltInInventoryDelta === 'function'){ try { await refreshBuiltInInventoryDelta(); } catch(e){} }
  state.source = 'shipment'; state.shipment = String(cycleId || '');
  if(typeof switchTab === 'function') switchTab('whatnot');
  await render();
  var count = chosenItems().length;
  toast(count ? count + ' book' + (count === 1 ? '' : 's') + ' from this shipment ready for Whatnot' : 'No in-stock books from this shipment yet -- receive it first');
};
window.renderWhatnotBridge = render;
// The live sticker helper asks this for a random/mystery sale: the random
// pool bin when one is set and still has books, else nothing (the sale is
// then only logged on the show and the report import records it).
window.whatnotRandomPoolItem = async function(title){
  if(!RANDOM_RE.test(String(title || ''))) return null;
  if(!state.settings) await loadSettings();
  var pool = randomPoolItem();
  return pool && isSellable(pool) ? pool : null;
};
window.whatnotIsRandomTitle = function(title){ return RANDOM_RE.test(String(title || '')); };
if(typeof activeTab !== 'undefined' && activeTab === 'whatnot') render();
})();
