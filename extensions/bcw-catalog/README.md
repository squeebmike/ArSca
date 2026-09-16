# BCW Catalog Collector

Collect BCW's category listings and product details in one run, then upload the
export to ArSca's `supplies-import.html`. Uses the BCW SKU exactly as supplied.

## Install in Chrome

1. Extract the BCW Catalog ZIP to a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Sign in to your BCW wholesale account in that same Chrome profile.
5. Click the extension icon to open the collector. Confirm the account checkbox,
   then click **Collect entire catalog**. Keep the collector tab open.

The collector discovers BCW's category navigation, follows pagination, reads
product pages, and merges products by SKU. It uses one request at a time with a
delay. Closing Chrome stops collection; reopen the collector and choose Resume.
Rate limits, login expiry, or verification requests pause the run. Sign in or
complete verification yourself on BCW, then resume. Failed pages can be retried.
No account password is requested, stored, or exported. No order is placed.

## Export and import

- Choose blank selling prices (draft review), BCW reference/MSRP, or a markup on
  the displayed account cost. Markup is not profit margin and excludes shipping.
- Check several costs against your wholesale account. Login confirms an account
  session, not your wholesale account tier. The collector never promotes a
  quantity-10 discount to the cost of a quantity-1 purchase.
- Download **import CSV**. Search only filters the preview, not the export.
- Download **full catalog & report** to retain all data, omitted option-based
  products, pending pages, and failures. A finished scan with exceptions is not
  a verified complete catalog.
- Open Supplies Import in ArSca. Select the CSV, click Preview, then Import.
  New items default to drafts. Blank prices are allowed for supplier SKU drafts.
  The importer submits 50 rows per batch and shows created/refreshed counts.
- New items are eligible for immediate publication only if you select that
  option, they have a positive price, confirmed stock, and no review flags.
- Repeat BCW SKU imports refresh supplier fields and availability, preserving
  the store's selling price, title, description, photos, and publication choice.
  Out-of-stock, backordered, preorder, or unknown availability sets purchase
  quantity to zero. Back-in-stock snapshots restore the existing synthetic
  dropship purchase quantity; this is not a real BCW stock count.
- Use **Refresh collected products** after the first scan to revisit existing
  product URLs. To discover newly added categories/products, use **Scan all
  categories again**. Saved products are retained; disappearance from navigation
  alone does not prove discontinuation or change availability.

## Data contract

`csv.mjs` defines the columns shared by the extension and importer:

`supplier`, `sku`, `name`, `price`, `cost`, `msrp`, `image_url`, `image_urls`,
`description`, `category`, `category_paths`, `pack_quantity`, `selling_unit`,
`upc`, `availability`, `restock_date`, `product_url`, `price_tiers`,
`specifications`, `checked_at`, `price_basis`, `review_notes`.

Arrays/objects use JSON inside properly quoted CSV cells. Multiline descriptions
and commas are supported. Spreadsheet formula prefixes are neutralized during
export and reversed by the paired importer. Images are original BCW URLs, not
downloaded copies. Confirm image hosting requirements before public launch.
Case weight remains a labeled specification; it is never treated as pack weight.

Supplier cost is stored as `supplierCost`, not a purchased-inventory acquisition
cost. Availability is a timestamped snapshot: this extension does not provide
automatic server inventory synchronization, BCW order submission, shipping
quotes, or tracking sync. Product families requiring option selection are held
in the report until their individual sellable SKUs can be verified.

SKU identity uses a stable store + supplier + SKU UUID. Concurrent new imports
cannot duplicate that identity; existing-row updates use an updated-at guard.
Items previously imported without a SKU are not automatically matched by name.
Legacy four-column CSVs remain supported, but repeating those can create duplicates.

## Validation

Run `npm run test:bcw-catalog` from the repository root. Tests cover BCW HTML
structures, pagination, account price tiers, images, CSV round trips, drafts,
stock gating, store isolation, duplicate prevention, preservation of edits,
concurrent updates, login failure, retry limits, and HTTP 429 pause behavior.

The parser was also checked against public BCW category and product HTML on
2026-09-16. A full authenticated wholesale run must be validated in the user's
Chrome profile; public HTML alone cannot verify account-specific prices.
