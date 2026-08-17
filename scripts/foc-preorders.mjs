// The Mana Pocket PRH FOC preorder service.
//
// This module stays deliberately independent of the dashboard DOM. The Worker
// passes its existing Supabase/auth/Stripe helpers into handleFocRequest(), so
// checkout continues to use the production payment and tenant foundations.

const PRH = 'PRH';
const ORDERED_STATUSES = new Set(['paid','reserved','ready_for_pickup','shipped','completed']);
const CUSTOMER_STATUSES = new Set(['paid','reserved','ready_for_pickup','shipped','completed','cancelled','refunded','partially_refunded']);

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function exactIdentifier(value) {
  return text(value, 80).replace(/\.0+$/, '');
}

function dateIso(value) {
  const raw = text(value, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
}

function cents(value) {
  const number = Number(String(value == null ? '' : value).replace(/[$,]/g, ''));
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

function issueNumber(row) {
  const direct = text(row.SeriesNumber || row['Series Number'], 40);
  if (direct) return direct.replace(/^#/, '');
  return (text(row.Title, 500).match(/#([0-9]+(?:\.[0-9]+)?[A-Za-z]?)/) || [,''])[1];
}

function titleWithoutVariant(row, series, issue) {
  if (series) return `${series}${issue ? ` #${issue}` : ''}`;
  return text(row.Title, 500).replace(/\s+(?:CVR|COVER|VARIANT|VAR)\b.*$/i, '').trim();
}

function variantLabel(row, series, issue) {
  const full = text(row.Title, 800);
  const base = [series, issue ? `#${issue}` : ''].filter(Boolean).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let label = base ? full.replace(new RegExp(`^${base}\\s*`, 'i'), '') : full;
  label = label.replace(/^[-–—:]+\s*/, '').trim();
  if (!label || label.toLowerCase() === full.toLowerCase()) {
    label = text(row.VariantType, 200) || text(row.CoverArtist, 200) || 'Cover A';
  }
  return label;
}

function ratioThreshold(requirement) {
  const m = text(requirement, 100).match(/(?:^|\s)1\s*:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function prhFlags(row, normalized) {
  const haystack = [row.Title, row.SubTitle, row.VariantType, row.ComicType, row.Description].join(' ').toLowerCase();
  return {
    firstIssue: normalized.issueNumber === '1',
    newSeries: normalized.issueNumber === '1' || /new series|premiere|debut/.test(haystack),
    variant: !/cover\s*a\b|cvr\s*a\b/i.test(normalized.variantLabel) && (/variant|\bcvr\s+[b-z]\b|\bcover\s+[b-z]\b/i.test(haystack) || normalized.isIncentive),
    coverA: /cover\s*a\b|cvr\s*a\b/i.test(haystack) || (!/variant|\bcvr\s+[b-z]\b|\bcover\s+[b-z]\b/i.test(haystack) && !normalized.isIncentive),
    foil: /\bfoil\b/i.test(haystack),
    virgin: /\bvirgin\b/i.test(haystack),
    homage: /\bhomage\b/i.test(haystack),
    blank: /\bblank\b/i.test(haystack),
    incentive: normalized.isIncentive,
    oneShot: /one[- ]shot/i.test(haystack) || /^one[- ]shot$/i.test(text(row.ComicType, 100)),
    collectedEdition: /trade paperback|hardcover|graphic novel|omnibus|collection/i.test([row.FormatName,row.ComicType].join(' ')),
  };
}

export function normalizePrhRow(row = {}) {
  const distributorSku = exactIdentifier(row.MainIdentifier || row.UPC || row.ISBN);
  const upc = exactIdentifier(row.UPC || row.MainIdentifier || row.ISBN);
  const familyId = text(row.TitleFamilyID, 100);
  const series = text(row.SeriesName, 300);
  const issue = issueNumber(row);
  const requirement = text(row.OrderRequirement, 200);
  const ratio = ratioThreshold(requirement);
  const focDate = dateIso(row.FOCDate || row['FOC Date']);
  const normalized = {
    distributorSku,
    upc,
    isbn:exactIdentifier(row.ISBN),
    distributorFamilyId:familyId || `${series || titleWithoutVariant(row, series, issue)}|${issue || 'one-shot'}`.toLowerCase(),
    title:titleWithoutVariant(row, series, issue),
    sourceTitle:text(row.Title, 800),
    subtitle:text(row.SubTitle, 500),
    seriesName:series,
    issueNumber:issue,
    publisher:text(row.PublisherName, 300),
    imprint:text(row.ImprintName, 300),
    comicType:text(row.ComicType, 100),
    variantType:text(row.VariantType, 200),
    orderRequirement:requirement,
    orderRequirementUpc:exactIdentifier(row.OrderRequirementUPC),
    ratioThreshold:ratio,
    isIncentive:!!ratio,
    writer:text(row.Writer, 1000),
    interiorArtist:text(row.Artist, 1000),
    coverArtist:text(row.CoverArtist, 1000),
    description:text(row.Description, 12000),
    coverImageUrl:/^https:\/\//i.test(text(row.CoverLink, 2000)) ? text(row.CoverLink, 2000) : '',
    coverAvailable:/^(y|yes|true|1)$/i.test(text(row.CoverAvailable, 20)),
    focDate,
    onSaleDate:dateIso(row.OnSaleDate || row['On-Sale Date']),
    msrpCents:cents(row.PriceUSD || row['Retail Price (US)']),
    maxOrderQuantity:text(row.MaxOrderQuantity, 100),
  };
  normalized.variantLabel = variantLabel(row, series, issue);
  if (/^primary title$/i.test(normalized.variantLabel)) normalized.variantLabel = 'Cover A';
  normalized.flags = prhFlags(row, normalized);
  return normalized;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

function inFilter(values) {
  return `in.(${values.map(value => encodeURIComponent(String(value))).join(',')})`;
}

function cycleOpen(cycle, now = new Date()) {
  return cycle?.status === 'open' && new Date(cycle.customer_cutoff_at).getTime() > now.getTime();
}

function catalogCycleSelect() {
  return 'id,store_id,distributor,foc_date,customer_cutoff_at,status,preorder_mode,source_filename,source_row_count,import_report,imported_at,updated_at';
}

function publicSku(row, customerQty = 0) {
  const securedRemaining = row.is_incentive ? Math.max(0, Number(row.secured_quantity || 0) - customerQty) : null;
  const customerPriceCents = Number(row.customer_price_cents || 0);
  const incentiveReady = !!row.is_incentive && securedRemaining > 0 && customerPriceCents > 0;
  const priceRequired = customerPriceCents <= 0;
  return {
    id:row.id,
    familyId:row.family_id,
    sku:row.distributor_sku,
    upc:row.upc,
    title:row.title,
    subtitle:row.subtitle || '',
    variantLabel:row.variant_label || 'Cover A',
    variantType:row.variant_type || '',
    orderRequirement:row.order_requirement || '',
    ratioThreshold:Number(row.ratio_threshold || 0) || null,
    isIncentive:!!row.is_incentive,
    isFoil:!!row.flags?.foil,
    coverArtist:row.cover_artist || '',
    coverImageUrl:row.cover_image_url || '',
    writer:row.writer || '',
    interiorArtist:row.interior_artist || '',
    publisher:row.publisher || '',
    imprint:row.imprint || '',
    description:row.description || '',
    focDate:row.foc_date,
    onSaleDate:row.on_sale_date,
    msrpCents:Number(row.msrp_cents || 0),
    priceCents:customerPriceCents,
    priceRequired,
    customerQty,
    securedQuantity:Number(row.secured_quantity || 0),
    securedRemaining,
    canPreorder:row.customer_enabled !== false && !priceRequired && (!row.is_incentive || incentiveReady),
    waitlistOnly:!!row.is_incentive && !incentiveReady,
    flags:row.flags || {},
  };
}

async function orderedQtyBySku(db, cycleId) {
  const { data:orders } = await db(`foc_preorder_orders?cycle_id=eq.${encodeURIComponent(cycleId)}&status=${inFilter([...ORDERED_STATUSES])}&select=id`);
  const orderIds = (orders || []).map(order => order.id);
  if (!orderIds.length) return new Map();
  const { data:items } = await db(`foc_preorder_items?order_id=${inFilter(orderIds)}&status=eq.committed&select=sku_id,quantity`);
  const totals = new Map();
  for (const item of items || []) totals.set(item.sku_id, (totals.get(item.sku_id) || 0) + Number(item.quantity || 0));
  return totals;
}

async function loadCatalog(db, storeId, requestedCycle, includeAdmin = false) {
  let cycleQuery = `foc_cycles?store_id=eq.${encodeURIComponent(storeId)}&select=${catalogCycleSelect()}`;
  if (requestedCycle) {
    const key = text(requestedCycle, 80);
    cycleQuery += /^\d{4}-\d{2}-\d{2}$/.test(key) ? `&foc_date=eq.${key}` : `&id=eq.${encodeURIComponent(key)}`;
  }
  cycleQuery += '&order=foc_date.desc&limit=1';
  let { data:cycles } = await db(cycleQuery);
  if (!cycles?.length && !requestedCycle) {
    ({ data:cycles } = await db(`foc_cycles?store_id=eq.${encodeURIComponent(storeId)}&select=${catalogCycleSelect()}&order=foc_date.desc&limit=1`));
  }
  const cycle = cycles?.[0];
  if (!cycle) return null;
  const [{ data:families }, { data:skuRows }, qtyMap, requestRows] = await Promise.all([
    db(`comic_title_families?cycle_id=eq.${encodeURIComponent(cycle.id)}&select=*&order=title.asc`),
    db(`comic_skus?cycle_id=eq.${encodeURIComponent(cycle.id)}&customer_enabled=eq.true&select=*&order=title.asc`),
    orderedQtyBySku(db, cycle.id),
    includeAdmin ? db(`foc_incentive_requests?cycle_id=eq.${encodeURIComponent(cycle.id)}&status=${inFilter(['waitlisted','offered'])}&select=sku_id,requested_quantity`) : Promise.resolve({ data:[] }),
  ]);
  const requestQty = new Map();
  for (const row of requestRows?.data || []) requestQty.set(row.sku_id, (requestQty.get(row.sku_id) || 0) + Number(row.requested_quantity || 0));
  const byFamily = new Map((families || []).map(family => [family.id, {
    id:family.id,
    distributorFamilyId:family.distributor_family_id,
    title:family.title,
    seriesName:family.series_name || '',
    issueNumber:family.issue_number || '',
    publisher:family.publisher || '',
    imprint:family.imprint || '',
    comicType:family.comic_type || '',
    description:family.description || '',
    writer:family.writer || '',
    interiorArtist:family.interior_artist || '',
    onSaleDate:family.on_sale_date,
    isFirstIssue:!!family.is_first_issue,
    isNewSeries:!!family.is_new_series,
    ...(includeAdmin ? { heat:family.heat, heatCategory:family.heat_category, adminNote:family.admin_note || '' } : {}),
    variants:[],
  }]));
  for (const row of skuRows || []) {
    const family = byFamily.get(row.family_id);
    if (!family) continue;
    const sku = publicSku(row, qtyMap.get(row.id) || 0);
    if (includeAdmin) Object.assign(sku, {
      storeQuantity:Number(row.store_quantity || 0),
      qualificationOverrideTotal:row.qualification_override_total,
      qualificationNote:row.qualification_note || '',
      customerEnabled:row.customer_enabled !== false,
      waitlistRequests:requestQty.get(row.id) || 0,
      rawDistributorData:row.raw_distributor_data || {},
    });
    family.variants.push(sku);
  }
  for (const family of byFamily.values()) {
    const baseQualifying = family.variants.filter(sku => !sku.isIncentive).reduce((sum, sku) => {
      const source = (skuRows || []).find(row => row.id === sku.id);
      return sum + sku.customerQty + Number(source?.store_quantity || 0);
    }, 0);
    family.variants.forEach(sku => {
      if (!sku.isIncentive) return;
      const adminSku = (skuRows || []).find(row => row.id === sku.id);
      const total = adminSku?.qualification_override_total == null ? baseQualifying : Number(adminSku.qualification_override_total);
      sku.qualification = { total, threshold:sku.ratioThreshold || 0, needed:Math.max(0, (sku.ratioThreshold || 0) - total), qualified:!!sku.ratioThreshold && total >= sku.ratioThreshold };
    });
    family.variants.sort((a,b) => Number(a.isIncentive) - Number(b.isIncentive) || Number(a.ratioThreshold || 0) - Number(b.ratioThreshold || 0) || a.variantLabel.localeCompare(b.variantLabel));
  }
  return { cycle:{ ...cycle, isOpen:cycleOpen(cycle), serverNow:new Date().toISOString() }, families:[...byFamily.values()] };
}

async function importPrh(request, env, deps, storeId) {
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner','admin','manager','employee']);
  if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 2 * 1024 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const sourceRows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
  if (!sourceRows.length) return deps.json({ ok:false, error:'No PRH rows were supplied' }, 400);
  const normalized = sourceRows.map((row, index) => ({ row, index:index + 2, parsed:normalizePrhRow(row) }));
  const errors = normalized.filter(entry => !entry.parsed.distributorSku || !entry.parsed.upc || !entry.parsed.focDate || !entry.parsed.title);
  if (errors.length) return deps.json({ ok:false, error:`${errors.length} row(s) are missing an exact identifier, title, or FOC date`, rows:errors.slice(0,20).map(entry => entry.index) }, 400);
  const focDates = [...new Set(normalized.map(entry => entry.parsed.focDate))];
  if (focDates.length !== 1) return deps.json({ ok:false, error:'A single import must contain exactly one FOC date', focDates }, 400);
  const focDate = focDates[0];
  const sourceSha256 = /^[a-f0-9]{64}$/i.test(text(body.sourceSha256, 64)) ? text(body.sourceSha256, 64).toLowerCase() : await sha256Hex(sourceRows);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const { data:existingCycles } = await db(`foc_cycles?store_id=eq.${encodeURIComponent(storeId)}&distributor=eq.PRH&foc_date=eq.${focDate}&select=*&limit=1`);
  const existingCycle = existingCycles?.[0];
  if (existingCycle?.source_sha256 === sourceSha256) {
    return deps.json({ ok:true, duplicate:true, cycleId:existingCycle.id, focDate, report:existingCycle.import_report || { processed:sourceRows.length, newSkus:0, updatedSkus:0, unchanged:sourceRows.length, errors:0 } });
  }
  const cutoff = text(body.customerCutoffAt, 80) || existingCycle?.customer_cutoff_at || null;
  const cycleRow = {
    store_id:storeId, distributor:PRH, foc_date:focDate, customer_cutoff_at:cutoff,
    status:existingCycle?.status || 'open', preorder_mode:existingCycle?.preorder_mode || 'pay_now',
    source_filename:text(body.sourceFilename, 300) || null, source_sha256:sourceSha256,
    source_row_count:sourceRows.length, imported_by:auth.user.id, imported_at:new Date().toISOString(),
  };
  const { data:cycleRows } = await db('foc_cycles?on_conflict=store_id,distributor,foc_date', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(cycleRow) });
  const cycle = cycleRows?.[0] || existingCycle;
  if (!cycle?.id) return deps.json({ ok:false, error:'The FOC cycle could not be created' }, 502);

  const familyMap = new Map();
  for (const entry of normalized) {
    const p = entry.parsed;
    if (!familyMap.has(p.distributorFamilyId)) familyMap.set(p.distributorFamilyId, {
      store_id:storeId, cycle_id:cycle.id, distributor_family_id:p.distributorFamilyId,
      title:p.title, series_name:p.seriesName || null, issue_number:p.issueNumber || null,
      publisher:p.publisher || null, imprint:p.imprint || null, comic_type:p.comicType || null,
      description:p.description || null, writer:p.writer || null, interior_artist:p.interiorArtist || null,
      on_sale_date:p.onSaleDate, is_first_issue:p.issueNumber === '1', is_new_series:!!p.flags.newSeries,
    });
  }
  const { data:familyRows } = await db('comic_title_families?on_conflict=cycle_id,distributor_family_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify([...familyMap.values()]) });
  const familyIds = new Map((familyRows || []).map(row => [row.distributor_family_id, row.id]));
  if (familyIds.size !== familyMap.size) return deps.json({ ok:false, error:'Some title families could not be grouped during import' }, 502);

  const { data:existingSkus } = await db(`comic_skus?cycle_id=eq.${encodeURIComponent(cycle.id)}&select=id,distributor_sku,row_sha256,msrp_cents,customer_price_cents`);
  const existingBySku = new Map((existingSkus || []).map(row => [row.distributor_sku, row]));
  let newSkus = 0, updatedSkus = 0, unchanged = 0;
  const skuRows = [];
  for (const entry of normalized) {
    const p = entry.parsed;
    const rowHash = await sha256Hex(entry.row);
    const before = existingBySku.get(p.distributorSku);
    if (!before) newSkus++;
    else if (before.row_sha256 === rowHash) unchanged++;
    else updatedSkus++;
    // PRH MSRP is a distributor reference, not a safe selling price for a
    // ratio incentive. Incentives start unpriced and request-only. For every
    // SKU, a price the store has deliberately changed is preserved on later
    // PRH imports instead of being reset to MSRP.
    const hadCustomPrice = before && Number(before.customer_price_cents || 0) !== Number(before.msrp_cents || 0);
    const customerPriceCents = hadCustomPrice ? Number(before.customer_price_cents || 0) : ((p.isIncentive || p.flags.foil) ? 0 : p.msrpCents);
    skuRows.push({
      store_id:storeId, cycle_id:cycle.id, family_id:familyIds.get(p.distributorFamilyId), distributor:PRH,
      distributor_sku:p.distributorSku, upc:p.upc, isbn:p.isbn || null, title:p.sourceTitle || p.title,
      subtitle:p.subtitle || null, variant_label:p.variantLabel || null, variant_type:p.variantType || null,
      order_requirement:p.orderRequirement || null, order_requirement_upc:p.orderRequirementUpc || null,
      ratio_threshold:p.ratioThreshold, is_incentive:p.isIncentive, cover_artist:p.coverArtist || null,
      cover_image_url:p.coverImageUrl || null, cover_available:p.coverAvailable, writer:p.writer || null,
      interior_artist:p.interiorArtist || null, publisher:p.publisher || null, imprint:p.imprint || null,
      description:p.description || null, foc_date:p.focDate, on_sale_date:p.onSaleDate,
      msrp_cents:p.msrpCents, customer_price_cents:customerPriceCents, raw_distributor_data:entry.row,
      row_sha256:rowHash, flags:p.flags,
    });
  }
  await db('comic_skus?on_conflict=cycle_id,distributor_sku', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify(skuRows) });
  const report = { processed:sourceRows.length, families:familyMap.size, newSkus, updatedSkus, unchanged, errors:0, incentives:skuRows.filter(row => row.is_incentive).length };
  await db(`foc_cycles?id=eq.${cycle.id}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ import_report:report }) });
  return deps.json({ ok:true, duplicate:false, cycleId:cycle.id, focDate, customerCutoffAt:cycle.customer_cutoff_at || cutoff, report });
}

async function requireShippingRate(env, deps, storeId, address, rateId) {
  if (!rateId || !env.LBA_KV) throw new Error('Choose a live carrier shipping rate');
  const cached = await env.LBA_KV.get(`shipping-rate:${rateId}`, 'json');
  if (!cached || cached.storeId !== storeId) throw new Error('That shipping quote expired; request a fresh rate');
  const fingerprint = await sha256Hex({ zip:text(address?.zip,20), state:text(address?.state,20), city:text(address?.city,120), line1:text(address?.line1,200) });
  if (cached.addressFingerprint !== fingerprint) throw new Error('The shipping address changed; request a fresh rate');
  return cached;
}

async function shippingSettings(db, env, storeId) {
  const { data:rows } = await db(`store_settings?store_id=eq.${encodeURIComponent(storeId)}&select=payment_settings,receipt_settings&limit=1`);
  const settings = rows?.[0] || {};
  const shipping = settings.payment_settings?.shipping || {};
  const from = shipping.shipFrom || {};
  return {
    enabled:shipping.enabled === true,
    provider:shipping.provider || 'shippo',
    from:{
      name:text(from.name || settings.receipt_settings?.storeName || 'The Mana Pocket',120),
      street1:text(from.line1 || from.street1,200), street2:text(from.line2 || from.street2,200),
      city:text(from.city,120), state:text(from.state,20), zip:text(from.zip,20), country:'US',
      phone:text(from.phone || settings.receipt_settings?.phone,40), email:text(from.email || settings.receipt_settings?.email,200),
    },
    parcel:shipping.defaultParcel || { length:'12', width:'9', height:'1', distance_unit:'in', weight:'1', mass_unit:'lb' },
    tokenConfigured:!!env.SHIPPO_API_TOKEN,
  };
}

async function quoteShipping(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 32 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId,80);
  const clientKey=text(request.headers.get('CF-Connecting-IP')||'unknown',80);
  const rateError=await deps.enforceUsageLimit(env,`foc-shipping:${storeId}:${clientKey}`,10,300);
  if(rateError)return rateError;
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const cfg = await shippingSettings(db, env, storeId);
  if (!cfg.enabled || cfg.provider !== 'shippo' || !cfg.tokenConfigured || !cfg.from.street1 || !cfg.from.city || !cfg.from.state || !cfg.from.zip) {
    return deps.json({ ok:false, setupRequired:true, error:'Live shipping is not configured yet. Choose pickup or finish Shippo setup in the dashboard.' }, 503);
  }
  const to = body.address || {};
  const address = { name:text(to.name,120), street1:text(to.line1,200), street2:text(to.line2,200), city:text(to.city,120), state:text(to.state,20).toUpperCase(), zip:text(to.zip,20), country:'US', phone:text(to.phone,40), email:text(to.email,200) };
  if (!address.name || !address.street1 || !address.city || !address.state || !address.zip) return deps.json({ ok:false, error:'A complete U.S. shipping address is required' }, 400);
  const quantity = Math.max(1, Math.min(100, Number(body.quantity || 1)));
  const parcel = { ...cfg.parcel };
  // Never quote a one-pound parcel for a stack of comics. The configured
  // value is the package minimum; four ounces per book plus eight ounces of
  // rigid packing is the conservative checkout weight as quantity grows.
  parcel.weight=String(Math.max(Number(parcel.weight)||0, (8 + quantity * 4) / 16));
  parcel.mass_unit='lb';
  const response = await fetch('https://api.goshippo.com/shipments/', {
    method:'POST',
    headers:{ Authorization:`ShippoToken ${env.SHIPPO_API_TOKEN}`, 'Content-Type':'application/json', 'SHIPPO-API-VERSION':'2018-02-08' },
    body:JSON.stringify({ address_from:cfg.from, address_to:address, parcels:[parcel], async:false, metadata:`Mana Pocket checkout ${storeId}`.slice(0,100) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return deps.json({ ok:false, error:data.detail || data.message || `Shipping provider returned ${response.status}` }, 502);
  const rates = (Array.isArray(data.rates) ? data.rates : []).filter(rate => rate.object_id && Number(rate.amount) >= 0).sort((a,b) => Number(a.amount) - Number(b.amount)).slice(0,8);
  const addressFingerprint = await sha256Hex({ zip:address.zip, state:address.state, city:address.city, line1:address.street1 });
  const shaped = [];
  for (const rate of rates) {
    const record = { storeId, addressFingerprint, provider:'shippo', rateId:rate.object_id, shipmentId:data.object_id, amountCents:Math.round(Number(rate.amount) * 100), carrier:text(rate.provider,80), service:text(rate.servicelevel?.name || rate.servicelevel?.token,120), estimatedDays:Number(rate.estimated_days || 0) || null, expiresAt:new Date(Date.now()+55*60*1000).toISOString() };
    if (env.LBA_KV) await env.LBA_KV.put(`shipping-rate:${record.rateId}`, JSON.stringify(record), { expirationTtl:3600 });
    shaped.push(record);
  }
  if (!shaped.length) return deps.json({ ok:false, error:'No carrier rates were returned for that address' }, 422);
  return deps.json({ ok:true, rates:shaped });
}

async function preorderCheckout(request, env, deps) {
  const auth = await deps.requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 64 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId,80);
  const cycleId = text(body.cycleId,80);
  const requested = Array.isArray(body.items) ? body.items.slice(0,50) : [];
  if (!storeId || !cycleId || !requested.length) return deps.json({ ok:false, error:'Cycle and exact cover selections are required' }, 400);
  const db = (path, options) => deps.supabaseAdminFetch(env, path, options);
  const { data:cycles } = await db(`foc_cycles?id=eq.${encodeURIComponent(cycleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
  const cycle = cycles?.[0];
  if (!cycle || !cycleOpen(cycle)) return deps.json({ ok:false, error:'FOC is closed for this cycle' }, 409);
  const ids = [...new Set(requested.map(item => text(item.skuId,80)).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  if (ids.length !== requested.length) return deps.json({ ok:false, error:'An exact cover selection is invalid' }, 400);
  const { data:skuRows } = await db(`comic_skus?id=${inFilter(ids)}&cycle_id=eq.${encodeURIComponent(cycleId)}&customer_enabled=eq.true&select=*`);
  if ((skuRows || []).length !== ids.length) return deps.json({ ok:false, error:'One of those covers is no longer available' }, 409);
  const existingQty = await orderedQtyBySku(db, cycleId);
  const lines = [];
  let subtotalCents = 0, totalQuantity = 0;
  for (const requestedItem of requested) {
    const sku = skuRows.find(row => row.id === requestedItem.skuId);
    const quantity = Math.max(1, Math.min(50, Number(requestedItem.quantity || 1)));
    const unitPriceCents = Number(sku.customer_price_cents || 0);
    if (unitPriceCents <= 0) return deps.json({ ok:false, error:`${sku.title} ${sku.variant_label || ''} needs a confirmed selling price before checkout` }, 409);
    if (unitPriceCents < 50) return deps.json({ ok:false, error:`${sku.title} does not have a valid customer price yet` }, 409);
    if (sku.is_incentive && Number(sku.secured_quantity || 0) < (existingQty.get(sku.id) || 0) + quantity) return deps.json({ ok:false, error:`${sku.title} ${sku.variant_label || ''} is waitlist-only until the store secures more copies` }, 409);
    subtotalCents += unitPriceCents * quantity;
    totalQuantity += quantity;
    lines.push({ sku, quantity, unitPriceCents });
  }
  const fulfillment = body.fulfillment || {};
  const method = fulfillment.method === 'shipping' ? 'shipping' : 'pickup';
  const customerName = text(fulfillment.name || auth.user.user_metadata?.full_name || auth.user.email?.split('@')[0],160);
  const customerEmail = text(auth.user.email,200);
  const customerPhone = text(fulfillment.phone,40);
  const shippingAddress = method === 'shipping' ? fulfillment.shippingAddress || null : null;
  let shipping = null;
  try { if (method === 'shipping') shipping = await requireShippingRate(env, deps, storeId, shippingAddress, text(fulfillment.shippingRateId,100)); }
  catch (error) { return deps.json({ ok:false, error:error.message }, 409); }
  const shippingCents = Number(shipping?.amountCents || 0);
  const totalCents = subtotalCents + shippingCents;
  const orderId = crypto.randomUUID();
  const orderNumber = `FOC-${cycle.foc_date.replaceAll('-','')}-${orderId.slice(0,8).toUpperCase()}`;
  const mode = deps.stripeMode(env);
  const cfg = deps.stripeConfig(env, mode);
  if (!cfg.secretKey || !cfg.publishableKey) return deps.json({ ok:false, error:'Online preorder payments are not configured' }, 503);
  const orderRow = {
    id:orderId, order_number:orderNumber, store_id:storeId, cycle_id:cycleId, user_id:auth.user.id,
    status:'payment_pending', customer_name:customerName, customer_email:customerEmail, customer_phone:customerPhone || null,
    fulfillment_method:method, shipping_address:shippingAddress, shipping_provider:shipping?.provider || null,
    shipping_rate_id:shipping?.rateId || null, shipping_service:shipping ? [shipping.carrier,shipping.service].filter(Boolean).join(' ') : null,
    subtotal_cents:subtotalCents, shipping_cents:shippingCents, total_cents:totalCents, stripe_mode:mode,
  };
  await db('foc_preorder_orders', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(orderRow) });
  await db('foc_preorder_items', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(lines.map(line => ({
    order_id:orderId, store_id:storeId, cycle_id:cycleId, sku_id:line.sku.id, quantity:line.quantity,
    unit_price_cents:line.unitPriceCents, sku_snapshot:{ title:line.sku.title, variantLabel:line.sku.variant_label, coverArtist:line.sku.cover_artist, coverImageUrl:line.sku.cover_image_url, upc:line.sku.upc, onSaleDate:line.sku.on_sale_date },
  }))) });
  try {
    const params = new URLSearchParams({ amount:String(totalCents), currency:'usd', 'automatic_payment_methods[enabled]':'true', 'receipt_email':customerEmail,
      'metadata[source]':'foc_preorder', 'metadata[foc_order_id]':orderId, 'metadata[foc_cycle_id]':cycleId, 'metadata[arsca_store_id]':storeId, 'metadata[order_number]':orderNumber });
    const intent = await deps.stripeApi(env, mode, 'payment_intents', { method:'POST', params, idempotencyKey:`arsca-foc-${mode}-${orderId}` });
    await db(`foc_preorder_orders?id=eq.${orderId}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ stripe_payment_intent_id:intent.id }) });
    return deps.json({ ok:true, orderId, orderNumber, clientSecret:intent.client_secret, paymentIntentId:intent.id, publishableKey:cfg.publishableKey, amountCents:totalCents, shippingCents, mode, totalQuantity });
  } catch (error) {
    await db(`foc_preorder_orders?id=eq.${orderId}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ status:'payment_failed', admin_note:text(error.message,500) }) }).catch(() => {});
    return deps.json({ ok:false, error:`Payment setup failed: ${error.message}` }, 502);
  }
}

async function waitlist(request, env, deps) {
  const auth = await deps.requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 16 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId=text(body.storeId,80), skuId=text(body.skuId,80);
  const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);
  const { data:skus } = await db(`comic_skus?id=eq.${encodeURIComponent(skuId)}&store_id=eq.${encodeURIComponent(storeId)}&is_incentive=eq.true&select=id,cycle_id,title,variant_label,cycle:foc_cycles(status,customer_cutoff_at)&limit=1`);
  const sku=skus?.[0]; if(!sku)return deps.json({ok:false,error:'That incentive cover was not found'},404);
  if(!cycleOpen(sku.cycle))return deps.json({ok:false,error:'Requests are closed for this FOC cycle'},409);
  const row={store_id:storeId,cycle_id:sku.cycle_id,sku_id:sku.id,user_id:auth.user.id,requested_quantity:Math.max(1,Math.min(10,Number(body.quantity||1))),status:'waitlisted',customer_note:text(body.note,500)||null};
  const { data:requests }=await db('foc_incentive_requests?on_conflict=user_id,sku_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)});
  return deps.json({ok:true,request:requests?.[0]||row,message:'Request saved. Incentive availability is not guaranteed and you have not been charged.'});
}

async function myPreorders(request, env, deps, url) {
  const auth=await deps.requireAuthenticatedUser(request,env);if(auth.error)return auth.error;
  const storeId=text(url.searchParams.get('store_id'),80);const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);
  const {data:orders}=await db(`foc_preorder_orders?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&status=${inFilter([...CUSTOMER_STATUSES,'payment_pending','payment_failed'])}&select=*,cycle:foc_cycles(customer_cutoff_at)&order=created_at.desc&limit=200`);
  const ids=(orders||[]).map(order=>order.id);let items=[];
  if(ids.length){({data:items}=await db(`foc_preorder_items?order_id=${inFilter(ids)}&select=*,sku:comic_skus(id,title,variant_label,cover_artist,cover_image_url,on_sale_date,upc)`));}
  const grouped=(orders||[]).map(order=>({...order,items:(items||[]).filter(item=>item.order_id===order.id),canCancel:new Date(order.cycle?.customer_cutoff_at||0).getTime()>Date.now()&&!['cancelled','refunded','shipped','completed'].includes(order.status)}));
  return deps.json({ok:true,orders:grouped});
}

async function cancelPreorder(request, env, deps) {
  const auth=await deps.requireAuthenticatedUser(request,env);if(auth.error)return auth.error;
  const limited=await deps.readJsonWithLimit(request,16*1024);if(limited.error)return limited.error;
  const orderId=text(limited.data?.orderId,80);const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);
  const {data:orders}=await db(`foc_preorder_orders?id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=*,cycle:foc_cycles(customer_cutoff_at)&limit=1`);
  const order=orders?.[0];if(!order)return deps.json({ok:false,error:'Preorder not found'},404);
  if(new Date(order.cycle?.customer_cutoff_at).getTime()<=Date.now())return deps.json({ok:false,error:'This FOC is closed. Contact the store about distributor cancellation options.'},409);
  if(['cancelled','refunded'].includes(order.status))return deps.json({ok:true,status:order.status});
  if(order.status==='payment_pending'||order.status==='payment_failed'){
    if(order.stripe_payment_intent_id)await deps.stripeApi(env,order.stripe_mode||deps.stripeMode(env),`payment_intents/${encodeURIComponent(order.stripe_payment_intent_id)}/cancel`,{method:'POST',params:new URLSearchParams()}).catch(()=>{});
    await db(`foc_preorder_orders?id=eq.${order.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'cancelled',cancelled_at:new Date().toISOString()})});
    return deps.json({ok:true,status:'cancelled'});
  }
  if(!order.stripe_payment_intent_id)return deps.json({ok:false,error:'No payment was found to refund'},409);
  const refund=await deps.stripeApi(env,order.stripe_mode||deps.stripeMode(env),'refunds',{method:'POST',params:new URLSearchParams({payment_intent:order.stripe_payment_intent_id,reason:'requested_by_customer'}),idempotencyKey:`arsca-foc-refund-${order.id}`});
  const status=refund.status==='succeeded'?'refunded':'cancelled';
  await db(`foc_preorder_orders?id=eq.${order.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,stripe_refund_id:refund.id,cancelled_at:new Date().toISOString()})});
  await db(`foc_preorder_items?order_id=eq.${order.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:refund.status==='succeeded'?'refunded':'cancelled'})});
  return deps.json({ok:true,status,refundStatus:refund.status});
}

function csvField(value){const s=String(value==null?'':value);return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}

async function exportPrh(env,deps,url,request){
  const storeId=text(url.searchParams.get('store_id'),80);const cycleId=text(url.searchParams.get('cycle_id'),80);
  const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin','manager','employee']);if(auth.error)return auth.error;
  const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);const qty=await orderedQtyBySku(db,cycleId);
  const {data:skus}=await db(`comic_skus?cycle_id=eq.${encodeURIComponent(cycleId)}&select=id,upc,title,variant_label,cover_artist,store_quantity&order=title.asc`);
  const lines=[['UPC','Quantity','Title','Variant','Cover Artist'].map(csvField).join(',')];
  for(const sku of skus||[]){const total=(qty.get(sku.id)||0)+Number(sku.store_quantity||0);if(total<=0)continue;lines.push([sku.upc,total,sku.title,sku.variant_label||'',sku.cover_artist||''].map(csvField).join(','));}
  return new Response(lines.join('\r\n'),{status:200,headers:{...deps.CORS,'Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment; filename="prh-foc-${cycleId}.csv"`,'Cache-Control':'no-store'}});
}

async function adminCycle(request,env,deps,url){
  const storeId=text(url.searchParams.get('store_id'),80);const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin','manager','employee']);if(auth.error)return auth.error;
  const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);
  if(request.method==='GET'){
    const cycleId=text(url.searchParams.get('cycle_id'),80);
    if(cycleId){const catalog=await loadCatalog(db,storeId,cycleId,true);return catalog?deps.json({ok:true,...catalog}):deps.json({ok:false,error:'FOC cycle not found'},404);}
    const {data:cycles}=await db(`foc_cycles?store_id=eq.${encodeURIComponent(storeId)}&select=${catalogCycleSelect()}&order=foc_date.desc&limit=100`);return deps.json({ok:true,cycles:cycles||[]});
  }
  const limited=await deps.readJsonWithLimit(request,32*1024);if(limited.error)return limited.error;const body=limited.data||{};
  const cycleId=text(body.cycleId,80);if(!cycleId)return deps.json({ok:false,error:'cycleId is required'},400);
  const patch={};if(['open','closed','archived'].includes(body.status))patch.status=body.status;if(['pay_now','reserve','both'].includes(body.preorderMode))patch.preorder_mode=body.preorderMode;if(body.customerCutoffAt&&Number.isFinite(Date.parse(body.customerCutoffAt)))patch.customer_cutoff_at=new Date(body.customerCutoffAt).toISOString();
  const {data:cycles}=await db(`foc_cycles?id=eq.${cycleId}&store_id=eq.${encodeURIComponent(storeId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});return deps.json({ok:true,cycle:cycles?.[0]});
}

async function adminSku(request,env,deps){
  const limited=await deps.readJsonWithLimit(request,32*1024);if(limited.error)return limited.error;const body=limited.data||{};const storeId=text(body.storeId,80);
  const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin','manager','employee']);if(auth.error)return auth.error;
  const skuId=text(body.skuId,80),familyId=text(body.familyId,80);const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);
  if(familyId){const patch={};if(body.heat===null||Number(body.heat)>=1&&Number(body.heat)<=5)patch.heat=body.heat===null?null:Number(body.heat);if(body.heatCategory===null||['dont_sleep','sleeper_watch','solid_stock','special_order','pass'].includes(body.heatCategory))patch.heat_category=body.heatCategory;if(body.adminNote!==undefined)patch.admin_note=text(body.adminNote,4000)||null;const {data:rows}=await db(`comic_title_families?id=eq.${familyId}&store_id=eq.${encodeURIComponent(storeId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});return deps.json({ok:true,family:rows?.[0]});}
  if(!skuId)return deps.json({ok:false,error:'skuId or familyId is required'},400);
  const patch={};if(body.storeQuantity!==undefined)patch.store_quantity=Math.max(0,Math.min(10000,Number(body.storeQuantity)||0));if(body.securedQuantity!==undefined)patch.secured_quantity=Math.max(0,Math.min(1000,Number(body.securedQuantity)||0));if(body.customerPrice!==undefined)patch.customer_price_cents=Math.max(0,Math.round(Number(body.customerPrice)*100));if(body.customerEnabled!==undefined)patch.customer_enabled=!!body.customerEnabled;if(body.qualificationOverrideTotal===null||body.qualificationOverrideTotal!==undefined)patch.qualification_override_total=body.qualificationOverrideTotal===null?null:Math.max(0,Number(body.qualificationOverrideTotal)||0);if(body.qualificationNote!==undefined)patch.qualification_note=text(body.qualificationNote,2000)||null;
  const {data:rows}=await db(`comic_skus?id=eq.${skuId}&store_id=eq.${encodeURIComponent(storeId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});return deps.json({ok:true,sku:rows?.[0]});
}

async function saveShippingSettings(request,env,deps){
  const limited=await deps.readJsonWithLimit(request,32*1024);if(limited.error)return limited.error;const body=limited.data||{};const storeId=text(body.storeId,80);
  const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin']);if(auth.error)return auth.error;const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);
  const {data:rows}=await db(`store_settings?store_id=eq.${encodeURIComponent(storeId)}&select=id,payment_settings&limit=1`);const row=rows?.[0];if(!row)return deps.json({ok:false,error:'Store settings not found'},404);
  const shipFrom=body.shipFrom||{},parcel=body.defaultParcel||{};const shipping={enabled:body.enabled===true,provider:'shippo',shipFrom:{name:text(shipFrom.name,120),line1:text(shipFrom.line1,200),line2:text(shipFrom.line2,200),city:text(shipFrom.city,120),state:text(shipFrom.state,20).toUpperCase(),zip:text(shipFrom.zip,20),phone:text(shipFrom.phone,40),email:text(shipFrom.email,200)},defaultParcel:{length:text(parcel.length||'12',20),width:text(parcel.width||'9',20),height:text(parcel.height||'1',20),distance_unit:'in',weight:text(parcel.weight||'1',20),mass_unit:'lb'}};
  const payment_settings={...(row.payment_settings||{}),shipping};await db(`store_settings?id=eq.${row.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({payment_settings})});return deps.json({ok:true,shipping:{...shipping,tokenConfigured:!!env.SHIPPO_API_TOKEN}});
}

async function getShippingSettings(request,env,deps,url){
  const storeId=text(url.searchParams.get('store_id'),80);const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin']);if(auth.error)return auth.error;
  const db=(path,options)=>deps.supabaseAdminFetch(env,path,options);const shipping=await shippingSettings(db,env,storeId);
  return deps.json({ok:true,shipping});
}

export async function syncFocStripeEvent(env, event, deps) {
  const object=event.data?.object||{};if(!event.type.startsWith('payment_intent.')||object.metadata?.source!=='foc_preorder')return;
  const orderId=text(object.metadata?.foc_order_id,80);if(!orderId)return;
  let status=object.status;if(event.type==='payment_intent.succeeded')status='paid';else if(event.type==='payment_intent.payment_failed')status='payment_failed';else if(event.type==='payment_intent.canceled')status='cancelled';
  const patch={status,stripe_charge_id:object.latest_charge||null};if(status==='paid')patch.paid_at=new Date().toISOString();if(status==='cancelled')patch.cancelled_at=new Date().toISOString();
  await deps.supabaseAdminFetch(env,`foc_preorder_orders?id=eq.${encodeURIComponent(orderId)}&stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
}

export async function handleFocRequest(request, env, url, deps) {
  const path=url.pathname;
  if(path==='/public/shipping/quotes'&&request.method==='POST')return quoteShipping(request,env,deps);
  if(path==='/public/preorders'&&request.method==='GET'){
    const storeId=text(url.searchParams.get('store_id'),80);const db=(p,o)=>deps.supabaseAdminFetch(env,p,o);const catalog=await loadCatalog(db,storeId,url.searchParams.get('cycle')||'',false);return catalog?deps.json({ok:true,...catalog}):deps.json({ok:false,error:'No FOC catalog is published yet'},404);
  }
  if(path==='/public/preorders/checkout'&&request.method==='POST')return preorderCheckout(request,env,deps);
  if(path==='/public/preorders/waitlist'&&request.method==='POST')return waitlist(request,env,deps);
  if(path==='/public/preorders/my'&&request.method==='GET')return myPreorders(request,env,deps,url);
  if(path==='/public/preorders/cancel'&&request.method==='POST')return cancelPreorder(request,env,deps);
  if(path==='/foc/admin/import'&&request.method==='POST')return importPrh(request,env,deps,text(request.headers.get('X-Store-Id'),80));
  if(path==='/foc/admin/cycles'&&(request.method==='GET'||request.method==='PATCH'))return adminCycle(request,env,deps,url);
  if(path==='/foc/admin/sku'&&request.method==='PATCH')return adminSku(request,env,deps);
  if(path==='/foc/admin/export'&&request.method==='GET')return exportPrh(env,deps,url,request);
  if(path==='/foc/admin/shipping-settings'&&request.method==='GET')return getShippingSettings(request,env,deps,url);
  if(path==='/foc/admin/shipping-settings'&&request.method==='PATCH')return saveShippingSettings(request,env,deps);
  return deps.json({ok:false,error:'FOC route not found'},404);
}
