// The Mana Pocket PRH backlist catalog service.
//
// PRH's backlist feed (DM_BIZ_Backlist-US_PRH_metadata_full.csv) lists
// PRH's entire in-print catalog -- comics AND regular books -- with no
// weekly cutoff the way the FOC feed has. A customer can buy any title in
// it any time it's orderable; the physical book rides whichever weekly PRH
// order the store places next (see foc-preorders.mjs's exportPrh) rather
// than shipping from shelf stock. Deliberately kept as its own tables/
// routes rather than folded into foc_cycles/comic_skus, which are built
// around a real cutoff a perpetually-open backlist catalog would have to
// fake -- see 2026-09-19-backlist-catalog.sql.
//
// Mirrors the FOC preorder pipeline's shape (checkout -> Stripe -> webhook
// -> pos_sales, receive -> inventory_items) closely, reusing its row-
// normalization helpers, but every route here is its own implementation --
// no cycle/cutoff validation exists anywhere in this file, on purpose.

import {
  text, exactIdentifier, dateIso, cents, issueNumber, titleWithoutVariant,
  variantLabel, prhFlags, inFilter, requireShippingRate,
} from './foc-preorders.mjs';
import { awardWebOrderLoyalty } from './web-loyalty.mjs';

// PRH's OrderRequirement ratio text isn't always "1:N" -- the real backlist
// feed also carries "2:40"-style ratios foc-preorders.mjs's own
// ratioThreshold() (1:N only) would silently miss. Threshold is the second
// number: "order N copies to unlock M of this cover" reads as "1 in every
// M/N" for ordering purposes, and every sample seen has N=1 anyway, but this
// doesn't hardcode that assumption the way the FOC-only regex does.
function ratioThresholdGeneral(requirement) {
  const m = text(requirement, 100).match(/(?:^|\s)(\d+)\s*:\s*(\d+)/);
  return m ? Number(m[2]) : null;
}

// Same column schema as the weekly FOC PRH feed, plus the fields the FOC
// importer never needed: SalesStatusCode/SalesStatus (orderability) and
// FormatCode/FormatName (this feed spans every PRH format, not just CB).
export function normalizeBacklistRow(row = {}) {
  const distributorSku = exactIdentifier(row.MainIdentifier || row.UPC || row.ISBN);
  const upc = exactIdentifier(row.UPC || row.MainIdentifier || row.ISBN);
  const familyId = text(row.TitleFamilyID, 100);
  const series = text(row.SeriesName, 300);
  const issue = issueNumber(row);
  const requirement = text(row.OrderRequirement, 200);
  const ratio = ratioThresholdGeneral(requirement);
  const salesStatusCode = text(row.SalesStatusCode, 20);
  const salesStatus = text(row.SalesStatus, 60);
  const onSaleDate = dateIso(row.OnSaleDate || row['On-Sale Date']);
  const todayIso = new Date().toISOString().slice(0, 10);
  const msrpCents = cents(row.PriceUSD || row['Retail Price (US)']);
  // The feed's own "Active" flag doesn't mean "available now" -- plenty of
  // real rows carry SalesStatus=Active with an OnSaleDate months in the
  // future. Orderable requires all three: PRH still calls it active, its
  // street date has actually passed, AND PRH's own feed actually carries a
  // real price -- some rows (mostly long out-of-print titles the feed still
  // lists) come through with PriceUSD blank/zero, which would otherwise sell
  // as a free item.
  const isOrderable = /^active$/i.test(salesStatus) && !!onSaleDate && onSaleDate <= todayIso && msrpCents > 0;
  const normalized = {
    distributorSku,
    upc,
    isbn: exactIdentifier(row.ISBN),
    distributorFamilyId: familyId || `${series || titleWithoutVariant(row, series, issue)}|${text(row.FormatCode, 20) || 'na'}`.toLowerCase(),
    title: titleWithoutVariant(row, series, issue),
    sourceTitle: text(row.Title, 800),
    subtitle: text(row.SubTitle, 500),
    seriesName: series,
    seriesNumber: text(row.SeriesNumber, 40),
    publisher: text(row.PublisherName, 300),
    imprint: text(row.ImprintName, 300),
    formatCode: text(row.FormatCode, 20),
    formatName: text(row.FormatName, 200),
    bisac1: text(row.BISAC1, 20), bisac1Description: text(row.BISAC1Description, 300),
    bisac2: text(row.BISAC2, 20), bisac2Description: text(row.BISAC2Description, 300),
    ageRange: text(row.AgeRange, 40),
    variantType: text(row.VariantType, 200),
    orderRequirement: requirement,
    orderRequirementUpc: exactIdentifier(row.OrderRequirementUPC),
    ratioThreshold: ratio,
    isIncentive: !!ratio,
    writer: text(row.Writer, 1000),
    artist: text(row.Artist, 1000),
    coverArtist: text(row.CoverArtist, 1000),
    contributor: text(row.Contributor, 1000),
    allContributors: text(row.AllContributors, 2000),
    pageCount: Number.parseInt(text(row.PageCount, 20), 10) || null,
    description: text(row.Description, 12000),
    coverImageUrl: /^https:\/\//i.test(text(row.CoverLink, 2000)) ? text(row.CoverLink, 2000) : '',
    salesStatusCode, salesStatus, isOrderable,
    onSaleDate,
    catalogDate: dateIso(row.CatalogDate),
    msrpCents,
  };
  normalized.variantLabel = variantLabel(row, series, issue);
  if (/^primary title$/i.test(normalized.variantLabel)) normalized.variantLabel = 'Cover A';
  normalized.flags = prhFlags(row, normalized);
  return normalized;
}

// --- Chunked import ---------------------------------------------------
// The existing /foc/admin/import route caps a single request at 2MB /
// 2000 rows (foc-preorders.mjs's readJsonWithLimit + slice(0,2000)) -- fine
// for a small weekly comics-only file, nowhere near enough for a
// ~55MB/tens-of-thousands-of-row whole-catalog feed. This spreads the same
// upsert logic across as many POSTs as the client needs to make.

async function importStart(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const importId = crypto.randomUUID();
  await db('backlist_imports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    id: importId, store_id: storeId, source_filename: text(body.filename, 300), source_sha256: /^[a-f0-9]{64}$/i.test(text(body.sourceSha256, 64)) ? text(body.sourceSha256, 64).toLowerCase() : null,
    status: 'processing', imported_by: auth.user.id,
  }) });
  return deps.json({ ok: true, importId });
}

