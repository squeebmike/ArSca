// Supplier imports keep supplier cost separate from acquisition cost and never
// represent BCW's stock as physically owned inventory. No schema change needed.
const clean = (v, max = 2000) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0,max);
const url = v => { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const amount = v => v === '' || v == null ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)*100)/100 : null;
const list = (v, max = 50) => Array.isArray(v) ? v.slice(0,max) : [];
export async function supplierItemId(storeId, vendor, sku) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['dropship-v1',storeId,vendor.toUpperCase(),sku]))));
  digest[6] = (digest[6] & 15) | 128; digest[8] = (digest[8] & 63) | 128;
  const h = [...digest.slice(0,16)].map(n => n.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export async function prepareDropship(raw, options) {
  const {storeId, nowIso, publish = false} = options;
  const vendor = clean(raw?.supplier || options.vendor || 'BCW',80);
  const sku = clean(raw?.sku,160); const name = clean(raw?.name,200);
  const price = amount(raw?.price);
  if (!name || (!sku && !(price > 0))) throw new Error('A name and either a supplier SKU or positive price are required');
  if (raw?.price != null && raw.price !== '' && price == null) throw new Error('Invalid selling price');
  const availability = ['in_stock','out_of_stock','backorder','preorder','unknown'].includes(raw?.availability) ? raw.availability : 'unknown';
  const images = [...new Set([raw?.image || raw?.image_url, ...list(raw?.image_urls,12)].map(url).filter(Boolean))].slice(0,12);
  const specs = raw?.specifications && typeof raw.specifications === 'object' && !Array.isArray(raw.specifications) ? Object.fromEntries(Object.entries(raw.specifications).slice(0,60).map(([k,v]) => [clean(k,80),clean(v,500)])) : {};
  const supplier = sku ? {
    sku, supplierSku:sku, supplierCost:amount(raw?.cost), supplierMsrp:amount(raw?.msrp),
    supplierAvailability:availability, supplierRestockDate:clean(raw?.restock_date,200),
    supplierUrl:url(raw?.product_url), supplierCheckedAt: Number.isFinite(Date.parse(raw?.checked_at)) ? new Date(raw.checked_at).toISOString() : null,
    supplierCategoryPaths:list(raw?.category_paths).map(v=>clean(v,300)),
    supplierPriceTiers:list(raw?.price_tiers).filter(t=>Number.isInteger(Number(t?.quantity)) && Number(t.quantity)>0 && amount(t.price)>0).map(t=>({quantity:Number(t.quantity),price:amount(t.price)})),
    supplierSpecifications:specs, supplierPriceBasis:clean(raw?.price_basis,80),
    supplierReviewNotes:clean(raw?.review_notes), supplierPackQuantity:amount(raw?.pack_quantity),
    supplierSellingUnit:clean(raw?.selling_unit,200), supplierUpc:clean(raw?.upc,80),
    supplierSyncedAt:nowIso,
  } : {};
  return {
    id:sku ? await supplierItemId(storeId,vendor,sku) : crypto.randomUUID(),
    store_id:storeId, status:'active',
    data:{name,category:clean(options.category || 'Supplies',80),priceOverride:price || 0,image:images[0] || '',photos:images,
      description:clean(raw?.description,10000),quantity:sku ? (availability === 'in_stock' ? 999 : 0) : 999,
      dropship:true,vendor,onlineListed:publish === true && price>0 && (!sku || availability==='in_stock' && !supplier.supplierReviewNotes),
      source:'dropship_import',importedAt:nowIso,...supplier}
  };
}
export function refreshDropship(existing, incoming) {
  if (existing.store_id !== incoming.store_id || existing.data?.supplierSku !== incoming.data.supplierSku || String(existing.data?.vendor).toUpperCase() !== incoming.data.vendor.toUpperCase() || !existing.data?.dropship) throw new Error('Supplier identity conflict; existing item was not changed');
  const supplier = Object.fromEntries(Object.entries(incoming.data).filter(([key])=>key.startsWith('supplier')));
  const oldTime = Date.parse(existing.data.supplierCheckedAt);
  const newTime = Date.parse(incoming.data.supplierCheckedAt);
  if (Number.isFinite(oldTime) && (!Number.isFinite(newTime) || newTime < oldTime)) throw new Error('Older supplier snapshot; existing item was not changed');
  // Preserve edited title, descriptions, photos, selling price, publication,
  // lifecycle, and all other store fields. Availability gates purchasing.
  return {...existing.data,...supplier,quantity:incoming.data.quantity};
}
export async function importDropshipBatch(rawItems, options, db) {
  const result = { imported:0, created:0, updated:0, skipped:[], failed:[] };
  const prepared = []; const seen = new Set();
  for (const raw of rawItems) {
    try {
      const row = await prepareDropship(raw,options);
      if (seen.has(row.id)) throw new Error('Duplicate SKU in batch');
      seen.add(row.id); prepared.push(row);
    } catch(e) { result.skipped.push(`${clean(raw?.sku || raw?.name,160)}: ${e.message}`); }
  }
  if (!prepared.length) return result;
  // Batches are capped by the endpoint at 50. IDs are generated UUIDs, never raw
  // supplier strings in PostgREST filter syntax. Scope every read/write by store.
  const storeFilter = 'store_id=eq.' + encodeURIComponent(options.storeId);
  const ids = prepared.map(r=>r.id).join(',');
  const {data:existingRows} = await db(`inventory_items?${storeFilter}&id=in.(${ids})&select=id,store_id,status,data,updated_at`);
  const existing = new Map((existingRows || []).map(r=>[r.id,r]));
  const additions = prepared.filter(r=>!existing.has(r.id));
  if (additions.length) {
    // Primary-key conflicts are ignored, never overwritten. A retry can refresh
    // the existing item; concurrent imports cannot create duplicate SKU rows.
    const {data:created} = await db('inventory_items?on_conflict=id', {method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(additions)});
    const createdIds = new Set((created || []).map(r=>r.id));
    result.created += createdIds.size;
    for (const row of additions) if (!createdIds.has(row.id)) result.failed.push({sku:row.data.supplierSku || row.data.name,error:'Concurrent import; retry this SKU to refresh it'});
  }
  for (const incoming of prepared.filter(r=>existing.has(r.id))) {
    try {
      const old = existing.get(incoming.id); const data = refreshDropship(old,incoming);
      // Optimistic concurrency protects changes made while the import is open.
      const version = old.updated_at ? '&updated_at=eq.' + encodeURIComponent(old.updated_at) : '';
      const {data:changed} = await db(`inventory_items?${storeFilter}&id=eq.${incoming.id}${version}`, {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({data,updated_at:options.nowIso})});
      if (!changed?.length) throw new Error('Item changed during import; retry this SKU');
      result.updated++;
    } catch(e) { result.failed.push({sku:incoming.data.supplierSku || incoming.data.name,error:e.message}); }
  }
  result.imported = result.created + result.updated;
  return result;
}
