# The Mana Pocket — Audit and Build Plan

Companion to the build spec. Documents what already exists (do not replace), what is missing, and the
phased plan for closing the gap. Update this file as increments land.

## 1. What already exists (preserve, extend)

### Supabase (project `vroknjrxubsqyexngwus`, config in `app-config.js`)
- Multi-tenant workspace model: `stores`, `store_members` (role enum owner/admin/manager/employee/scanner_only),
  `profiles`, `store_invites`, `store_settings` (`payment_settings`/`modules`/`theme`/`receipt_settings` JSONB),
  all RLS-protected via `is_store_member` / `current_store_role` / `can_manage_store` helper functions
  (`supabase/walkoff-auth-workspaces.sql`).
- **`inventory_items`**: the single source of truth for sellable stock. Flexible `data jsonb` blob + `status`.
  Already supports one-copy items and multi-quantity items via `qty`/`quantity` fields. This is what the
  Mana Pocket storefront must read from — no new inventory table needed.
- POS money ledger: `pos_sales`, `pos_sale_lines`, `pos_payments`, `pos_drawer_sessions/movements`,
  `pos_audit_log`, `customer_receipts`, `customer_wants` (`supabase/pos-money-ledger.sql`,
  `supabase-migrations/2026-07-14-atomic-pos-sale.sql`). `complete_pos_sale(jsonb)` RPC commits a sale,
  payments, drawer movements, and inventory decrement atomically and idempotently — this is the pattern the
  new online-order finalize RPC mirrors.
- Stripe Connect (direct charges) + consignment + refunds: `store_stripe_accounts`, `pos_refunds`,
  `inventory_movements`, `stripe_webhook_events`, `consignor_people`, `consignment_items`,
  `consignment_alerts` (`supabase/stripe-connect-and-consignments.sql`, see
  `docs/stripe-connect-payments-foundation.md`). Fee-payer verification, idempotency keys, webhook signature
  verification, and restock-on-refund are already solved problems — reused, not rebuilt, for online checkout.
- `platform_admins` / `platform_admin_audit_log` for cross-store support access.
- Everything uses RLS; staff access is role-based, never a client-side check.

### Cloudflare Worker (`cloudflare-worker-full.js`, deployed as `still-resonance-4f87`)
- `handleStripeWebhookSecure` verifies signatures, is idempotent via `stripe_webhook_events`, and updates
  `pos_payments`/`pos_sales`. The new online-order webhook path extends this instead of adding a parallel one.
- `stripeApi`/`stripeConfig`/`stripeApplicationFee` already select test/live mode and enforce the
  `fees.payer = account` requirement before allowing a live charge.
- `GET /public/storefront` is the only customer-facing catalog endpoint today. It is opt-in
  (`store_settings.receipt_settings.storefrontEnabled`), filters to sellable/non-archived items, strips
  private fields (cost, profit, consignor, notes — locked in by `tests/public-storefront.test.mjs`), and can
  optionally blend in a **legacy** Webflow product collection (`WF_PRODUCTS`, site `65b15ee0228d06647ca7e4ce`)
  when `modules.inventorySource` is `webflow`/`hybrid`. That legacy site is not The Mana Pocket site and is
  not part of this build — Mana Pocket must run `inventorySource: 'built_in'`.
- What it does **not** yet do: category-specific filters, search, pagination, a product-detail route, cart
  reservation, or any checkout/payment path reachable from a public customer. It is read-only and
  inquiry-only (`mailto:` in `storefront.html`).

### `storefront.html`
- The "working approach" referenced by the spec: a static page that calls `/public/storefront?store_id=`,
  renders a filterable grid, and lets a shopper email the store about an item. It does **not** use the theme
  CSS variables and has no cart/checkout. This is the pattern the new storefront app extends — same hosting
  model (flat static file, same Worker), far more capability.