async function importBatch(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 2 * 1024 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const importId = text(body.importId, 80);
  const sourceRows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
  if (!importId || !sourceRows.length) return deps.json({ ok: false, error: 'importId and at least one row are required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const nowIso = new Date().toISOString();
  const normalized = sourceRows.map(row => normalizeBacklistRow(row));

  // Title-level fields come from whichever row in this batch touches a
  // family first -- later rows for the same family only add their own SKU,
  // they don't re-decide the title's own metadata.
  const familyMap = new Map();
  for (const p of normalized) {
    if (familyMap.has(p.distributorFamilyId)) continue;
    familyMap.set(p.distributorFamilyId, {
      store_id: storeId, distributor_family_id: p.distributorFamilyId,
      title: p.title, subtitle: p.subtitle || null, series_name: p.seriesName || null, series_number: p.seriesNumber || null,
      publisher: p.publisher || null, imprint: p.imprint || null, format_code: p.formatCode || null, format_name: p.formatName || null,
      bisac1: p.bisac1 || null, bisac1_description: p.bisac1Description || null, bisac2: p.bisac2 || null, bisac2_description: p.bisac2Description || null,
      age_range: p.ageRange || null, description: p.description || null, writer: p.writer || null, artist: p.artist || null,
      cover_artist: p.coverArtist || null, contributor: p.contributor || null, all_contributors: p.allContributors || null,
      page_count: p.pageCount, cover_image_url: p.coverImageUrl || null,
      is_published: p.isOrderable, last_seen_import_id: importId, last_seen_at: nowIso,
    });
  }
  const familyRows = [...familyMap.values()];
  const { data: upsertedTitles } = familyRows.length
    ? await db(`backlist_titles?on_conflict=store_id,distributor_family_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(familyRows) })
    : { data: [] };
  const titleIdByFamily = new Map((upsertedTitles || []).map(row => [row.distributor_family_id, row.id]));

  // Preserve a staff-set custom price the same way the FOC/Lunar importers
  // do -- only recompute customer_price_cents from the new MSRP when it was
  // never touched by hand (still equal to the previously-imported MSRP).
  const distributorSkus = [...new Set(normalized.map(p => p.distributorSku).filter(Boolean))];
  const { data: existingSkus } = distributorSkus.length
    ? await db(`backlist_skus?store_id=eq.${encodeURIComponent(storeId)}&distributor_sku=${inFilter(distributorSkus)}&select=distributor_sku,msrp_cents,customer_price_cents`)
    : { data: [] };
  const existingBySku = new Map((existingSkus || []).map(row => [row.distributor_sku, row]));

  let newSkus = 0, updatedSkus = 0, errors = 0;
  const skuRows = [];
  for (const p of normalized) {
    if (!p.distributorSku || !p.upc) { errors++; continue; }
    const titleId = titleIdByFamily.get(p.distributorFamilyId);
    if (!titleId) { errors++; continue; }
    const before = existingBySku.get(p.distributorSku);
    if (before) updatedSkus++; else newSkus++;
    const hadCustomPrice = before && Number(before.customer_price_cents || 0) !== Number(before.msrp_cents || 0) && Number(before.customer_price_cents || 0) > 0;
    skuRows.push({
      store_id: storeId, title_id: titleId, distributor_sku: p.distributorSku, upc: p.upc, isbn: p.isbn || null,
      format_code: p.formatCode || null, format_name: p.formatName || null, variant_type: p.variantType || null,
      order_requirement: p.orderRequirement || null, order_requirement_upc: p.orderRequirementUpc || null,
      ratio_threshold: p.ratioThreshold, is_incentive: p.isIncentive,
      sales_status_code: p.salesStatusCode || null, sales_status: p.salesStatus || null, on_sale_date: p.onSaleDate, catalog_date: p.catalogDate,
      msrp_cents: p.msrpCents, customer_price_cents: hadCustomPrice ? Number(before.customer_price_cents) : p.msrpCents,
      is_orderable: p.isOrderable, is_published: p.isOrderable,
      last_seen_import_id: importId, last_seen_at: nowIso, raw_distributor_data: p, flags: p.flags,
    });
  }
  if (skuRows.length) {
    await db(`backlist_skus?on_conflict=store_id,distributor_sku`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(skuRows) });
  }

  const { data: imports } = await db(`backlist_imports?id=eq.${encodeURIComponent(importId)}&select=import_report&limit=1`);
  const prior = imports?.[0]?.import_report || {};
  const report = {
    processed: (prior.processed || 0) + sourceRows.length,
    newSkus: (prior.newSkus || 0) + newSkus,
    updatedSkus: (prior.updatedSkus || 0) + updatedSkus,
    errors: (prior.errors || 0) + errors,
  };
  await db(`backlist_imports?id=eq.${encodeURIComponent(importId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ source_row_count: report.processed, import_report: report }) });
  return deps.json({ ok: true, importId, batch: { processed: sourceRows.length, newSkus, updatedSkus, errors }, report });
}

async function importFinish(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const importId = text(body.importId, 80);
  if (!importId) return deps.json({ ok: false, error: 'importId is required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  // A title/sku this import never touched fell out of PRH's latest export --
  // the real safety net given the feed carries no confirmed out-of-print
  // code (every sample seen is SalesStatus=Active regardless of on-sale
  // date). Unpublish first at the sku level (last_seen_import_id is what
  // every touched row was just stamped with), then recompute each title
  // from whichever of its skus survived.
  const { data: vanished } = await db(`backlist_skus?store_id=eq.${encodeURIComponent(storeId)}&last_seen_import_id=neq.${encodeURIComponent(importId)}&is_published=eq.true&select=id`);
  const vanishedIds = (vanished || []).map(row => row.id);
  if (vanishedIds.length) {
    await db(`backlist_skus?id=${inFilter(vanishedIds)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_published: false, is_orderable: false }) });
  }
  const { data: touchedTitleIds } = await db(`backlist_skus?store_id=eq.${encodeURIComponent(storeId)}&last_seen_import_id=eq.${encodeURIComponent(importId)}&select=title_id`);
  const titleIds = [...new Set((touchedTitleIds || []).map(row => row.title_id))];
  let unpublishedTitles = 0;
  if (titleIds.length) {
    const { data: stillPublished } = await db(`backlist_skus?title_id=${inFilter(titleIds)}&is_published=eq.true&select=title_id`);
    const stillPublishedSet = new Set((stillPublished || []).map(row => row.title_id));
    const toUnpublish = titleIds.filter(id => !stillPublishedSet.has(id));
    const toPublish = titleIds.filter(id => stillPublishedSet.has(id));
    if (toUnpublish.length) { await db(`backlist_titles?id=${inFilter(toUnpublish)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_published: false }) }); unpublishedTitles = toUnpublish.length; }
    if (toPublish.length) await db(`backlist_titles?id=${inFilter(toPublish)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_published: true }) });
  }
  const { data: imports } = await db(`backlist_imports?id=eq.${encodeURIComponent(importId)}&select=import_report&limit=1`);
  const report = { ...(imports?.[0]?.import_report || {}), unpublishedSkus: vanishedIds.length, unpublishedTitles };
  await db(`backlist_imports?id=eq.${encodeURIComponent(importId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString(), import_report: report }) });
  return deps.json({ ok: true, importId, report });
}

