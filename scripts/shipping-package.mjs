// How each item ships (store, 2026-11-05: "Whatnot will need to have correct
// shipping for the pokemon sealed and singles ... Some singles go in the small
// bubble mailer. Is it over 20 dollars? Those aren't the pwe. You know what is
// what for shipping in the system. Fix the shipping issues for all items").
//
// One answer for every channel (Whatnot listings, the website's shipping
// quote): the package an item goes out in, its packed weight and outside
// size. Sealed product is told apart by what the item says it is -- the
// sealed flag, its product type, or its name ("Elite Trainer Box", "Booster
// Bundle") -- never only the flag, which most imported sealed items lack.
// A weight typed on the item (data.shipWeightOz, and optionally
// data.shipDims "L x W x H" in inches) beats the chart.

// Raw singles under this price go in a plain white envelope; at or over it,
// a toploader in a small bubble mailer with tracking.
export const PWE_MAX_PRICE = 20;

// kind -> packed weight (oz), outside size (in), and what's inside alone
// (contentsOz, for adding several items into one parcel).
export const PACKAGES = {
  pwe: { name: 'Single card (envelope)', weightOz: 1, length: 6, width: 4, height: 0.25, contentsOz: 0.3 },
  bubble: { name: 'Single card (bubble mailer)', weightOz: 2, length: 7.25, width: 5, height: 0.75, contentsOz: 0.6 },
  slab: { name: 'Graded card (padded mailer)', weightOz: 7, length: 9, width: 6, height: 1.5, contentsOz: 4 },
  comic: { name: 'Comic (Gemini mailer)', weightOz: 8, length: 12.75, width: 7.75, height: 1.25, contentsOz: 3 },
  pack: { name: 'Booster pack (bubble mailer)', weightOz: 2, length: 7.25, width: 5, height: 1, contentsOz: 1 },
  small_sealed: { name: 'Blister / mini tin / deck', weightOz: 8, length: 9, width: 6, height: 2.5, contentsOz: 5 },
  bundle: { name: 'Booster bundle / small collection', weightOz: 12, length: 9, width: 7, height: 3, contentsOz: 8 },
  tin: { name: 'Tin', weightOz: 16, length: 9, width: 7, height: 5, contentsOz: 11 },
  box: { name: 'Sealed box', weightOz: 16, length: 10, width: 8, height: 4, contentsOz: 11 },
  etb: { name: 'Elite Trainer Box', weightOz: 40, length: 12, width: 10, height: 5, contentsOz: 28 },
  booster_box: { name: 'Booster box', weightOz: 40, length: 10, width: 8, height: 6, contentsOz: 26 },
  premium: { name: 'Premium / special collection', weightOz: 48, length: 14, width: 10, height: 5, contentsOz: 34 },
  large_supply: { name: 'Large supply item', weightOz: 64, length: 16, width: 12, height: 6, contentsOz: 48 },
  case: { name: 'Sealed case', weightOz: 192, length: 18, width: 14, height: 12, contentsOz: 170 },
};

const SLAB_RE = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|HGA|ACE)\s*(?:GEM\s*(?:MINT|MT)\s*|MINT\s*|PRISTINE\s*)?(10|[1-9](?:\.5)?)(?![\d.])/i;
const SEALED_NAME = /\b(booster|sleeved|pack|packs|elite trainer|etb|bundle|tin|tins|blister|collection|display|case|starter|theme deck|battle deck|build\s*&?\s*battle|box|premium|sealed|checklane|gift set|countdown calendar|advent)\b/i;
// A printed card number ("4/102", "#199", "SV07 123") marks a single, even
// when its set is called "... Collection".
const hasCardNumber = (d, name) => !!String(d.cardNumber || d.card_number || d.number || '').trim() || /\b\d{1,3}\s*\/\s*\d{1,3}\b|#\s*\d+/.test(name);

