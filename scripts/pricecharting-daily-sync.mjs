// Daily comic and sports price update on the Worker's schedule (store,
// 2026-10-31: "Have all prices been running automatically each day after the
// sources have their new prices?" -- comics, sports and Magic last updated
// 10/28: their update only ran when a dashboard was open after 3 AM).
//
// Same rules as the dashboard's SYNC COMIC PRICES / SYNC SPORTS PRICES, for
// every in-stock comic and sports card with an exact PriceCharting product:
//   comics -- the raw guide (adjusted for condition), or the nearest graded
//             guide for a slab (comicSyncedGuidePrice on the dashboard);
//             a book with no link is looked up by its full barcode, then by
//             series + issue + cover (the Worker's /comics/by-upc).
//   sports -- the ungraded guide, or the slab's grade (pcGradeBucket).
// A change under 10% is applied; a bigger one -- and any comic found only by
// its title -- waits in PRICE SYNC for review. A batch each hour from 3 AM
// Pacific until all are checked. Cards with no PriceCharting link are left to
// the dashboard's own sync (it searches by name).
import { pacificDay, pacificHour, SMALL_CHANGE_PCT } from './pokemon-daily-sync.mjs';

export const PC_SYNC_BATCH = 80;
export const PC_SYNC_START_HOUR = 3; // Pacific
const IDS_PER_CALL = 40;      // /pricing/pricecharting/products/batch
const LOOKUPS_PER_CALL = 15;  // /pricing/pricecharting/comics/by-upc
const CHUNK = 20;             // looked up, then saved, a group at a time

const SPORTS_CATEGORY = /^(sports?(\s+cards?)?|baseball|basketball|football|hockey|soccer|wrestling|ufc|mma|racing|golf|tennis|boxing)(\s+cards?)?$/i;
const SLAB_RE = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|HGA|CBCS)\s*(?:GEM\s*(?:MINT|MT)\s*|MINT\s*|PRISTINE\s*)?(10|[1-9](?:\.\d)?)(?![\d.])/i;
const MERCH = /suppl|plush|figure|funko|\bpop\b|toy|apparel|shirt|memorabilia|accessor/i;

function money(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; }
function marketOf(d = {}) { for (const v of [d.marketPrice, d.rawMarketPrice, d.market, d.price, d.displayPrice]) { const n = money(v); if (n > 0) return n; } return 0; }
function ruled(market, rule) {
  const bump = Math.max(market * (Number(rule?.pct) || 0) / 100, Number(rule?.flat) || 0, 0);
  return market > 0 ? Math.ceil(market + bump - 1e-9) : 0;
}

export function syncKind(row = {}) {
  const d = row.data || {};
  if (row.status !== 'in_stock' || d.archivedAt) return '';
  if (d.dropship === true || d.ownershipType === 'supplier') return '';
  if (/^foc_presale/.test(String(d.source || ''))) return ''; // sells at the preorder price until received
  const cat = String(d.category || '').trim();
  if (/comic/i.test(cat)) return 'comic';
  if (SPORTS_CATEGORY.test(cat)) return 'sports';
  return '';
}
export function checkedToday(d = {}, now = Date.now()) {
  return !!d.priceSyncCheckedAt && pacificDay(d.priceSyncCheckedAt) === pacificDay(now);
}