// --- Delivery estimate --------------------------------------------------
// No FOC-date/cutoff to show a customer here -- a backlist purchase rides
// whichever weekly PRH order goes out next. This is a real calculation,
// not copied "TBA" text: days until the next Monday order, plus PRH's own
// documented ~2-3 business day fulfillment, plus a normal outbound
// shipping window (separate from the live carrier quote computed at
// checkout for the shipping leg itself).
export function estimateBacklistDelivery(onSaleDateIso, now, addBusinessDays) {
  const today = now || new Date();
  const onSale = onSaleDateIso ? new Date(onSaleDateIso + 'T12:00:00Z') : today;
  const effectiveOrderDate = onSale > today ? onSale : today;
  const nextMonday = new Date(effectiveOrderDate);
  // Always the *next* Monday, even if effectiveOrderDate is already one --
  // that week's order has already gone out.
  const daysUntilMonday = ((1 - nextMonday.getUTCDay() + 7) % 7) || 7;
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
  const earliestAvailable = addBusinessDays(nextMonday, 2);
  const latestAvailable = addBusinessDays(nextMonday, 3 + 5); // + up to 5 outbound shipping days
  const fmt = d => d.toISOString().slice(0, 10);
  const weeksOut = Math.max(1, Math.round((latestAvailable - today) / (7 * 24 * 60 * 60 * 1000)));
  return {
    earliestAvailable: fmt(earliestAvailable),
    latestAvailable: fmt(latestAvailable),
    headline: `Ships with our next weekly publisher order -- arrives in about ${weeksOut === 1 ? '1 week' : weeksOut + ' weeks'}`,
  };
}

// --- Public catalog -------------------------------------------------------

async function backlistSearch(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const q = text(url.searchParams.get('q'), 200);
  const publisher = text(url.searchParams.get('publisher'), 200);
  const format = text(url.searchParams.get('format'), 200);
  const limit = Math.min(48, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 24));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset'), 10) || 0);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  // q is optional on purpose -- an empty q (with no other filter args) is a
  // real, supported "browse everything" request, not an error state. The
  // /books page used to only ever call this once someone typed something,
  // which is exactly why it showed a "search to get started" wall instead
  // of a real, scrollable catalog on first load.
  let filter = `backlist_titles?store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&select=id,title,subtitle,series_name,publisher,format_name,cover_image_url,backlist_skus(id,upc,isbn,msrp_cents,customer_price_cents,on_sale_date,is_published,is_orderable,customer_enabled)&order=title.asc&limit=${limit}&offset=${offset}`;
  if (q) filter += `&or=(title.ilike.*${encodeURIComponent(q)}*,writer.ilike.*${encodeURIComponent(q)}*,series_name.ilike.*${encodeURIComponent(q)}*)`;
  if (publisher) filter += `&publisher=eq.${encodeURIComponent(publisher)}`;
  if (format) filter += `&format_name=eq.${encodeURIComponent(format)}`;
  const { data: titles } = await db(filter);
  const results = (titles || []).map(row => ({
    id: row.id, title: row.title, subtitle: row.subtitle, seriesName: row.series_name, publisher: row.publisher,
    formatName: row.format_name, coverImageUrl: row.cover_image_url,
    // is_orderable/customer_enabled AND a confirmed real price -- a title
    // can be published (still shown as a title) while a specific SKU under
    // it isn't actually sellable yet/anymore, or (see normalizeBacklistRow)
    // came through PRH's feed with no real price at all. Never surface a
    // sku here that checkout would reject.
    skus: (row.backlist_skus || []).filter(s => s.is_published && s.is_orderable && s.customer_enabled !== false && Number(s.customer_price_cents || s.msrp_cents || 0) > 0)
      .map(s => ({ id: s.id, upc: s.upc, isbn: s.isbn, priceCents: Number(s.customer_price_cents || s.msrp_cents || 0), delivery: estimateBacklistDelivery(s.on_sale_date, new Date(), deps.addBusinessDays) })),
  })).filter(row => row.skus.length);
  return deps.json({ ok: true, results, offset, limit });
}

// GET /public/backlist/facets -- the publisher/format dropdown values for
// the browse UI's filters. PostgREST has no cheap server-side DISTINCT, so
// this pages through just the two skinny columns needed (not full title
// rows) and dedupes here -- a few thousand short strings, nowhere near the
// cost of the /sitemap-books.xml walk that already does the same paging
// pattern over the same table.
async function backlistFacets(env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const publishers = new Set(), formats = new Set();
  let offset = 0;
  while (true) {
    const { data } = await db(`backlist_titles?store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&select=publisher,format_name&limit=1000&offset=${offset}`);
    const batch = data || [];
    for (const row of batch) {
      if (row.publisher) publishers.add(row.publisher);
      if (row.format_name) formats.add(row.format_name);
    }
    if (batch.length < 1000) break;
    offset += 1000;
    if (offset >= 50000) break;
  }
  return deps.json({ ok: true, publishers: [...publishers].sort(), formats: [...formats].sort() });
}

// GET /public/backlist/shelves -- curated rows for the /books homepage's
// default (no query/filter typed yet) state: at ~23,000 titles, a bare
// search box with no starting point isn't real discovery. New Arrivals and
// Under $10 both read signals PRH's own feed already gives us (first_seen_at
// and customer_price_cents) -- no schema change needed for either. Staff
// Picks is the one shelf nothing in the feed can answer on its own, so it
// reads a real staff choice (is_featured/featured_rank, set from the
// dashboard's catalog browser via PATCH /backlist/admin/title) instead of
// guessing at "popular" from data this store doesn't track yet.
async function backlistShelves(env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const TITLE_SELECT = 'id,title,subtitle,series_name,publisher,format_name,cover_image_url,backlist_skus(id,upc,isbn,msrp_cents,customer_price_cents,on_sale_date,is_published,is_orderable,customer_enabled)';

  // Same "never surface a sku checkout would reject" guard backlistSearch
  // already applies -- a shelf is just another catalog listing, not a
  // separate trust boundary.
  function toShelfTitle(row) {
    const skus = (row.backlist_skus || []).filter(s => s.is_published && s.is_orderable && s.customer_enabled !== false && Number(s.customer_price_cents || s.msrp_cents || 0) > 0);
    if (!skus.length) return null;
    const cheapest = skus.reduce((a, b) => (Number(a.customer_price_cents || a.msrp_cents || 0) <= Number(b.customer_price_cents || b.msrp_cents || 0) ? a : b));
    return {
      id: row.id, title: row.title, subtitle: row.subtitle, seriesName: row.series_name, publisher: row.publisher,
      formatName: row.format_name, coverImageUrl: row.cover_image_url,
      skus: [{ id: cheapest.id, upc: cheapest.upc, isbn: cheapest.isbn, priceCents: Number(cheapest.customer_price_cents || cheapest.msrp_cents || 0), delivery: estimateBacklistDelivery(cheapest.on_sale_date, new Date(), deps.addBusinessDays) }],
    };
  }

  const [newRes, cheapRes, picksRes] = await Promise.all([
    db(`backlist_titles?store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&select=${TITLE_SELECT}&order=first_seen_at.desc&limit=40`),
    // Price lives on the sku, not the title -- one title can carry both a
    // $6 paperback and a $28 hardcover -- so this shelf has to start from
    // backlist_skus, not backlist_titles, unlike the other two.
    db(`backlist_skus?store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&is_orderable=eq.true&customer_enabled=eq.true&customer_price_cents=gt.0&customer_price_cents=lt.1000&order=customer_price_cents.asc&limit=60&select=id,upc,isbn,msrp_cents,customer_price_cents,on_sale_date,backlist_titles(id,title,subtitle,series_name,publisher,format_name,cover_image_url,is_published)`),
    db(`backlist_titles?store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&is_featured=eq.true&select=${TITLE_SELECT}&order=featured_rank.asc.nullslast&limit=40`),
  ]);

  const newArrivals = (newRes.data || []).map(toShelfTitle).filter(Boolean).slice(0, 12);

  const seenTitles = new Set();
  const underTen = [];
  for (const sku of cheapRes.data || []) {
    const t = sku.backlist_titles;
    if (!t || !t.is_published || seenTitles.has(t.id)) continue;
    seenTitles.add(t.id);
    underTen.push({
      id: t.id, title: t.title, subtitle: t.subtitle, seriesName: t.series_name, publisher: t.publisher,
      formatName: t.format_name, coverImageUrl: t.cover_image_url,
      skus: [{ id: sku.id, upc: sku.upc, isbn: sku.isbn, priceCents: Number(sku.customer_price_cents || sku.msrp_cents || 0), delivery: estimateBacklistDelivery(sku.on_sale_date, new Date(), deps.addBusinessDays) }],
    });
    if (underTen.length >= 12) break;
  }

  const staffPicks = (picksRes.data || []).map(toShelfTitle).filter(Boolean).slice(0, 12);

  return deps.json({ ok: true, shelves: [
    { key: 'new', label: 'New Arrivals', titles: newArrivals },
    { key: 'under10', label: 'Under $10', titles: underTen },
    { key: 'picks', label: 'Staff Picks', titles: staffPicks },
  ] });
}

