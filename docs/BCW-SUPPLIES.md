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

## Webflow page and product browsing

The native Webflow page is **Pages → BCW Supplies**, page ID `6aac10e883bbe3e1bf78cb50`, published at https://themanapocket.com/bcw. Its heading, introduction and guide copy are ordinary editable Webflow elements. It uses the existing **New NavBar** and **Footer** components. Product data and prices remain managed in ArSca.

The page footer loads `scripts/bcw-webflow.js`, pinned to its Git commit through jsDelivr. It queries `/public/bcw` on the Worker URL with CORS support. The public endpoint returns only published BCW products and excludes private supplier cost fields. Search, category filters, pagination, and product details work without changing the domain's DNS. Individual products open at `/bcw?item={id}` and use the existing site cart; product title, canonical URL, description and Product structured data are added by JavaScript. These are dynamic views, not individual Webflow CMS pages; search indexing depends on the crawler rendering JavaScript.

Site footer code updates existing Supplies links and the shop category selector to open `/bcw`. Preserve the other site custom code when editing this snippet. The empty catalog shows a coming-soon message until products are imported and published.

## Earlier server-rendered product routes

Each published, positively priced BCW listing has a server-rendered `/item/{id}/{name}` page with a canonical URL, product description, gallery, SKU, pack details, Product and Breadcrumb structured data, and the existing site cart. Private supplier costs and pricing tiers are not in the public response.

The catalog has SKU/name search, category filters and crawlable pagination. Product URLs are included in https://themanapocket.com/sitemap-items.xml. Submit that sitemap in Google Search Console when products are ready. Search result pages and the empty catalog are marked `noindex`; an empty catalog shows a coming-soon message. Unavailable published products retain their URL and show OutOfStock structured data with purchasing disabled.

The server-rendered `/item/*` and `/sitemap-items.xml` implementations remain available on the Worker, but the domain's Worker routes were not active at verification. Do not treat those main-domain URLs as live until routing is resolved. The native Webflow page uses the dynamic product views above instead. The `/bcw` handler passes through to Webflow on the main domain so a later DNS change will not replace the editable page.

## Fulfillment boundary

This release reuses the site's existing cart and shipping calculation. It does not request BCW shipping quotes, automatically place BCW orders, or track BCW fulfillment. Confirm your customer shipping charges before publishing the catalog for purchase. Supplier availability is only as current as the last collection/import. SEO markup enables discovery but does not guarantee indexing or ranking.

## Verification

Run `npm run test:bcw-catalog`, `npm run test:bcw-storefront`, and `npm run test:parse`. The storefront test exercises actual dashboard mapping/save functions and valuation rendering with mixed supplier and owned stock, plus public-field privacy, pagination, SKU lookup, and safe structured-data rendering.
