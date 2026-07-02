# Inventory deletion, sold retention, and customer browse

## Delete versus archive

Permanent delete is for unsold tests and accidental entries only. It requires typing `DELETE`. Items with sale, buy-session, consignment, payout, or sold history are protected from deletion and should be archived instead. Archive hides an item from active inventory while preserving its audit trail and reports.

## Sold data retention

Completed sales and sold inventory remain in Supabase as business history; they are not automatically deleted. The dashboard intentionally loads at most 1,000 inventory rows and renders the latest 100 sold rows so a large store does not freeze a browser. The database can retain long-term records safely, but a future reporting/export endpoint should use server-side pagination when a store needs to browse its entire multi-year history. Local transaction caches are also bounded to the latest 1,000 entries; Supabase remains the durable ledger.

## Customer Browse

Every store has a **More → Customer Browse** page sourced from its active-store inventory. It includes customer-safe search, category filtering, price sorting, and a full-screen mode. Only in-stock, non-archived items appear. Cost basis, profit, ownership, private notes, and dealer actions are excluded.

## Theme visibility

Settings → Branding & Theme controls primary, secondary, accent, background, both panel colors, normal text, muted text, success, warning, danger, info, borders, and button text. The default muted-text contrast was raised for readability; the High Contrast preset remains available.
