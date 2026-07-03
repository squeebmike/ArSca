# Settings information architecture

ArSca Settings previously mounted every administrative panel into one long page. The new shell preserves the existing controls, IDs, save functions, and storage while showing one logical section at a time.

## Sections

1. Overview
2. Store Profile
3. Checkout & Payments
4. Data Sync
5. Catalogs & Pricing
6. Inventory & Imports
7. Users & Permissions
8. Devices & Hardware
9. Theme & Branding
10. Subscription & Billing
11. Advanced / Diagnostics

Desktop uses a sticky left navigation rail. At 760px and below it becomes a full-width section selector. Settings search maps common terms such as Stripe, refunds, consignments, Pokémon, MTG, imports, users, cash bag, theme, and debug to the correct section.

## Old panel mapping

| Old panel | New section | Notes |
|---|---|---|
| Vendor Info / Preferences | Store Profile | Primary source for store identity, receipt text, tax/defaults, and payment handles. |
| Payments / Stripe history | Checkout & Payments | Existing tender, QR, Connect, payment-history, and refund UI; logic unchanged. |
| Inventory Sync + Sync Queue | Data Sync | Kept as separate working panels inside one conceptual section. |
| Cloud consignment state | Data Sync | Read-only status summary; existing sync functions and Supabase tables unchanged. |
| Research defaults | Catalogs & Pricing | Research behavior belongs with reference catalogs/providers. |
| Offline Pokémon Center | Catalogs & Pricing | Existing local cache controls. |
| PokémonPriceTracker export | Catalogs & Pricing | Existing export UI surfaced; the planned PPT offline pipeline was not built. |
| Offline Catalog Download Manager | Catalogs & Pricing | Reference data only; never inventory. |
| PriceCharting Data | Catalogs & Pricing | Optional scheduled provider cache, separate from inventory. |
| Inventory Import Manager | Inventory & Imports | Quick add, CSV import/export, templates, and recent imports. |
| Store Members / Invites | Users & Permissions | Existing auth/RLS behavior unchanged. |
| Branding & Theme | Theme & Branding | Existing preview/save/reset behavior unchanged. |
| Subscription | Subscription & Billing | ArSca software subscription, separate from customer Stripe payments. |
| Module config, system/backup, operations, QA, data mode, customers, data health, walkthrough, legacy map | Advanced / Diagnostics | Preserved as the safety net for technical/admin tools. |

## Data concepts

- **Store Data Sync** keeps inventory, sales, settings, users, queues, and consignments consistent between devices and cloud.
- **Offline Catalog Sync** downloads reference catalogs for Research. It does not create owned inventory.
- **Live Provider Pricing** obtains current prices and candidate matches from external providers.

MTG offline remains the protected working pipeline using Scryfall cards and the PriceCharting snapshot. Its IndexedDB structures, R2 sync, and image cache were not changed.

Pokémon live provider/cache controls remain available. PokémonPriceTracker offline sync is labeled planned-next; this pass does not build it. Comics and sports remain online-only, and comic provider images remain URL-only.

## Advanced philosophy

Normal setup and store operation should not expose raw IDs, RLS checks, QA tools, cache resets, or legacy navigation. Those remain accessible under Advanced / Diagnostics with a warning. Existing confirmation prompts remain responsible for dangerous actions.

## Mobile behavior

At phone width, the rail is replaced with a selector, cards stack to one column, known multi-column form grids collapse, buttons wrap, and only the selected section is rendered visibly. Moving between sections does not rebuild controls, so unsaved values remain in their original DOM nodes.

## QA checklist

- Settings opens to Overview on first use.
- Desktop rail, mobile selector, search results, and Manage buttons select one section.
- Existing panel IDs and save handlers remain present.
- Store profile, payments/Stripe/refunds, inventory sync/queue, catalogs, imports, members, theme, subscription, QA, and legacy tools remain reachable.
- Checkout, Stripe, refunds, QR payments, cloud consignments, auth/RLS, MTG, Pokémon, comics, sports, Topps, inventory math, and provider secrets are not modified.