### Theme picker (`dashboard.html`)
- `DEFAULT_STORE_THEME` + `STORE_THEME_PRESETS` (Walk-Off Dark, Clean Light, High Contrast, Seahawks, Card
  Shop Neon) define CSS custom properties (`--primary`, `--bg`, `--surface`, `--text`, `--success`,
  `--warning`, `--danger`, `--info`, `--border`, `--button-text`, font/radius tokens). `applyStoreTheme()`
  sets them on `documentElement`, persists to `localStorage` and to `store_settings.theme` in Supabase. The
  backoffice "Theme & Branding" panel lets an owner edit/preview/save it live.
- Today this system only styles the merchant's own dashboard/POS screens. **No customer-facing page consumes
  it yet.** The new storefront app is the first customer-facing consumer, fetching `theme` from the same
  `/public/storefront` payload (already returned) and applying the identical CSS-variable contract.

### Dashboard (`dashboard.html`, `sca.html`) — see `docs/feature-inventory.md`
- Full tablet/phone POS: inventory, buy/intake, register/checkout (cash/Venmo/PayPal/CashApp/Stripe card),
  consignment payout tracking, locations, shows/drawer sessions, backoffice settings (vendor profile,
  modules/categories, Stripe onboarding, theme, sync/backup, ops log). No comics/pull-list, breaks, rewards,
  live-control, or appointment-intake UI exists yet — these are net-new dashboard panels, not replacements.

### Webflow
- Legacy site `65b15ee0228d06647ca7e4ce` ("Walk-Off") is wired into the Worker only as an optional inventory
  source for old stores — not touched by this build.
- **The Mana Pocket site** (`6a61485785c1d0fc905d1ce9`) is fresh: one default "Home" page, zero CMS
  collections, no custom code. Per spec, no Webflow CMS collections are created for inventory/breaks/comics —
  those stay in Supabase. Webflow is the marketing shell + nav + embed host for the Supabase-driven app.

### Auth
- Supabase Auth exists today only for **staff** (`profiles` + `store_members`). There is no customer-facing
  identity model, no email-OTP/Google customer login, and no customer-owned RLS rows. This is net-new.

## 2. Gap map (spec section → status)

| Spec area | Status |
| --- | --- |
| §2 Supabase inventory, no Webflow product CMS | Inventory source exists; storefront read API too thin — extending |
| §2 Theme picker reuse | Exists for merchant UI only; extending to customer app |
| §9 Homepage, §26 pages | Not built; Webflow site is blank |
| §10-11 Catalog/PDP behavior | Partial (`/public/storefront` is flat, no filters/search/pagination/PDP) — building |
| §12 Inventory integrity & checkout | POS side solved (`complete_pos_sale`); online reservation/checkout is net-new |
| §13 Auth / My Pocket | Net-new (customer identity, RLS, account screens) |
| §14 Pocket Points | Net-new (ledger + configurable settings) |
| §15 Comics/pull lists | Net-new |
| §16 Breaks | Net-new |
| §17 Pocket Live | Net-new (settings blob + `/live` experience) |
| §18 Sell/Trade/Consign appointments | Net-new intake; converts into **existing** consignment tables |
| §19 Search | Net-new (extends `/public/storefront` query surface) |
| §20 Dashboard additions | Net-new panels, additive to existing backoffice |

## 3. Phased plan

**Phase 1 (this pass, in small increments):**
1. Migration `supabase-migrations/2026-07-22-mana-pocket-storefront.sql` — customers, addresses, online
   orders/lines, reservations, rewards + store-credit ledgers, breaks/spots, comic series/issues, pull-list
   subscriptions/allocations, appointment requests, wishlist, alerts. RLS on every table. Atomic
   reserve/finalize RPCs mirroring `complete_pos_sale`.
2. Worker: `/public/catalog`, `/public/product/:id`, `/public/breaks`, `/public/comics`, `/public/live`,
   `/public/checkout/create`, extended Stripe webhook to finalize online orders. Server-side price/availability
   verification only; never trust the browser.
3. New customer storefront app consuming the theme payload and new endpoints: category browsing, search,
   PDP, cart, checkout, minimal My Pocket (orders + points), mobile-first, 1990s comic-shop CSS language,
   original artwork only.
4. Dashboard: Live control, Pocket Points settings, and storefront feature-flag panels (additive).
5. Webflow: nav structure, homepage section scaffold, embed/link to the storefront app for the dynamic parts.
6. Tests extending the existing `tests/*.test.mjs` contracts.