// --- Customer wishlist ("Save for later") -----------------------------------
// Mirrors foc-preorders.mjs's savedPicks/mutateSavedPicks in shape (same
// GET/PATCH/DELETE contract), but flat -- backlist has no FOC cycle to group
// saved items by the way comics' foc_pick_lists does, since every book is
// always orderable. Deliberately independent of the cart: saving a book
// here never touches mp-backlist-cart-v1, and adding a book to the cart
// never touches this table -- "save for later" and "buy now" are separate
// customer decisions here, unlike comics' savePick()/addPreorderLine() pair.
async function loadBacklistPicks(db, storeId, userId) {
  const { data } = await db(`backlist_picks?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,sku_id,quantity,created_at,sku:backlist_skus(id,upc,isbn,format_name,msrp_cents,customer_price_cents,is_published,is_orderable,customer_enabled,on_sale_date,backlist_titles(id,title,cover_image_url))&order=created_at.desc`);
  return data || [];
}

async function backlistPicks(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const storeId = text(url.searchParams.get('store_id'), 80);
  if (!storeId) return deps.json({ ok: false, error: 'store_id is required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  return deps.json({ ok: true, picks: await loadBacklistPicks(db, storeId, auth.user.id) });
}

async function mutateBacklistPicks(request, env, deps) {
  const auth = await deps.requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 4 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  if (!storeId) return deps.json({ ok: false, error: 'storeId is required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  if (request.method === 'DELETE') {
    const skuIds = [...new Set((Array.isArray(body.skuIds) ? body.skuIds : [body.skuId]).map(id => text(id, 80)).filter(Boolean))].slice(0, 200);
    if (!skuIds.length || skuIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return deps.json({ ok: false, error: 'At least one valid sku id is required' }, 400);
    await db(`backlist_picks?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&sku_id=${inFilter(skuIds)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return deps.json({ ok: true, picks: await loadBacklistPicks(db, storeId, auth.user.id), message: skuIds.length === 1 ? 'Book removed from your saved list.' : 'Books removed from your saved list.' });
  }
  const skuId = text(body.skuId, 80);
  if (!/^[0-9a-f-]{36}$/i.test(skuId)) return deps.json({ ok: false, error: 'A valid sku id is required' }, 400);
  const quantity = Math.max(1, Math.min(50, Number(body.quantity || 1)));
  const { data: skuRows } = await db(`backlist_skus?id=eq.${encodeURIComponent(skuId)}&store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&select=id,title_id&limit=1`);
  const sku = skuRows?.[0];
  if (!sku) return deps.json({ ok: false, error: 'That book is no longer available' }, 404);
  await db('backlist_picks?on_conflict=user_id,sku_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ store_id: storeId, user_id: auth.user.id, title_id: sku.title_id, sku_id: skuId, quantity }) });
  return deps.json({ ok: true, picks: await loadBacklistPicks(db, storeId, auth.user.id), message: 'Book saved for later.' });
}

async function backlistTitleDetail(env, deps, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return deps.json({ ok: false, error: 'Not found' }, 404);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const { data: rows } = await db(`backlist_titles?id=eq.${encodeURIComponent(id)}&is_published=eq.true&select=*,backlist_skus(*)&limit=1`);
  const row = rows?.[0];
  if (!row) return deps.json({ ok: false, error: 'Not found' }, 404);
  const skus = (row.backlist_skus || []).filter(s => s.is_published && s.is_orderable && s.customer_enabled && Number(s.customer_price_cents || s.msrp_cents || 0) > 0).map(s => ({
    id: s.id, upc: s.upc, isbn: s.isbn, formatName: s.format_name, priceCents: Number(s.customer_price_cents || s.msrp_cents || 0),
    delivery: estimateBacklistDelivery(s.on_sale_date, new Date(), deps.addBusinessDays),
  }));
  return deps.json({ ok: true, title: { id: row.id, title: row.title, subtitle: row.subtitle, seriesName: row.series_name, publisher: row.publisher, writer: row.writer, artist: row.artist, description: row.description, coverImageUrl: row.cover_image_url, ageRange: row.age_range }, skus });
}

// --- SEO / crawlable detail page --------------------------------------------
// /books is a 100% client-rendered SPA -- nothing a search-engine crawler
// (or a non-JS link-preview scraper) reads from it ever names an actual
// book, only the one generic page-level heading, no matter which of the
// catalog's titles someone meant to find. /preorder/{id} solved this for
// comic preorders, but only as a thin share-card: it immediately
// self-redirects via JS (built for Facebook/iMessage unfurls, not to be
// indexed on its own) and its canonical/share URL points at the Worker's
// own workers.dev subdomain rather than themanapocket.com, which is exactly
// the opposite of what ranking for a book's own name needs. This instead
// follows /item/{id}/{slug} (real inventory) and renderBcwProduct: a real,
// permanent, content-ful page with no self-redirect, served directly under
// themanapocket.com (see the themanapocket.com/book* route in
// wrangler.deploy.jsonc) so Google indexes the actual page.
function backlistBookSlug(title, deps) {
  return deps.mtgSlugify(title);
}

function notFoundBacklistBookPage(deps) {
  const html = deps.mtgPageShell({
    title: 'Book not found | The Mana Pocket',
    description: "This title is no longer available. Search our full PRH backlist catalog for what you're looking for.",
    canonicalPath: '/books',
    bodyHtml: `<div class="mp-crumb"><a href="/books">← Back to the catalog</a></div><h1>Book not found</h1><p class="mp-sub">This title may no longer be orderable. Search the full catalog for what you're looking for.</p>`,
  });
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

async function backlistBookDetailPage(env, deps, id, providedSlug) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFoundBacklistBookPage(deps);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const { data: rows } = await db(`backlist_titles?id=eq.${encodeURIComponent(id)}&is_published=eq.true&select=*,backlist_skus(*)&limit=1`);
  const row = rows?.[0];
  if (!row) return notFoundBacklistBookPage(deps);
  // Never let a crawlable public page reveal a sku staff have unpublished
  // or disabled -- same privacy convention backlistTitleDetail/backlistSearch
  // already follow for the customer-facing search app.
  const skus = (row.backlist_skus || []).filter(s => s.is_published && s.is_orderable && s.customer_enabled && Number(s.customer_price_cents || s.msrp_cents || 0) > 0);
  if (!skus.length) return notFoundBacklistBookPage(deps);
  const canonicalSlug = backlistBookSlug(row.title, deps);
  const canonicalPath = `/book/${encodeURIComponent(row.id)}/${canonicalSlug}`;
  // A renamed title's old slug must never 404 -- id is the real lookup key,
  // the slug is just a relevance/trust signal in the URL (see itemDetailSlug's
  // own comment for the same reasoning on /item/{id}/{slug}).
  if (providedSlug !== canonicalSlug) return Response.redirect(`https://www.themanapocket.com${canonicalPath}`, 301);
  const lowestCents = Math.min(...skus.map(s => Number(s.customer_price_cents || s.msrp_cents || 0)));
  const byline = [row.writer, row.publisher].filter(Boolean).join(' · ');
  const priceStr = lowestCents ? `$${(lowestCents / 100).toFixed(2)}` : '';
  const description = [row.subtitle || null, byline || null, priceStr ? `From ${priceStr}` : null, text(row.description, 200) || null]
    .filter(Boolean).join(' · ') || `${row.title} at The Mana Pocket.`;
  const title = `${row.title}${row.writer ? ` by ${row.writer}` : ''} | The Mana Pocket`;
  const image = row.cover_image_url || '';
  const searchHref = `/books?q=${encodeURIComponent(row.title)}`;
  const isbn = skus.find(s => s.isbn)?.isbn || undefined;
  const skuRows = skus.map(s => {
    const priceCents = Number(s.customer_price_cents || s.msrp_cents || 0);
    const delivery = estimateBacklistDelivery(s.on_sale_date, new Date(), deps.addBusinessDays);
    return `<div style="margin-top:10px"><b>${deps.mtgEscapeHtml(s.format_name || 'Edition')}</b> -- $${deps.mtgEscapeHtml((priceCents / 100).toFixed(2))}<div class="mp-meta">${deps.mtgEscapeHtml(delivery.headline)}</div></div>`;
  }).join('');
  const html = deps.mtgPageShell({
    title, description, canonicalPath, ogImage: image || undefined,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Book', name: row.title,
      ...(image ? { image } : {}),
      ...(row.writer ? { author: { '@type': 'Person', name: row.writer } } : {}),
      ...(row.publisher ? { publisher: { '@type': 'Organization', name: row.publisher } } : {}),
      ...(isbn ? { isbn } : {}),
      description,
      offers: skus.map(s => ({
        '@type': 'Offer', priceCurrency: 'USD', price: Number(s.customer_price_cents || s.msrp_cents || 0) / 100,
        availability: 'https://schema.org/PreOrder', url: `https://www.themanapocket.com${canonicalPath}`,
      })),
    },
    bodyHtml: `<div class="mp-crumb"><a href="/books">← Full PRH catalog</a></div>` +
      `<div class="mp-detail">${image ? `<img src="${deps.mtgEscapeHtml(image)}" alt="${deps.mtgEscapeHtml(row.title)}">` : ''}` +
      `<div><h1>${deps.mtgEscapeHtml(row.title)}</h1>${row.subtitle ? `<div class="mp-meta">${deps.mtgEscapeHtml(row.subtitle)}</div>` : ''}` +
      `${byline ? `<div class="mp-meta">${deps.mtgEscapeHtml(byline)}</div>` : ''}` +
      `${row.description ? `<p class="mp-sub">${deps.mtgEscapeHtml(text(row.description, 600))}</p>` : ''}` +
      skuRows +
      `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">` +
      `<a class="mp-card" style="display:inline-block;padding:12px 20px" href="${deps.mtgEscapeHtml(searchHref)}">Buy this book →</a>` +
      `<button id="mp-share-btn" style="padding:12px 20px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;cursor:pointer;font:inherit" data-title="${deps.mtgEscapeHtml(row.title)}" data-text="${deps.mtgEscapeHtml(description)}">Share</button>` +
      `</div>` +
      `</div></div>` +
      // Same navigator.share / clipboard-copy / window.prompt fallback chain
      // preorders.js's own shareSku() already established for the comic
      // preorder pages -- kept identical here rather than inventing a
      // second convention for the same interaction.
      `<script>(function(){var b=document.getElementById('mp-share-btn');if(!b)return;b.addEventListener('click',function(){` +
      `var url=location.href;` +
      `if(navigator.share){navigator.share({title:b.dataset.title+' | The Mana Pocket',text:b.dataset.text,url:url}).catch(function(){});return;}` +
      `if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){var original=b.textContent;b.textContent='Link copied ✓';setTimeout(function(){b.textContent=original;},1400);}).catch(function(){window.prompt('Copy this link:',url);});return;}` +
      `window.prompt('Copy this link:',url);` +
      `});})();</script>`,
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=600' } });
}

// GET /sitemap-books.xml -- every published title's /book/{id}/{slug} URL,
// same reasoning as /sitemap-items.xml: Google can't discover a page it has
// no link to, and /books never links to a single title's own URL either
// (it's a search box, not a browsable index) -- submit this in Google
// Search Console's Sitemaps report alongside /sitemap-items.xml.
async function backlistSitemap(env, deps) {
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const rows = [];
  let offset = 0;
  while (true) {
    const { data } = await db(`backlist_titles?store_id=eq.${encodeURIComponent(deps.publicStoreId)}&is_published=eq.true&select=id,title,updated_at&order=title.asc&limit=1000&offset=${offset}`);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
    if (offset >= 50000) break; // sitemap.xml URL cap safety net
  }
  const urls = rows.map(row => `<url><loc>https://www.themanapocket.com/book/${deps.mtgEscapeHtml(row.id)}/${deps.mtgEscapeHtml(backlistBookSlug(row.title, deps))}</loc>${row.updated_at ? `<lastmod>${deps.mtgEscapeHtml(String(row.updated_at).slice(0, 10))}</lastmod>` : ''}</url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.themanapocket.com/books</loc></url>${urls}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml;charset=UTF-8', 'Cache-Control': 'public, max-age=1800' } });
}

// --- Checkout / payment ---------------------------------------------------

async function backlistCheckout(request, env, deps) {
  const auth = await deps.requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 64 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const requested = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!storeId || !requested.length) return deps.json({ ok: false, error: 'At least one item is required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const ids = [...new Set(requested.map(item => text(item.skuId, 80)).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  if (ids.length !== requested.length) return deps.json({ ok: false, error: 'An item selection is invalid' }, 400);
  const { data: skuRows } = await db(`backlist_skus?id=${inFilter(ids)}&store_id=eq.${encodeURIComponent(storeId)}&is_published=eq.true&is_orderable=eq.true&customer_enabled=eq.true&select=*,backlist_titles(title,cover_image_url)`);
  if ((skuRows || []).length !== ids.length) return deps.json({ ok: false, error: 'One of those books is no longer available to order' }, 409);
  const lines = [];
  let subtotalCents = 0, latestDelivery = null;
  for (const requestedItem of requested) {
    const sku = skuRows.find(row => row.id === requestedItem.skuId);
    const quantity = Math.max(1, Math.min(50, Number(requestedItem.quantity || 1)));
    const unitPriceCents = Number(sku.customer_price_cents || sku.msrp_cents || 0);
    if (unitPriceCents <= 0) return deps.json({ ok: false, error: `${sku.backlist_titles?.title || 'That title'} needs a confirmed selling price before checkout` }, 409);
    const delivery = estimateBacklistDelivery(sku.on_sale_date, new Date(), deps.addBusinessDays);
    if (!latestDelivery || delivery.latestAvailable > latestDelivery.latestAvailable) latestDelivery = delivery;
    subtotalCents += unitPriceCents * quantity;
    lines.push({ sku, quantity, unitPriceCents, delivery });
  }
  const fulfillment = body.fulfillment || {};
  const method = fulfillment.method === 'shipping' ? 'shipping' : 'pickup';
  const customerName = text(fulfillment.name || auth.user.user_metadata?.full_name || auth.user.email?.split('@')[0], 160);
  const customerEmail = text(auth.user.email, 200);
  const customerPhone = text(fulfillment.phone, 40);
  const shippingAddress = method === 'shipping' ? fulfillment.shippingAddress || null : null;
  let shipping = null;
  try { if (method === 'shipping') shipping = await requireShippingRate(env, deps, storeId, shippingAddress, text(fulfillment.shippingRateId, 100)); }
  catch (error) { return deps.json({ ok: false, error: error.message }, 409); }
  const shippingCents = Number(shipping?.amountCents || 0);
  const totalCents = subtotalCents + shippingCents;
  const orderId = crypto.randomUUID();
  const orderNumber = `BL-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${orderId.slice(0, 8).toUpperCase()}`;
  const mode = deps.stripeMode(env);
  const cfg = deps.stripeConfig(env, mode);
  if (!cfg.secretKey || !cfg.publishableKey) return deps.json({ ok: false, error: 'Online payments are not configured' }, 503);
  const orderRow = {
    id: orderId, order_number: orderNumber, store_id: storeId, user_id: auth.user.id,
    status: 'payment_pending', customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || null,
    fulfillment_method: method, shipping_address: shippingAddress, shipping_provider: shipping?.provider || null,
    shipping_rate_id: shipping?.rateId || null, shipping_service: shipping ? [shipping.carrier, shipping.service].filter(Boolean).join(' ') : null,
    subtotal_cents: subtotalCents, shipping_cents: shippingCents, total_cents: totalCents, stripe_mode: mode,
    estimated_ship_earliest: latestDelivery?.earliestAvailable || null, estimated_ship_latest: latestDelivery?.latestAvailable || null,
  };
  await db('backlist_orders', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(orderRow) });
  await db('backlist_order_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(lines.map(line => ({
    order_id: orderId, store_id: storeId, sku_id: line.sku.id, quantity: line.quantity, unit_price_cents: line.unitPriceCents,
    sku_snapshot: { title: line.sku.backlist_titles?.title, upc: line.sku.upc, msrpCents: Number(line.sku.msrp_cents || 0), coverImageUrl: line.sku.backlist_titles?.cover_image_url, delivery: line.delivery },
  }))) });
  try {
    const params = new URLSearchParams({ amount: String(totalCents), currency: 'usd', 'automatic_payment_methods[enabled]': 'true', 'receipt_email': customerEmail,
      'metadata[source]': 'backlist_order', 'metadata[backlist_order_id]': orderId, 'metadata[arsca_store_id]': storeId, 'metadata[order_number]': orderNumber });
    const intent = await deps.stripeApi(env, mode, 'payment_intents', { method: 'POST', params, idempotencyKey: `arsca-backlist-${mode}-${orderId}` });
    await db(`backlist_orders?id=eq.${orderId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stripe_payment_intent_id: intent.id }) });
    return deps.json({ ok: true, orderId, orderNumber, clientSecret: intent.client_secret, paymentIntentId: intent.id, publishableKey: cfg.publishableKey, amountCents: totalCents, shippingCents, mode, delivery: latestDelivery });
  } catch (error) {
    await db(`backlist_orders?id=eq.${orderId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'payment_failed', admin_note: text(error.message, 500) }) }).catch(() => {});
    return deps.json({ ok: false, error: `Payment setup failed: ${error.message}` }, 502);
  }
}

export function backlistOrderConfirmationEmail(order, items) {
  const lines = (items || []).map(item => {
    const snap = item.sku_snapshot || {};
    return `  ${item.quantity} x ${snap.title || 'Item'}  ($${(Number(item.unit_price_cents || 0) / 100).toFixed(2)} each)`;
  }).join('\n');
  const fulfillmentLine = order.fulfillment_method === 'shipping'
    ? `Shipping to: ${[order.shipping_address?.line1 || order.shipping_address?.street1, order.shipping_address?.city, order.shipping_address?.state, order.shipping_address?.zip || order.shipping_address?.postal_code].filter(Boolean).join(', ')}`
    : 'Pickup in store';
  const window = order.estimated_ship_earliest && order.estimated_ship_latest
    ? `Estimated availability: ${order.estimated_ship_earliest} to ${order.estimated_ship_latest}. `
    : '';
  const body = `Thanks for your order, ${order.customer_name || ''}!\n\n`
    + `Order ${order.order_number}\n\n${lines}\n\n`
    + `Subtotal: $${(Number(order.subtotal_cents || 0) / 100).toFixed(2)}\n`
    + (order.shipping_cents ? `Shipping: $${(Number(order.shipping_cents) / 100).toFixed(2)}\n` : '')
    + `Total charged: $${(Number(order.total_cents || 0) / 100).toFixed(2)}\n\n`
    + `${fulfillmentLine}\n\n`
    + `This order ships with our next weekly publisher order, not from shelf stock, so it takes longer than an in-stock item. ${window}We'll email you when it's ready.`;
  return { subject: `Your order ${order.order_number} is confirmed`, body };
}

async function recordPaidBacklistSale(env, order, paymentIntent, deps) {
  const db = deps.supabaseAdminFetch;
  const { data: items } = await db(env, `backlist_order_items?order_id=eq.${encodeURIComponent(order.id)}&select=id,sku_id,quantity,unit_price_cents,line_total_cents,sku_snapshot`);
  const paidAt = order.paid_at || new Date().toISOString();
  await db(env, 'pos_sales?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: order.id, store_id: order.store_id, subtotal: Number(order.subtotal_cents || 0) / 100, discount_total: 0, tax_total: 0, total: Number(order.total_cents || 0) / 100, status: 'completed', payment_status: 'paid', refundable_remaining_cents: Number(order.total_cents || 0), created_by: order.user_id || null, created_at: order.created_at || paidAt, completed_at: paidAt }) });
  const lines = (items || []).map(item => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const unitPriceCents = Math.max(0, Number(item.unit_price_cents || 0));
    const snapshot = item.sku_snapshot || {};
    // Same documented PRH wholesale rate used everywhere else in this app a
    // backlist/FOC comic's cost gets computed (foc-preorders.mjs's
    // recordPaidFocSale, receiveShipment): 50% of MSRP.
    const msrpCents = Number(snapshot.msrpCents || 0);
    const costCents = Math.round((msrpCents || unitPriceCents) * 0.5);
    const extendedCents = Number(item.line_total_cents || unitPriceCents * quantity);
    return { id: `bl-line-${item.id}`, sale_id: order.id, store_id: order.store_id, item_id: null, title: snapshot.title || 'Backlist order', category: 'Backlist Book', quantity, unit_price: unitPriceCents / 100, original_price: extendedCents / 100, adjusted_price: extendedCents / 100, discount_amount: 0, cost_basis: costCents / 100, profit: (extendedCents - costCents * quantity) / 100, source_id: `backlist:${order.order_number}`, image_url: snapshot.coverImageUrl || null };
  });
  const shippingCents = Math.max(0, Number(order.shipping_cents || 0));
  if (shippingCents) lines.push({ id: `bl-shipping-${order.id}`, sale_id: order.id, store_id: order.store_id, item_id: null, title: 'Shipping', category: 'Shipping', quantity: 1, unit_price: shippingCents / 100, original_price: shippingCents / 100, adjusted_price: shippingCents / 100, discount_amount: 0, cost_basis: shippingCents / 100, profit: 0, source_id: `backlist:${order.order_number}` });
  if (lines.length) await db(env, 'pos_sale_lines?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(lines) });
  await db(env, 'pos_payments?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: `bl-payment-${order.id}`, sale_id: order.id, store_id: order.store_id, method: 'Website · Backlist Order', amount: Number(order.total_cents || 0) / 100, status: 'succeeded', provider: 'stripe', stripe_mode: order.stripe_mode || null, stripe_payment_intent_id: paymentIntent.id, stripe_charge_id: paymentIntent.latest_charge || null, currency: paymentIntent.currency || order.currency || 'usd', amount_cents: Number(order.total_cents || 0), processing_fee_paid_by: 'platform_account', confirmed_at: paidAt, created_at: order.created_at || paidAt }) });
  return items || [];
}

export async function syncBacklistStripeEvent(env, event, deps) {
  const object = event.data?.object || {};
  if (!event.type.startsWith('payment_intent.') || object.metadata?.source !== 'backlist_order') return;
  const orderId = text(object.metadata?.backlist_order_id, 80);
  if (!orderId) return;
  let status = object.status;
  if (event.type === 'payment_intent.succeeded') status = 'paid';
  else if (event.type === 'payment_intent.payment_failed') status = 'payment_failed';
  else if (event.type === 'payment_intent.canceled') status = 'cancelled';
  const paidAt = new Date().toISOString();
  const patch = { status, stripe_charge_id: object.latest_charge || null };
  if (status === 'paid') patch.paid_at = paidAt;
  if (status === 'cancelled') patch.cancelled_at = paidAt;
  let paidItems = [];
  if (status === 'paid') {
    const { data: orders } = await deps.supabaseAdminFetch(env, `backlist_orders?id=eq.${encodeURIComponent(orderId)}&stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}&select=*&limit=1`);
    const existingOrder = orders?.[0];
    if (existingOrder) {
      paidItems = await recordPaidBacklistSale(env, { ...existingOrder, paid_at: existingOrder.paid_at || paidAt }, object, deps);
      // Points on the books themselves, not shipping; the pos_sales row the
      // award hangs off (id = order id) was just written above.
      await awardWebOrderLoyalty(env, deps.supabaseAdminFetch, {
        storeId: existingOrder.store_id, saleId: existingOrder.id, amountDollars: Number(existingOrder.subtotal_cents || 0) / 100,
        userId: existingOrder.user_id, name: existingOrder.customer_name, email: existingOrder.customer_email, phone: existingOrder.customer_phone,
      });
    }
  }
  // status=neq.paid is the idempotency guard against a redelivered webhook,
  // same pattern as syncFocStripeEvent -- a second delivery matches zero
  // rows here, so the confirmation email below can't fire twice.
  const guard = status === 'paid' ? '&status=neq.paid' : '';
  const { data: updated } = await deps.supabaseAdminFetch(env, `backlist_orders?id=eq.${encodeURIComponent(orderId)}&stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}${guard}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  const order = updated?.[0];
  if (status === 'paid' && order?.customer_email && typeof deps.sendEmail === 'function') {
    try {
      const items = paidItems.length ? paidItems : (await deps.supabaseAdminFetch(env, `backlist_order_items?order_id=eq.${encodeURIComponent(orderId)}&select=quantity,unit_price_cents,sku_snapshot`)).data;
      const { subject, body } = backlistOrderConfirmationEmail(order, items);
      await deps.sendEmail(env, order.customer_email, subject, body);
      await deps.supabaseAdminFetch(env, `backlist_orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ confirmation_email_sent_at: new Date().toISOString(), confirmation_email_error: null }) });
    } catch (error) {
      await deps.supabaseAdminFetch(env, `backlist_orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ confirmation_email_error: text(error.message, 500) }) }).catch(() => {});
      console.error(JSON.stringify({ message: 'Backlist order confirmation email failed', error: error.message, orderId }));
    }
  }
}

