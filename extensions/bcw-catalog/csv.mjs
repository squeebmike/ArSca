// Shared with the Supplies Import page. No runtime dependencies.
export const COLUMNS = ['supplier','sku','name','price','cost','msrp','image_url','image_urls','description','category','category_paths','pack_quantity','selling_unit','upc','availability','restock_date','product_url','price_tiers','specifications','checked_at','price_basis','review_notes'];
export function parseCSV(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === '') quoted = !quoted;
      else cell += ch;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
export function csvCell(value) {
  let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralize spreadsheet formulas. Import removes this prefix on text fields.
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const unescapeCell = value => String(value ?? '').replace(/^'(?=\s*[=+@-])/, '');
export function exportCSV(products, pricing = 'blank', markup = 40) {
  return '\uFEFF' + [COLUMNS, ...products.map(p => {
    const price = pricing === 'msrp' ? p.msrp : pricing === 'markup' && Number(p.cost) > 0 ? Math.round(p.cost * (1 + markup / 100) * 100) / 100 : '';
    return COLUMNS.map(key => key === 'price' ? price : p[key]);
  })].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function money(value) {
  const s = String(value ?? '').replace(/[$,\s]/g, '');
  return /^\d+(?:\.\d{1,4})?$/.test(s) ? Number(s) : null;
}
export function parseImportCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map(v => v.trim().toLowerCase().replace(/\s+/g,'_'));
  const hasHeader = header.includes('name') && (header.includes('sku') || header.includes('price'));
  const columns = hasHeader ? header : ['name', 'price', 'image_url', 'description'];
  const seen = new Set();
  return (hasHeader ? rows.slice(1) : rows).map((row, i) => {
    const p = Object.fromEntries(columns.map((key, n) => [key, unescapeCell(row[n]).trim()]));
    const errors = [];
    for (const key of ['price','cost','msrp']) {
      const raw = p[key]; p[key] = money(raw);
      if (raw && p[key] == null) errors.push('Invalid ' + key);
    }
    if (!p.name) errors.push('Missing name');
    if (!(p.price > 0) && !p.sku) errors.push('Set a selling price');
    if (columns.includes('sku') && !p.sku) errors.push('Missing BCW SKU');
    p.image = p.image_url || p.image || '';
    for (const [key, fallback] of [['image_urls', []], ['category_paths', []], ['price_tiers', []], ['specifications', {}]]) {
      try { p[key] = p[key] ? JSON.parse(p[key]) : fallback; }
      catch { p[key] = fallback; errors.push('Invalid JSON in ' + key); }
      if (Array.isArray(fallback) ? !Array.isArray(p[key]) : !p[key] || Array.isArray(p[key]) || typeof p[key] !== 'object') { p[key] = fallback; errors.push('Invalid ' + key); }
    }
    if (p.sku) {
      const id = (p.supplier || 'BCW').toUpperCase() + '\0' + p.sku;
      if (seen.has(id)) errors.push('Duplicate supplier SKU');
      seen.add(id);
    }
    p.rowNumber = i + (hasHeader ? 2 : 1); p.errors = errors; p.valid = errors.length === 0;
    return p;
  });
}