// The exact PriceCharting product saved on the item.
export function pricechartingIdOf(kind, d = {}) {
  if (kind === 'comic') {
    const meta = d.comicMetadata || {}, cover = meta.selectedCover || d.selectedComicCover || {}, refs = d.externalRefs || {};
    const id = String(d.pricechartingProductId || d.providerProductId || meta.pricechartingProductId || cover.pricechartingProductId || refs.pricechartingProductId || '').trim();
    return /^\d+$/.test(id) ? id : '';
  }
  const id = [d.pricechartingProductId, d.sourceProductId].map(v => String(v || '').trim()).find(v => /^\d+$/.test(v));
  if (id) return id;
  return (String(d.providerUrl || '').match(/^https?:\/\/(?:www\.)?(?:pricecharting|sportscardspro)\.com\/game\/(\d+)\/?(?:[?#].*)?$/i) || [])[1] || '';
}
export function comicFullUpc(d = {}) {
  const digits = String(d.upc || d.barcode || '').replace(/\D/g, '');
  return digits.length === 17 ? digits : '';
}
// Same as comicInventoryTitleHint on the dashboard.
export function comicTitleHint(d = {}) {
  const detail = d.focComicDetail || {}, meta = d.comicMetadata || {};
  const name = String(d.name || d.title || '').replace(/\s+/g, ' ').trim();
  const series = String(d.series || meta.seriesName || meta.series || detail.seriesName || '').replace(/\s+/g, ' ').trim();
  if (!series) return null;
  let issue = String(d.issue || d.issueNumber || meta.number || meta.issueNumber || detail.number || '').replace(/^#/, '').trim();
  if (!issue) issue = (name.match(/#\s*(\d+(?:\.\d+)?[a-z]?)\b/i) || [])[1] || '';
  const escaped = series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cover = [name.replace(new RegExp(escaped, 'i'), ' '), d.variant || '']
    .join(' ').replace(/#\s*\d+(?:\.\d+)?[a-z]?\b/i, ' ').replace(/--/g, ' ').replace(/\s+/g, ' ').trim();
  return { series, issue: issue || '1', cover };
}
export function gradingOf(d = {}) {
  const grader = String(d.grader || d.grading_company || '').trim(), grade = String(d.grade || '').trim();
  if (grader && grade) return { grader, grade };
  if (MERCH.test(String(d.category || ''))) return { grader, grade };
  const m = [d.selectedGrade, d.name, d.cardName].map(v => String(v || '').match(SLAB_RE)).find(Boolean);
  return m ? { grader: grader || m[1], grade: grade || m[2] } : { grader, grade };
}
// Same buckets as pcGradeBucket on the dashboard.
export function pcGradeBucket(company = '', grade = '') {
  const g = String(grade || '').toLowerCase().replace(/^(psa|bgs|cgc|sgc)\s*/, '').replace(/[^0-9.]/g, '');
  const c = String(company || '').toLowerCase();
  if (g === '10' && (c.includes('bgs') || c.includes('beckett'))) return 'bgs10';
  if (g === '10' && c.includes('cgc')) return 'cgc10';
  if (g === '10' && c.includes('sgc')) return 'sgc10';
  if (g === '10') return 'psa10';
  if (g === '9.5') return 'grade9_5';
  if (g.startsWith('9')) return 'grade9';
  if (g.startsWith('8')) return 'grade8';
  if (g.startsWith('7')) return 'grade7';
  return '';
}
// Same as comicSyncedGuidePrice on the dashboard.
export function comicGuidePrice(d = {}, product = {}) {
  const prices = product.comicPrices || {};
  const meta = d.comicMetadata || {};
  const slabbed = !!(d.isSlabbed || d.is_slabbed || meta.isSlabbed || d.grader || d.certNumber || d.cert_number);
  const numeric = Number(d.numericGrade || d.grade || d.comic_grade || meta.numericGrade || 0);
  if (slabbed && numeric) {
    const nearest = [['grade4', 4], ['grade6', 6], ['grade8', 8], ['grade9_2', 9.2], ['grade9_4', 9.4], ['grade9_8', 9.8], ['grade10', 10]]
      .filter(([k]) => Number(prices[k] || 0) > 0).sort((a, b) => Math.abs(a[1] - numeric) - Math.abs(b[1] - numeric))[0];
    return nearest ? { price: Number(prices[nearest[0]]), path: 'comicPrices.' + nearest[0], label: 'PriceCharting graded ' + nearest[1] + ' guide' } : null;
  }
  const raw = Number(prices.ungraded || 0);
  if (!raw) return null;
  const condition = String(d.conditionText || meta.conditionText || d.condition || 'Near Mint');
  const factors = { Poor: .20, Fair: .30, Good: .45, 'Very Good': .60, Fine: .75, 'Very Fine': .90, 'Near Mint': 1, NM: 1, LP: .90, MP: .75, HP: .45, DMG: .20 };
  const factor = Number(factors[condition] ?? 1);
  return { price: Math.round(raw * factor * 100) / 100, path: 'comicPrices.ungraded' + (factor === 1 ? '' : ' * ' + condition + ' condition estimate'), label: 'PriceCharting raw guide' + (factor === 1 ? '' : ' · ' + condition + ' estimate') };
}
export function sportsGuidePrice(d = {}, product = {}) {
  const prices = product.prices || {};
  const { grader, grade } = gradingOf(d);
  if (grader && grade) {
    const bucket = pcGradeBucket(grader, grade);
    const price = Number(bucket ? prices[bucket] || 0 : 0);
    return price > 0 ? { price, path: 'prices.' + bucket, label: 'PriceCharting graded (' + grader + ' ' + grade + ')' } : null;
  }
  const price = Number(prices.ungraded || 0);
  return price > 0 ? { price, path: 'prices.ungraded', label: 'PriceCharting' } : null;
}

// One row + its PriceCharting product -> what to write now, and/or what to queue.
// viaTitle: a comic matched by title only -- never applied or linked without review.
export function planRow(row, kind, product, { viaTitle = false, now = Date.now() } = {}) {
  const d = row.data || {};
  const at = new Date(now).toISOString();
  const checked = { ...d, priceSyncCheckedAt: at };
  const okProduct = product && product.productId && (kind !== 'comic' || /^comic books\b/i.test(String(product.consoleName || '')));
  const guide = okProduct ? (kind === 'comic' ? comicGuidePrice(d, product) : sportsGuidePrice(d, product)) : null;
  const fresh = money(guide?.price);
  if (!(fresh > 0)) return { kind: 'no-price', data: checked };
  const link = viaTitle ? {} : kind === 'comic'
    ? { pricechartingProductId: String(product.productId), pricechartingProductName: product.productName || d.pricechartingProductName || '', pricechartingComicPrices: product.comicPrices || null, providerUrl: d.providerUrl || product.url || '' }
    : { pricechartingProductId: String(product.productId), ...(String(d.providerUrl || '').trim() ? {} : product.url ? { providerUrl: product.url } : {}) };
  const source = kind === 'comic' ? guide.label : guide.label + ' (#' + product.productId + ')';
  const old = marketOf(d);
  if (old > 0 && Math.abs(fresh - old) < 0.01) {
    return { kind: 'unchanged', data: { ...checked, ...link, priceUpdatedAt: at, lastPriceUpdate: at, stalePrice: false, livePriceStatus: 'live', marketPriceSource: source, priceSource: source + ' server sync' } };
  }
  const deltaPct = old > 0 ? Math.abs(fresh - old) / old * 100 : 100;
  if (viaTitle || (old > 0 && deltaPct >= SMALL_CHANGE_PCT)) {
    return { kind: 'review', data: checked, proposal: {
      itemId: row.id, name: d.name || '', oldPrice: old, newPrice: fresh, deltaPct: Math.round(deltaPct * 10) / 10, direction: fresh >= old ? 'up' : 'down',
      mode: kind === 'comic' ? 'comic-live' : 'sports-live', source, matchStatus: viaTitle ? 'PriceCharting title match (server daily check) -- check the cover' : 'exact PriceCharting product (server daily check)',
      pricechartingProductId: String(product.productId), pricechartingProductName: product.productName || '', pricechartingComicPrices: kind === 'comic' ? product.comicPrices || null : null,
      providerUrl: product.url || '', pricePath: guide.path, linkFields: kind === 'sports' ? link : null, lastUpdated: at, at,
    } };
  }
  const locked = Number(d.priceOverride || 0) > 0;
  const list = locked ? {} : { salePrice: ruled(fresh, d.priceRule), listPrice: ruled(fresh, d.priceRule) };
  return { kind: 'applied', oldPrice: old, newPrice: fresh, data: { ...checked, ...link, ...list,
    market: fresh, price: fresh, displayPrice: fresh, marketPrice: fresh, rawMarketPrice: fresh, lastMarketPrice: old, previousMarketPrice: old,
    marketPriceSource: source, priceSource: source + ' server sync', priceSyncRequestPath: guide.path, lastPriceUpdate: at, priceUpdatedAt: at, stalePrice: false, livePriceStatus: 'live' } };
}

// This hour's rows: linked ones, plus comics a barcode or title can look up.
export function nextBatch(rows = [], now = Date.now(), size = PC_SYNC_BATCH) {
  return rows.map(row => ({ row, kind: syncKind(row) })).filter(x => x.kind && !checkedToday(x.row.data, now))
    .filter(x => pricechartingIdOf(x.kind, x.row.data) || (x.kind === 'comic' && (comicFullUpc(x.row.data) || comicTitleHint(x.row.data))))
    .sort((a, b) => String(a.row.data?.priceSyncCheckedAt || '').localeCompare(String(b.row.data?.priceSyncCheckedAt || '')))
    .slice(0, size);
}

// Picking the batch needs only these keys. 2026-10-31: the first run asked
// for every in-stock item's whole record at once (some carry photos, ~25 KB
// each); the API caps a request at 1,000 rows and the answer was too big to
// use, so nothing was checked. Now: comic and sports rows only, these keys
// only, a page at a time.
const PICK_KEYS = ['category', 'archivedAt', 'dropship', 'ownershipType', 'source', 'priceSyncCheckedAt',
  'pricechartingProductId', 'providerProductId', 'sourceProductId', 'providerUrl', 'upc', 'barcode',
  'name', 'title', 'series', 'issue', 'issueNumber', 'variant', 'comicMetadata', 'selectedComicCover', 'externalRefs', 'focComicDetail'];
const PICK_SELECT = 'id,status,' + PICK_KEYS.map(k => `k_${k}:data->${k}`).join(',');
const PICK_CATEGORY = 'comic|sport|baseball|basketball|football|hockey|soccer|wrestling|ufc|mma|racing|golf|tennis|boxing';
async function loadCandidateRows(deps, s) {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data } = await deps.db(`inventory_items?store_id=eq.${s}&status=eq.in_stock&data->>category=imatch.${encodeURIComponent(PICK_CATEGORY)}&select=${PICK_SELECT}&order=id.asc&limit=1000&offset=${offset}`);
    const page = data || [];
    for (const r of page) rows.push(r.data ? r : { id: r.id, status: r.status, data: Object.fromEntries(PICK_KEYS.filter(k => r['k_' + k] != null).map(k => [k, r['k_' + k]])) });
    if (page.length < 1000) break;
  }
  return rows;
}

// deps: { db(path, opts), products(ids) -> { [id]: { ok, product } }, comicLookup(items) -> { [key]: { ok, via, product } }, kvGet, kvPut }
export async function runPriceChartingServerSync(storeId, deps, now = Date.now()) {
  if (pacificHour(now) < PC_SYNC_START_HOUR) return { skipped: 'before 3 AM' };
  const s = encodeURIComponent(storeId);
  const rows = await loadCandidateRows(deps, s);
  const picked = nextBatch(rows, now);
  const out = { checked: 0, applied: 0, unchanged: 0, review: 0, noPrice: 0, failed: 0, left: 0, candidates: rows.length };
  if (!picked.length) return out;
  // The whole record only for this hour's batch (the update writes it back).
  const full = new Map();
  for (let i = 0; i < picked.length; i += 40) {
    const ids = picked.slice(i, i + 40).map(x => encodeURIComponent(x.row.id)).join(',');
    const { data } = await deps.db(`inventory_items?store_id=eq.${s}&status=eq.in_stock&id=in.(${ids})&select=id,status,data`);
    for (const r of data || []) full.set(r.id, r);
  }
  const batch = picked.filter(x => full.has(x.row.id)).map(x => ({ row: full.get(x.row.id), kind: syncKind(full.get(x.row.id)) })).filter(x => x.kind);

  // 20 at a time, each group saved before the next is looked up, so a run
  // cut short (Cloudflare's time limit on a scheduled run) keeps what it
  // finished -- before, nothing was saved until all 80 were looked up, and
  // the same 80 were picked again every hour. No new group starts after
  // the time budget.
  const queue = [];
  const deadline = Date.now() + (deps.budgetMs ?? 8 * 60 * 1000);
  for (let g = 0; g < batch.length; g += CHUNK) {
    if (g > 0 && Date.now() >= deadline) { out.stoppedEarly = true; break; }
    const group = batch.slice(g, g + CHUNK);
    // Comics with no link: barcode first, then series + issue + cover.
    const found = new Map();
    const lookups = group.filter(x => !pricechartingIdOf(x.kind, x.row.data));
    for (let i = 0; i < lookups.length; i += LOOKUPS_PER_CALL) {
      const part = lookups.slice(i, i + LOOKUPS_PER_CALL);
      let got = {};
      try { got = await deps.comicLookup(part.map(x => ({ key: x.row.id, upc: comicFullUpc(x.row.data), ...(comicTitleHint(x.row.data) || {}) }))) || {}; } catch (_) {}
      for (const x of part) if (got[x.row.id]?.ok && got[x.row.id].product?.productId) found.set(x.row.id, { product: got[x.row.id].product, viaTitle: got[x.row.id].via === 'title' });
    }
    // Linked ones: their saved product.
    const ids = [...new Set(group.map(x => pricechartingIdOf(x.kind, x.row.data)).filter(Boolean))];
    const byId = new Map();
    for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
      let got = {};
      try { got = await deps.products(ids.slice(i, i + IDS_PER_CALL)) || {}; } catch (_) {}
      for (const [id, r] of Object.entries(got)) if (r?.ok && r.product) byId.set(id, r.product);
    }
    for (const { row, kind } of group) {
      const id = pricechartingIdOf(kind, row.data);
      const hit = id ? { product: byId.get(id) || null, viaTitle: false } : (found.get(row.id) || { product: null, viaTitle: false });
      let plan;
      try {
        // One odd item can't stop the rest.
        plan = planRow(row, kind, hit.product, { viaTitle: hit.viaTitle, now });
        const res = await deps.db(`inventory_items?id=eq.${encodeURIComponent(row.id)}&store_id=eq.${s}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: plan.data, updated_at: new Date(now).toISOString() }) });
        if (res?.response && !res.response.ok) throw new Error('save failed');
      } catch (e) { out.failed++; (out.errors ||= []).length < 5 && out.errors.push(row.id + ': ' + String(e.message || e).slice(0, 120)); continue; }
      out.checked++;
      if (plan.kind === 'applied') out.applied++;
      else if (plan.kind === 'unchanged') out.unchanged++;
      else if (plan.kind === 'review') { out.review++; queue.push(plan.proposal); }
      else out.noPrice++;
    }
  }
  if (queue.length) {
    const key = 'price-sync-review:' + storeId;
    const existing = (await deps.kvGet(key)) || [];
    const merged = new Map(existing.map(p => [p.itemId, p]));
    for (const p of queue) merged.set(p.itemId, p);
    await deps.kvPut(key, [...merged.values()].slice(-500));
  }
  out.left = Math.max(0, nextBatch(rows, now, 100000).length - out.checked);
  return out;
}
