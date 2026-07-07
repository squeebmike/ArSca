# Data Model Notes

## Current Beta Classification

Inventory is cloud-backed when using the built-in Supabase inventory source and an authenticated Supabase session. Demo and offline paths use browser-local storage plus sync queues.

This branch should be released as single-store/tester beta unless a real Supabase test project proves cross-store denial with authenticated users. The schema has multi-store primitives, but automated RLS proof is not included here.

## Browser Credentials

`dashboard.html` initializes Supabase with a public anon/publishable key. No service-role key was found in browser client initialization during this pass. Service-role or bypass-RLS credentials must remain server-side only.

## Store-Scoped Tables Seen In Repo

- `stores`
- `store_members`
- `store_settings`
- `inventory_items`
- `sales`
- `scan_sessions`
- `scan_queue`
- `store_invites`
- `pos_sales`
- `pos_sale_lines`
- `pos_payments`
- `pos_drawer_sessions`
- `pos_drawer_movements`
- `customer_wants`
- `pos_audit_log`

## RLS Notes

`supabase/walkoff-auth-workspaces.sql`, `supabase/pos-money-ledger.sql`, and `supabase-migrations/*` enable RLS and define membership-based policies for the main store tables. These policies should be tested with `authenticated` role sessions, not owner/service sessions.

No database view audit found exposed inventory/search views in this branch. If views are added later, use `security_invoker` where supported or revoke unsafe exposed-schema access.

## Inventory

`inventory_items` stores `store_id`, `status`, timestamps, and item details in `data jsonb`. Browser writes now include `store_id` filters on built-in item update/sold paths. Built-in item data clamps quantity below zero to zero. Checkout marks sold items and records POS ledger/audit rows when Supabase is available; demo mode blocks live Supabase ledger writes.

Remaining work: full stock reservation/concurrency, database-side non-negative quantity constraints if quantity becomes first-class columns, and automated same-store/cross-store RLS tests.

## Consignments

Consignments are not proven as a complete cloud-safe model in this branch. Treat as beta/local-only unless a store has separately validated consignor identity, inventory linkage, payout terms, status transitions, settlement, audit history, and RLS isolation.

## Wantlists

`customer_wants` exists in POS ledger schema and is store-scoped with RLS policies. The richer wantlist model requested in the release plan is not fully proven here, so tester release copy should call wantlists beta/local-only or limited customer-wants capture.

## Demo/Live Rules

Demo mode uses the `demo` store and browser-local storage. Live mode requires an authenticated Supabase session and active store. If auth/env context is missing, the app should fall back to demo-safe behavior instead of writing live data.