// --- Staff admin ------------------------------------------------------

async function adminSku(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const id = text(body.id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return deps.json({ ok: false, error: 'Invalid sku id' }, 400);
  const patch = {};
  if (body.customerEnabled !== undefined) patch.customer_enabled = !!body.customerEnabled;
  if (body.customerPriceCents !== undefined) { const price = Math.max(0, Number(body.customerPriceCents) || 0); patch.customer_price_cents = price; }
  if (!Object.keys(patch).length) return deps.json({ ok: false, error: 'No changes supplied' }, 400);
  await deps.supabaseAdminFetch(env, `backlist_skus?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  return deps.json({ ok: true, id });
}

async function adminOrders(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const { data: orders } = await deps.supabaseAdminFetch(env, `backlist_orders?store_id=eq.${encodeURIComponent(storeId)}&order=created_at.desc&limit=200&select=*,backlist_order_items(*)`);
  return deps.json({ ok: true, orders: orders || [] });
}

// Staff-entered received quantities become real inventory_items rows the
// same way foc-preorders.mjs's receiveShipment does, minus that function's
// eBay-presale-listing interplay -- backlist has no such listings.
async function adminReceive(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 32 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 500);
  if (!lines.length) return deps.json({ ok: false, error: 'At least one line is required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const ids = [...new Set(lines.map(l => text(l.skuId, 80)).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return deps.json({ ok: false, error: 'No valid sku selections were supplied' }, 400);
  const { data: skuRows } = await db(`backlist_skus?id=${inFilter(ids)}&store_id=eq.${encodeURIComponent(storeId)}&select=*,backlist_titles(title,cover_image_url)`);
  const skuById = new Map((skuRows || []).map(row => [row.id, row]));
  const { data: committedItems } = await db(`backlist_order_items?sku_id=${inFilter(ids)}&status=eq.committed&select=id,sku_id,order_id,quantity,created_at&order=created_at.asc`);
  const committedBySku = new Map();
  for (const item of committedItems || []) { const arr = committedBySku.get(item.sku_id) || []; arr.push(item); committedBySku.set(item.sku_id, arr); }
  const rows = [];
  for (const line of lines) {
    const sku = skuById.get(text(line.skuId, 80));
    if (!sku) continue;
    let receivedQty = Math.max(0, Math.min(1000, Number(line.receivedQty || 0)));
    if (!receivedQty) continue;
    const obligations = committedBySku.get(sku.id) || [];
    const receivedItemIds = [];
    for (const item of obligations) {
      if (receivedQty <= 0) break;
      const take = Math.min(receivedQty, Number(item.quantity || 1));
      if (take > 0) { receivedItemIds.push(item.id); receivedQty -= take; }
    }
    if (receivedItemIds.length) await db(`backlist_order_items?id=${inFilter(receivedItemIds)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'received' }) });
    if (receivedQty > 0) {
      rows.push({
        store_id: storeId, status: 'in_stock',
        data: {
          name: sku.backlist_titles?.title || 'Book', category: 'Book', publisher: '', upc: sku.upc || '',
          cost: Math.round(Number(sku.msrp_cents || 0) * 0.5) / 100,
          market: Number(sku.customer_price_cents || 0) / 100, salePrice: Number(sku.customer_price_cents || 0) / 100,
          qty: receivedQty, quantity: receivedQty, image: sku.backlist_titles?.cover_image_url || '',
          source: 'backlist_receive', backlistSkuId: sku.id, backlistReceivedAt: new Date().toISOString(),
        },
      });
    }
  }
  const { data: inserted } = rows.length ? await db('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) }) : { data: [] };
  return deps.json({ ok: true, createdInventoryCount: (inserted || []).length });
}

