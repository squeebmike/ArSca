import { money } from './csv.mjs';
export const ORIGIN = 'https://www.bcwsupplies.com';
const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values.filter(Boolean))];
export function catalogURL(value, base = ORIGIN) {
  if (typeof value !== 'string' || !value.trim() || /^(null|undefined|#)$/i.test(value.trim())) return '';
  try {
    const u = new URL(value, base);
    if (u.origin !== ORIGIN || u.username || u.password) return '';
    if (/\/(null|undefined)\/?$/i.test(u.pathname)) return '';
    if (/\/(customer|checkout|wishlist|review|catalogsearch|blog|contact|sales|quickorder|product_compare|amasty|sendfriend|newsletter|rest)(\/|$)/i.test(u.pathname)) return '';
    u.hash = '';
    const page = u.searchParams.get('p'); u.search = '';
    if (page && /^\d+$/.test(page) && Number(page) > 1) u.searchParams.set('p', page);
    return u.href;
  } catch { return ''; }
}
function safeImage(value, base) {
  try { const u = new URL(value, base); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}
function plain(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script,style,iframe,form').forEach(n => n.remove());
  clone.querySelectorAll('br,p,li,div').forEach(n => n.append('\n'));
  return clone.textContent.replace(/\{\{[^}]*\}\}/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}
export function parsePage(html, url, Parser = DOMParser) {
  const doc = new Parser().parseFromString(html, 'text/html');
  if (/just a moment|access denied|verify you are human/i.test(text(doc.querySelector('title')))) throw new Error('BCW requires browser verification. Open BCW, then resume.');
  const categories = unique([...doc.querySelectorAll('.navigation .subchildmenu a[href], .navigation a.level-top[href], .block-category-list a[href]')].map(a => catalogURL(a.getAttribute('href'), url)));
  const productLinks = unique([...doc.querySelectorAll('.product-item-link')].map(a => catalogURL(a.getAttribute('href'), url)));
  const next = unique([...doc.querySelectorAll('.pages a.next, .pages-item-next a, link[rel="next"]')].map(a => catalogURL(a.getAttribute('href'), url)));
  const crumb = [...doc.querySelectorAll('.breadcrumbs li')].map(text).filter(x => x && !/^home$/i.test(x));
  const category = crumb.join(' > ') || text(doc.querySelector('h1'));
  const info = doc.querySelector('.product-info-main');
  if (!info) {
    if (!categories.length && !productLinks.length && !doc.querySelector('.message.empty')) throw new Error('Unrecognized BCW page; no catalog links found.');
    return { kind: 'category', categories, productLinks, next, category, product: null };
  }
  const sku = doc.querySelector('meta[itemprop="sku"]')?.getAttribute('content') || text(info.querySelector('[itemprop="sku"], .product.attribute.sku .value')).replace(/^SKU\s*:\s*/i, '');
  const name = text(info.querySelector('h1')) || text(doc.querySelector('h1'));
  if (!sku || !name) throw new Error('Product is missing its SKU or name.');
  const tierNodes = [...info.querySelectorAll('.tier_price1')];
  const tiers = tierNodes.map(n => {
    const match = text(n.closest('li')).match(/(?:Buy\s+)?(\d+)\s+for\b/i);
    return { quantity: match ? Number(match[1]) : null, price: money(text(n)) };
  }).filter(t => t.quantity > 0 && t.price > 0);
  const basePrice = money(text(info.querySelector('.custom_price'))) ?? money(info.querySelector('[data-price-type="finalPrice"]')?.getAttribute('data-price-amount'));
  const tierOne = tiers.find(t => t.quantity === 1)?.price;
  const cost = tierOne ?? basePrice;
  // BCW's microdata price is the public reference; never use it as wholesale cost.
  const reference = money(doc.querySelector('meta[itemprop="price"]')?.getAttribute('content'));
  const msrpMatch = text(info).match(/MSRP\s*:\s*\$([\d,.]+)/i);
  const msrp = msrpMatch ? money(msrpMatch[1]) : reference;
  const specs = Object.fromEntries([...doc.querySelectorAll('#product-attribute-specs-table tr')].map(tr => [text(tr.querySelector('th')), text(tr.querySelector('td'))]).filter(([k]) => k));
  let gallery = [];
  for (const s of doc.querySelectorAll('script[type="text/x-magento-init"]')) {
    try {
      const config = JSON.parse(s.textContent);
      for (const entry of Object.values(config)) {
        const data = entry?.['mage/gallery/gallery']?.data;
        if (Array.isArray(data)) gallery.push(...data.filter(x => x.type === 'image').sort((a,b) => Number(b.isMain) - Number(a.isMain)).map(x => x.full || x.img));
      }
    } catch { /* Unrelated Magento initialization is not product data. */ }
  }
  if (!gallery.length) gallery = [...doc.querySelectorAll('.gallery-placeholder img, meta[itemprop="image"]')].map(n => n.getAttribute('src') || n.getAttribute('content'));
  const images = unique(gallery.map(u => safeImage(u, url)));
  const unit = text(info.querySelector('.web_package_title'));
  const pack = unit.match(/^(\d+)\s+(.+?)\s+per\s+(.+)$/i);
  const stock = text(info.querySelector('.stock'));
  const restock = text(info.querySelector('.BO-tooltip > span:first-child'));
  const schemaStock = doc.querySelector('[itemprop="availability"]')?.getAttribute('href') || '';
  let availability = 'unknown';
  if (/back.?order/i.test(stock + restock)) availability = 'backorder';
  else if (/pre.?order/i.test(stock + restock)) availability = 'preorder';
  else if (restock) availability = 'backorder';
  else if (/out.?of.?stock/i.test(stock + schemaStock) || info.querySelector('.stock.unavailable')) availability = 'out_of_stock';
  else if (/InStock$/.test(schemaStock) || /in stock/i.test(stock)) availability = 'in_stock';
  const notes = [];
  const configurable = !!doc.querySelector('[name^="super_attribute"], .swatch-opt, #bundleSummary');
  if (configurable) notes.push('Product requires option selection; verify individual variant SKUs before listing');
  if (!images.length) notes.push('No product images found');
  if (cost == null) notes.push('No account price found');
  if (availability === 'unknown') notes.push('Availability not confirmed');
  return { kind: 'product', categories: [], productLinks: [], next: [], category,
    product: { supplier: 'BCW', sku, name, cost, msrp, image_url: images[0] || '', image_urls: images,
      description: plain(doc.querySelector('.product.attribute.description .value')) || plain(info.querySelector('.product.attribute.overview .value')),
      category: 'Supplies', category_paths: [], pack_quantity: pack ? Number(pack[1]) : '', selling_unit: unit,
      upc: specs['UPC Code'] || '', availability, restock_date: restock, product_url: catalogURL(url),
      price_tiers: tiers, specifications: specs, checked_at: new Date().toISOString(),
      price_basis: tierOne != null ? 'account_quantity_1' : basePrice != null ? 'account_display_price' : 'unknown',
      review_notes: notes.join('; '), requires_options: configurable }
  };
}