// Supplies (sleeves, toploaders, pages, displays) by what they are, never by
// the sealed-product words ("Deck Case", "50 CT. Pack", "Acrylic Display").
function supplyKind(name) {
  const n = name.toLowerCase();
  if (/\b(helmet|jersey|bat tube|football|basketball|storage box|stor-folio|album|binder|portfolio|frame)\b/.test(n)) return 'large_supply';
  if (/\b(sleeves?|deck guard|deck case|deck box|toploaders?|topload|screwdown|one[- ]touch|magnetic|semi[- ]rigid|card saver|penny|team bags?|bumpers?|puck|baseball display|coin)\b/.test(n)) return 'small_sealed';
  return 'box';
}
function sealedKind(name, category = '') {
  const n = name.toLowerCase();
  // A Magic set "Bundle" is an ETB-sized box (a Pokemon "Booster Bundle" is not).
  if (/magic|mtg/.test(category) && /\bbundle\b/.test(n) && !/booster bundle/.test(n)) return 'etb';
  if (/\bdeck display\b/.test(n)) return 'premium';
  if (/secret lair/.test(n)) return 'small_sealed';
  if (/\bcase\b/.test(n)) return 'case';
  if (/\b(ultra[\s-]*premium|super[\s-]*premium|premium collection|special collection|upc)\b/.test(n)) return 'premium';
  if (/\b(elite trainer|etb)\b/.test(n)) return 'etb';
  if (/\b(booster box|booster display|display box|display)\b/.test(n)) return 'booster_box';
  if (/\bmini tins?\b/.test(n)) return 'small_sealed';
  if (/\btins?\b/.test(n)) return 'tin';
  if (/\b(blister|checklane|theme deck|battle deck|starter deck|deck)\b/.test(n)) return 'small_sealed';
  if (/\b(booster bundle|bundle|build\s*&?\s*battle|knock ?out collection|collection)\b/.test(n)) return 'bundle';
  if (/\b(booster pack|sleeved booster|pack)\b/.test(n) && !/\b\d+[\s-]*pack\b/.test(n)) return 'pack';
  return 'box';
}

// d: the item's data; price: what it sells for (the website/Whatnot price).
export function packageFor(d = {}, price = 0) {
  const name = String(d.name || d.title || '');
  const custom = Number(d.shipWeightOz);
  const dims = String(d.shipDims || '').match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  const category = String(d.category || d.type || '').toLowerCase();
  const productType = String(d.productType || d.product_type || '').toLowerCase();
  let kind;
  if (/comic|manga|graphic novel/.test(category) && !/sealed|supplies/.test(productType)) kind = 'comic';
  else if (d.isSlabbed === true || (String(d.grader || d.gradingCompany || d.grading_company || '').trim() && String(d.grade || '').trim()) || SLAB_RE.test(name)) kind = 'slab';
  else if (/suppl/.test(category)) kind = supplyKind(name);
  // A promo card still in its wrapper ("... Promo ... SEALED") is a single.
  else if (/\bpromo\b/i.test(name) && !/\b(box|pack|collection|tin|blister|bundle)\b/i.test(name) && d.isSealed !== true && d.is_sealed !== true) kind = Number(price) >= PWE_MAX_PRICE ? 'bubble' : 'pwe';
  else if (d.isSealed === true || d.is_sealed === true || /sealed/.test(productType) || /sealed/.test(category) || (SEALED_NAME.test(name) && !hasCardNumber(d, name))) kind = sealedKind(name, category);
  else kind = Number(price) >= PWE_MAX_PRICE ? 'bubble' : 'pwe';
  const base = PACKAGES[kind];
  if (custom > 0) {
    const [l, w, h] = dims ? dims.slice(1).map(Number) : [base.length, base.width, base.height];
    return { kind: 'custom', name: 'Custom (' + custom + ' oz)', weightOz: custom, length: l, width: w, height: h, contentsOz: Math.max(0.3, custom - (base.weightOz - base.contentsOz)) };
  }
  return { kind, ...base };
}

// A bundle ships as one parcel (store, 2026-11-08: "more than one book for
// sale bundled. And shipping weights etc update?"): the biggest member's
// package with everyone's contents inside, stacked. members: [{ data, price }].
// Flat things stack thin; boxes add their own height.
const STACK_IN = { pwe: 0.05, bubble: 0.1, pack: 0.25, comic: 0.2, slab: 0.5 };
export function bundlePackage(members = []) {
  const pkgs = members.map(m => packageFor(m?.data || m || {}, Number(m?.price) || 0));
  if (!pkgs.length) return null;
  const vol = p => p.length * p.width * p.height;
  const biggest = pkgs.reduce((a, b) => (vol(b) > vol(a) ? b : a));
  const contentsOz = pkgs.reduce((n, p) => n + p.contentsOz, 0);
  const packing = Math.max(0, biggest.weightOz - biggest.contentsOz);
  const extra = pkgs.filter(p => p !== biggest).reduce((n, p) => n + (STACK_IN[p.kind] ?? p.height), 0);
  const height = Math.ceil((biggest.height + extra) * 4) / 4;
  // Thin mailers grow into a box once the stack is thick.
  const box = height > 3 && ['pwe', 'bubble', 'pack', 'slab'].includes(biggest.kind) ? PACKAGES.box : null;
  return {
    kind: 'custom', name: 'Bundle (' + pkgs.length + ' items)',
    weightOz: Math.ceil(contentsOz + Math.max(packing, box ? box.weightOz - box.contentsOz : 0)),
    length: box ? box.length : biggest.length, width: box ? box.width : biggest.width, height: box ? Math.max(height, box.height) : height,
    contentsOz: Math.round(contentsOz * 10) / 10,
  };
}