// Staff need the same "did this import actually happen" answer on every
// fresh page load, not just in the browser tab that ran the upload --
// backlist-dashboard.js's own lastImportReport is in-memory session state
// that a reload (or a different device) never sees, which is exactly why a
// 29,603-SKU import that fully succeeded still looked like nothing had
// happened. This just re-reads the most recent backlist_imports row.
async function adminImportStatus(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const { data: imports } = await deps.supabaseAdminFetch(env, `backlist_imports?store_id=eq.${encodeURIComponent(storeId)}&select=id,source_filename,status,source_row_count,import_report,started_at,completed_at&order=started_at.desc&limit=1`);
  return deps.json({ ok: true, lastImport: imports?.[0] || null });
}

// Staff-facing catalog browser -- unlike /public/backlist/search (which
// only ever shows is_published=true titles to a customer), this returns
// every title regardless of publish state so staff can actually see what a
// 29,603-row import produced, search it, and toggle publish/price per SKU
// via the existing /backlist/admin/sku route.
async function adminCatalog(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const q = text(url.searchParams.get('q'), 200);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || 50));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset'), 10) || 0);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  let filter = `backlist_titles?store_id=eq.${encodeURIComponent(storeId)}&select=id,title,subtitle,series_name,publisher,writer,format_name,cover_image_url,is_published,is_featured,featured_rank,backlist_skus(id,upc,isbn,format_name,msrp_cents,customer_price_cents,customer_enabled,is_published,is_orderable,sales_status,on_sale_date)&order=title.asc&limit=${limit}&offset=${offset}`;
  if (q) filter += `&or=(title.ilike.*${encodeURIComponent(q)}*,writer.ilike.*${encodeURIComponent(q)}*,series_name.ilike.*${encodeURIComponent(q)}*,publisher.ilike.*${encodeURIComponent(q)}*)`;
  const { data: titles, response } = await db(filter, { headers: { Prefer: 'count=exact' } });
  const total = Number(String(response.headers.get('content-range') || '').split('/')[1] || (titles || []).length);
  return deps.json({ ok: true, titles: titles || [], total, offset, limit });
}

