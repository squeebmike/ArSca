import { COLUMNS, csvCell } from '../extensions/bcw-catalog/csv.mjs';
export function importCategories(rows) {
  return [...new Set(rows.flatMap(r => r.category_paths || []))].sort();
}
export function filterImportRows(rows, {category='', query='', inStock=true}={}) {
  const q=query.trim().toLowerCase();
  return rows.filter(r => (!category || (r.category_paths || []).includes(category)) &&
    (!q || [r.name,r.sku].join(' ').toLowerCase().includes(q)) &&
    (!inStock || r.availability === 'in_stock'));
}
export function priceImportRow(row, mode='keep', discount=0) {
  if(mode==='keep') return {...row};
  const factor=mode==='discount'?1-Math.min(100,Math.max(0,Number(discount)||0))/100:1;
  return {...row,price:row.msrp>0?Math.round(row.msrp*factor*100)/100:null};
}
export function exportImportRows(rows) {
  return '\uFEFF'+[COLUMNS,...rows.map(r=>COLUMNS.map(k=>r[k]))].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