**Phase 2 (explicitly deferred, tracked but not blocking launch):** full pull-list distributor automation,
shared POS/website pickup workflow, finished customer consignment portal UI, physical-store address/hours,
expanded staff permission granularity, full illustrated 90s Designer build-out across all 28 pages.

Nothing in Phase 1 removes or rewrites a working table, endpoint, or dashboard panel; every addition is a new
table, a new route, or an additive column/panel.

## 4. Phase 1 implementation notes (this pass)

- **Migration**: `supabase-migrations/2026-07-22-mana-pocket-storefront.sql` — customers/addresses, online
  orders/lines, inventory reservations, Pocket Points + store-credit ledgers, breaks/spots, comic
  series/issues, pull-list subscriptions/allocations, appointment requests, wishlist/alerts, RLS throughout,
  and atomic `create_online_order_with_reservations` / `finalize_online_order_payment` RPCs mirroring
  `complete_pos_sale`. Apply after the existing base migrations. Not yet run against production Supabase —
  run it before the storefront can accept a real order.
- **Worker**: `cloudflare-worker-full.js` gained `/public/catalog`, `/public/product/:id`, `/public/breaks`,
  `/public/comics`, `/public/live`, `/public/checkout/create`, and `/appointments/request`, plus webhook
  handling that finalizes online orders via the new RPC. All server-verified; nothing trusts browser price or
  quantity. The original `/public/storefront` endpoint is untouched.
- **Storefront app**: `the-mana-pocket.html` — a single-file, theme-aware (reads `--brand-*` CSS vars from
  the same contract as `dashboard.html`'s theme picker), mobile-first shop with catalog filters/search,
  product detail, cart, Stripe Checkout handoff, breaks, comics, live status, sell/trade/consign form, and a
  My Pocket account screen (Supabase Auth email OTP + Google). Hosted the same way as `storefront.html`
  (flat file at the repo root, served by GitHub Pages). Needs a real store id before it will show data — see
  below.
- **Dashboard**: new "The Mana Pocket" settings section (`dashboard.html`) with Pocket Live control, Pocket
  Points rate/redemption settings, and storefront feature flags (pickup availability). Stored in
  `store_settings.modules` alongside the existing `webflowIntegration` key, using the same get/save pattern.
- **Webflow**: the fresh "The Mana Pocket" site (`6a61485785c1d0fc905d1ce9`) now has a real Home page plus
  Shop, Sports, TCG, Comics, Collectibles, Breaks, Pocket Live, Sell/Trade/Consign, Rewards, Visit, My
  Pocket, and Cart pages with native headings/copy and a primary nav, published live.
  **Limitation hit and worked around**: this site's plan rejects (HTTP 406) both site/page custom-code
  writes and HTML Embed element code — so the originally planned live iframe embed of the storefront app
  into each Webflow page could not be written. Each page instead carries a real CTA button that links out to
  the matching `the-mana-pocket.html?view=...` page. If the Webflow plan is upgraded to one that allows
  custom code, revisit this to embed the app in-page instead of linking out — the exact iframe/script markup
  attempted is preserved in git history on this task for reuse.

## 5. Before this goes live — remaining setup (not code)

1. In the dashboard, sign in as the owner and create the store for The Mana Pocket
   (`create_store_for_current_user`), then turn on **Settings → Store Profile → Public Inventory
   Storefront**.
2. Apply `supabase-migrations/2026-07-22-mana-pocket-storefront.sql` to the production Supabase project.
3. Put the new store's UUID into `the-mana-pocket.html`'s `?store=` usage — the simplest path is publishing
   the app with the id baked into a `window.MANA_POCKET_STORE_ID` snippet, or always linking to it with
   `?store=<id>` appended (the Webflow CTA buttons built in this pass do not yet append it, since the id
   doesn't exist yet — update those 12 button URLs once it does).
4. Complete Stripe Connect onboarding for the store (Settings → Checkout & Payments) so
   `/public/checkout/create` has a connected account to charge against.
5. Configure Pocket Live / Pocket Points / storefront flags in the new "The Mana Pocket" settings section.
