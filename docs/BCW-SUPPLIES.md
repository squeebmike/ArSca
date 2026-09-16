# BCW supplies and dropshipping

## Import and publish

1. Load `extensions/bcw-catalog` as an unpacked Chrome extension. Sign into BCW with the wholesale account.
2. Collect the catalog. Review failures and configurable products separately; the collector does not invent missing variant SKUs.
3. Choose selling prices and export CSV. Supplier cost and selling price are separate fields.
4. Import at `supplies-import.html`. New items are drafts by default. Use the dashboard to review prices, product photos and descriptions, then publish selected items.
5. Published BCW products appear at https://themanapocket.com/bcw. Existing `/shop?cat=supplies` links redirect there. The shop also links directly to BCW supplies.

## Inventory accounting

The dashboard's **Dropshipping** filter shows supplier listings. The item editor's **Owned By → Dropshipping item (supplier-owned)** option preserves this classification. Imported BCW rows receive it automatically.

Dropship listings are excluded from owned-stock units, market/list valuations, invested cost, category valuation, aging and slow-mover reports, and owner analytics inventory totals. They remain sale listings. Supplier cost is stored separately as `supplierCost`; it is not acquisition cost. The availability quantity is a purchasing limit, not a physical stock count.

An inventory edit preserves the supplier SKU, costs, metadata and dropship flag. Reimporting the same SKU updates supplier information and availability while retaining edited selling prices, titles, descriptions, photos and publication. Run a fresh collection/import to update availability; this is not a live stock feed.

## Public product pages and search

Each published, positively priced BCW listing has a server-rendered `/item/{id}/{name}` page with a canonical URL, product description, gallery, SKU, pack details, Product and Breadcrumb structured data, and the existing site cart. Private supplier costs and pricing tiers are not in the public response.

The catalog has SKU/name search, category filters and crawlable pagination. Product URLs are included in https://themanapocket.com/sitemap-items.xml. Submit that sitemap in Google Search Console when products are ready. Search result pages and the empty catalog are marked `noindex`; an empty catalog shows a coming-soon message. Unavailable published products retain their URL and show OutOfStock structured data with purchasing disabled.

The Worker handles `/bcw*`, `/supplies*`, and the `/shop*` entry points. Other shop requests pass through to Webflow; a small shop enhancement links to BCW and redirects the Supplies category selection. Existing Webflow script pins do not need to change.

## Fulfillment boundary

This release reuses the site's existing cart and shipping calculation. It does not request BCW shipping quotes, automatically place BCW orders, or track BCW fulfillment. Confirm your customer shipping charges before publishing the catalog for purchase. Supplier availability is only as current as the last collection/import. SEO markup enables discovery but does not guarantee indexing or ranking.

## Verification

Run `npm run test:bcw-catalog`, `npm run test:bcw-storefront`, and `npm run test:parse`. The storefront test exercises actual dashboard mapping/save functions and valuation rendering with mixed supplier and owned stock, plus public-field privacy, pagination, SKU lookup, and safe structured-data rendering.
