// Distributor weekly-shipment receiving. Distinct from the PRH FOC preorder
// pipeline in foc-preorders.mjs: this handles a periodicals distributor's
// "Pre-Delivery Report" (Ship-to Account / Carton Quantity / Total Receiving
// Quantity / PO Number style export) for comics that were never tracked as
// FOC preorder SKUs in this app -- there's no existing catalog row to
// reconcile against, so every arriving copy either tops up an existing
// shelf-stock UPC or becomes a brand-new inventory_items row directly.

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function exactIdentifier(value) {
  return text(value, 80).replace(/\.0+$/, '');
}

function dateIso(value) {
  const raw = text(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

function cents(value) {
  const number = Number(String(value == null ? '' : value).replace(/[$,]/g, ''));
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

function normalizeDeliveryRow(row = {}) {
  return {
    upc: exactIdentifier(row['UPC/ISBN'] || row.UPC || row.ISBN),
    title: text(row.Title, 500),
    publisher: text(row.Publisher, 300),
    usdListCents: cents(row['USD List Price']),
    cadListCents: cents(row['CAD List Price']),
    onSaleDate: dateIso(row['On Sale Date']),
    deliveryDate: dateIso(row['Delivery Date']),
    catalogDate: dateIso(row['Catalog Date']),
    cartonQuantity: Math.max(0, Math.round(Number(row['Carton Quantity']) || 0)),
    totalReceivingQuantity: Math.max(0, Math.round(Number(row['Total Receiving Quantity']) || 0)),
    poNumber: exactIdentifier(row['Purchase Order Number']),
    shipToAccount: exactIdentifier(row['Ship-to Account']),
    format: text(row.Format, 100),
  };
}

// PRH cost convention (foc-preorders.mjs receiveShipment) is 50% of MSRP;
// this distributor's actual discount is store-specific and set from the UI,
// clamped to a sane range so a typo (e.g. entering "50" meaning percent off
// as a raw multiplier) can't silently zero out or negative-cost an item.
function costCentsFromList(listCents, discountPercent) {
  const pct = Math.max(0, Math.min(90, Number(discountPercent)));
  return Math.round(listCents * (1 - pct / 100));
}

export async function handleReceivingRequest(request, env, url, deps) {
  const path = url.pathname;
  if (path === '/receiving/import' && request.method === 'POST') return importDelivery(request, env, deps);
  return deps.json({ ok: false, error: 'Receiving route not found' }, 404);
}

async function importDelivery(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 2 * 1024 * 1024);
  if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;

  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!rawRows.length) return deps.json({ ok: false, error: 'No rows provided' }, 400);
  if (rawRows.length > 1000) return deps.json({ ok: false, error: 'Import at most 1000 rows at a time' }, 400);

  const vendor = text(body.vendor, 120) || 'Distributor';
  const discountPercent = Number.isFinite(Number(body.discountPercent)) ? Number(body.discountPercent) : 50;

  const skipped = [];
  // A single UPC can legitimately appear on more than one line of the same
  // report (e.g. a short-ship follow-up carton) -- group and sum rather than
  // creating/patching the same item twice in one import.
  const byUpc = new Map();
  rawRows.forEach((raw, index) => {
    const line = index + 1;
    const row = normalizeDeliveryRow(raw || {});
    if (!row.upc || !row.title) { skipped.push({ line, reason: 'Missing UPC/ISBN or title' }); return; }
    if (row.totalReceivingQuantity <= 0) { skipped.push({ line, reason: 'Total Receiving Quantity is 0 -- nothing arrived on this line', title: row.title }); return; }
    const existing = byUpc.get(row.upc);
    if (existing) existing.totalReceivingQuantity += row.totalReceivingQuantity;
    else byUpc.set(row.upc, row);
  });

  if (!byUpc.size) return deps.json({ ok: false, error: 'No receivable rows found', skipped }, 400);

  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data: shelfRows } = await db(`inventory_items?store_id=eq.${encodeURIComponent(storeId)}&status=eq.in_stock&select=id,data`);
  const shelfByUpc = new Map();
  for (const row of shelfRows || []) {
    const upc = exactIdentifier(row.data?.upc);
    if (upc) shelfByUpc.set(upc, row);
  }

  const nowIso = new Date().toISOString();
  const poNumbers = new Set();
  const newRows = [];
  const updates = [];
  let createdCopies = 0, restockedCopies = 0;

  for (const rowData of byUpc.values()) {
    if (rowData.poNumber) poNumbers.add(rowData.poNumber);
    const match = shelfByUpc.get(rowData.upc);
    if (match) {
      const d = match.data || {};
      const nextQty = Math.max(0, Number(d.qty ?? d.quantity ?? 0)) + rowData.totalReceivingQuantity;
      updates.push({
        id: match.id,
        data: { ...d, qty: nextQty, quantity: nextQty, lastReceivedAt: nowIso, lastReceivedQty: rowData.totalReceivingQuantity, lastReceivedPoNumber: rowData.poNumber || d.lastReceivedPoNumber || '' },
      });
      restockedCopies += rowData.totalReceivingQuantity;
    } else {
      const listCents = rowData.usdListCents;
      newRows.push({
        store_id: storeId, status: 'in_stock',
        data: {
          name: rowData.title,
          category: /^comic book$/i.test(rowData.format) ? 'Comic' : (rowData.format || 'Book'),
          publisher: rowData.publisher, upc: rowData.upc,
          cost: costCentsFromList(listCents, discountPercent) / 100,
          market: listCents / 100, salePrice: listCents / 100,
          qty: rowData.totalReceivingQuantity, quantity: rowData.totalReceivingQuantity,
          image: '', vendor, format: rowData.format,
          onSaleDate: rowData.onSaleDate || null, deliveryDate: rowData.deliveryDate || null,
          source: 'distributor_receive', receivedAt: nowIso, poNumber: rowData.poNumber || '',
        },
      });
      createdCopies += rowData.totalReceivingQuantity;
    }
  }

  let createdCount = 0;
  if (newRows.length) {
    try {
      const { data: inserted } = await db('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(newRows) });
      createdCount = Array.isArray(inserted) ? inserted.length : newRows.length;
    } catch (e) {
      return deps.json({ ok: false, error: 'Import failed while creating new items: ' + e.message }, 502);
    }
  }
  for (const update of updates) {
    try {
      await db(`inventory_items?id=eq.${update.id}&store_id=eq.${encodeURIComponent(storeId)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: update.data }),
      });
    } catch (e) {
      skipped.push({ line: 0, reason: 'Could not restock existing item: ' + e.message, title: update.data.name });
    }
  }

  return deps.json({
    ok: true,
    createdCount, restockedCount: updates.length,
    createdCopies, restockedCopies,
    poNumbers: [...poNumbers],
    skipped,
  });
}