// Staff-set "Staff Picks" homepage shelf -- unlike New Arrivals/Under $10
// (both real signals already on file: first_seen_at, customer_price_cents),
// nothing in PRH's feed tells us which books a store actually wants to push,
// so this is the one shelf that needs a deliberate staff choice rather than
// a query over existing data.
async function adminTitle(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const id = text(body.id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return deps.json({ ok: false, error: 'Invalid title id' }, 400);
  const patch = {};
  if (body.isFeatured !== undefined) patch.is_featured = !!body.isFeatured;
  if (body.featuredRank !== undefined) patch.featured_rank = body.featuredRank === null ? null : Math.max(0, Number(body.featuredRank) || 0);
  if (!Object.keys(patch).length) return deps.json({ ok: false, error: 'No changes supplied' }, 400);
  await deps.supabaseAdminFetch(env, `backlist_titles?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  return deps.json({ ok: true, id });
}

export async function handleBacklistRequest(request, env, url, deps) {
  const path = url.pathname;
  if (path.startsWith('/book/') && request.method === 'GET') {
    const rest = path.slice('/book/'.length).split('/');
    return backlistBookDetailPage(env, deps, decodeURIComponent(rest[0] || ''), rest[1] ? decodeURIComponent(rest[1]) : '');
  }
  if (path === '/sitemap-books.xml' && request.method === 'GET') return backlistSitemap(env, deps);
  if (path === '/public/backlist/search' && request.method === 'GET') return backlistSearch(request, env, deps, url);
  if (path === '/public/backlist/facets' && request.method === 'GET') return backlistFacets(env, deps, url);
  if (path === '/public/backlist/shelves' && request.method === 'GET') return backlistShelves(env, deps, url);
  if (path === '/public/backlist/picks' && request.method === 'GET') return backlistPicks(request, env, deps, url);
  if (path === '/public/backlist/picks' && (request.method === 'PATCH' || request.method === 'DELETE')) return mutateBacklistPicks(request, env, deps);
  if (path.startsWith('/public/backlist/title/') && request.method === 'GET') return backlistTitleDetail(env, deps, decodeURIComponent(path.slice('/public/backlist/title/'.length).split('/')[0] || ''));
  if (path === '/public/backlist/checkout' && request.method === 'POST') return backlistCheckout(request, env, deps);
  if (path === '/backlist/admin/import/start' && request.method === 'POST') return importStart(request, env, deps);
  if (path === '/backlist/admin/import/batch' && request.method === 'POST') return importBatch(request, env, deps);
  if (path === '/backlist/admin/import/finish' && request.method === 'POST') return importFinish(request, env, deps);
  if (path === '/backlist/admin/import/status' && request.method === 'GET') return adminImportStatus(request, env, deps, url);
  if (path === '/backlist/admin/catalog' && request.method === 'GET') return adminCatalog(request, env, deps, url);
  if (path === '/backlist/admin/sku' && request.method === 'PATCH') return adminSku(request, env, deps);
  if (path === '/backlist/admin/title' && request.method === 'PATCH') return adminTitle(request, env, deps);
  if (path === '/backlist/admin/orders' && request.method === 'GET') return adminOrders(request, env, deps, url);
  if (path === '/backlist/admin/receive' && request.method === 'POST') return adminReceive(request, env, deps);
  return deps.json({ ok: false, error: 'Backlist route not found' }, 404);
}
