# Consignment owner inventory

The Consignment tab is an owner-level inventory ledger. Operators can select a consignor, search item/owner/contact/notes/SKU, filter by lifecycle, and sort by owner, value, store profit, received date, or sold date.

Each record tracks asking price, current market value, optional owner cost basis, store commission percentage, linked inventory ID/SKU, status, sale price/date/channel, store profit, owner payout, and payout status. Existing records remain compatible; missing cost and market fields fall back safely.

## Inventory sale integration

When adding a consignment, **Link Existing Inventory Item** ties the consignment record to normal store inventory. If that linked item sells through checkout, `markCartItemsSoldFromPayment` calls the consignment sale hook. The hook:

1. Marks the consignment sold using the actual checkout price/date/tender.
2. Calculates store commission and owner payout.
3. Writes an open `pos_consignment_alerts` entry.
4. Shows a global alert and a payout-required card in the Alerts tab.

Marking the consignor paid settles the corresponding alert. A consignment-only record can still be marked sold manually and creates the same payout alert.
