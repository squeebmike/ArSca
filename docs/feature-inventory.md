# Walk-Off Dealer OS Feature Inventory

Version audited: `2026.05.05.6`

This file is the safety map for the progressive UX refactor. Do not remove a feature unless it has a new home and is verified reachable.

## Current Files And Routes

| Surface | File | Current role | New mode/home |
| --- | --- | --- | --- |
| Dashboard / tablet command center | `dashboard.html` | Inventory, register, intake, reports, settings | Tablet OS: Home, Buy, Sell, Inventory, Shows, More |
| Phone scanner / POS checkout | `sca.html` | Scanner, cart, checkout, QR/card payments, scan tools | Phone: Scan, History, Connection. Tablet can still launch checkout while payments are migrated. |
| Cloudflare Worker | `cloudflare-worker-full.js` | API proxy, cart sync, Webflow/eBay/Stripe/PSA/comics/comps/pricing | Backend services for all app modes |

## Dashboard Tabs And New Homes

| Existing route/tab | Existing features | New home |
| --- | --- | --- |
| `overview` | Today stats, category cards, profit meter, top value, recent activity, channels, top sold, monthly profit, alerts | Home |
| `pos` | Legacy register command center | More / Legacy Register |
| `intake` | Quick lookup, phone scanner inbox, buy/trade offer | Buy |
| `inventory` | Filters, table, lifecycle status, cart add, sell, eBay, edit, history, bulk tools | Inventory |
| `channels` | eBay connection, TCG price sync | Listing |
| `sales` | Sold table and sales search | Reports |
| `alerts` | Inventory/business alerts | Home + Reports |
| `wantlist` | Want list, set needs/customer looking for, stock checks, notify | More / Customers, surfaced inside Buy as alerts |
| `consign` | Consignment intake, status, sold/payout/return, report | More / Consignment |
| `locations` | Location manager, location lookup, inventory by location | Inventory + More |
| `restock` | Fast sellers, low stock, category performance, restock checklist | Reports + Inventory |
| `display` | Cart/customer display, payment buttons | Sell |
| `shows` | Show session, cash drawer, closeout/EOD | Shows |
| `backoffice` | Vendor profile/logo/payment handles, modules/categories, spreadsheet bridge, sync queue, customer CRM, data health, backup, ops log, legacy map | More / Settings |

## Dashboard Modals And Drawers

| Modal/tool | Current trigger | New home |
| --- | --- | --- |
| Edit item modal | Inventory row `Edit` | Inventory quick edit drawer/modal |
| Quick sell modal | Inventory row `Sell` | Sell |
| eBay listing modal | Inventory row `eBay` / timeline | Listing |
| Item timeline modal | Inventory row `History` | Inventory details |
| Customer display | `display` tab / cart nav | Sell |

## Scanner Features And New Homes

| Existing feature | Current behavior | New home |
| --- | --- | --- |
| Camera scanner | Front/back image scan, Claude extraction | Phone Scan |
| Manual refine | Edit detected card fields and retry search | Phone Scan manual fallback |
| Photo fallback | Extra photos, retake/upload image | Phone Scan |
| Comic variants | Comic Vine variant picker | Phone Scan review |
| TCG printings | Printing picker, condition/finish controls | Phone Scan review + Buy review |
| Slab/graded tools | PSA lookup, graded research, sold comps chart links | Phone Scan review + Buy review |
| Send to tablet | Scan handoff queue via KV/localStorage | Phone Scan -> Tablet Buy inbox |
| Bulk buy | Bulk offer list and send to tablet | Phone Scan -> Tablet Buy |
| POS cart | Add item/manual item, discounts, cart sync | Sell |
| Checkout | Cash, Venmo, PayPal, Cash App, Stripe card, receipt | Sell |
| Pricing tools | Margin calculator, graded spread, trends, tag generator | Buy + Listing |
| Settings/onboarding | Store profile, payment handles, Stripe key, worker tests | Phone Connection + Settings |
| Inventory import/export | Local JSON/CSV tools | Desktop/Admin |

## Worker Endpoints

| Endpoint | Purpose | Mode |
| --- | --- | --- |
| `/health` | Secret/binding health check | Settings |
| `/cart` | Cross-device cart sync | Sell |
| `/kv/:key` | Generic shared state | All modes |
| `/anthropic/messages` | AI scan/lookup proxy | Scan/Buy |
| `/upload-image` | Webflow asset upload | Inventory/Listing |
| `/pos/checkout` | Checkout sync/record support | Sell |
| `/proxy/...` | Webflow API proxy | Inventory/Listing |
| `/ebay/status`, `/ebay/auth-url`, `/ebay/oauth/callback`, `/ebay/list` | eBay auth/listing | Listing |
| `/stripe/create-payment-intent` | Stripe card payments | Sell |
| `/pricing/tcg` | TCG/Pokemon pricing | Buy/Inventory |
| `/psa/cert/:cert`, `/psa/pop/:id` | PSA cert/pop lookup | Buy/Inventory |
| `/comic/variants`, `/comic/pricing` | Comic lookup/pricing | Buy/Inventory |
| `/comps/sold` | Sold comps/trend source | Buy/Reports |
| `/graded/pricing` | Graded/slab research | Buy/Listing |

## Data Stores And Important Fields

| Storage/key | Purpose | Keep/migrate |
| --- | --- | --- |
| `lba_inventory` | Webflow/local inventory cache | Preserve |
| `walkoff_universal_inventory` | Non-Webflow/spreadsheet/manual inventory | Preserve |
| `pos_cart_v2` | Active cart | Preserve |
| `pos_buy_list` | Buy/trade offer working list | Preserve |
| `pos_transactions` | Sales/checkout log | Preserve and expand |
| `pos_drawer` | Cash drawer state | Preserve |
| `pos_wantlist` | Customer want list | Preserve |
| `set_needs_v1` | Set needs/customer looking-for tracker | Preserve |
| `pos_consign` | Consignment records | Preserve |
| `pos_locations` | Location list | Preserve |
| `sync_queue_v1` / `pos_sync_queue` | Offline/sync work | Preserve |
| `vendor_profile_v1` | Store info, logo, payment handles | Preserve |
| `vendor_config_v1` | Modules and custom categories | Preserve |
| `pos_ops_log` | Audit/ops log | Preserve and expand |

## Progressive Navigation Target

| Target tablet nav | Existing features assigned |
| --- | --- |
| Home | Overview stats, alerts, scanner status, open cart, open buy offer, show status, ready-to-list count |
| Buy | Phone scan inbox, manual lookup, item review card, buy offer cart, offer engine, needs-research |
| Sell | Register, cart, customer display, cash/card/QR/mixed payment, receipt, quick sale buttons |
| Inventory | Inventory table/cards, edit, lifecycle, locations, bulk edit, price sync status |
| Shows | Show mode, cash drawer, show inventory, closeout, reports |
| More | Channels/listing, reports, want list, consignment, locations, restock, settings/admin, legacy full tool map |

## Safety Rules For Next Refactors

- If a panel is moved, keep its original functions and data keys intact.
- If a feature is not redesigned yet, keep it reachable in `More` or `Settings / Admin -> Legacy / Full Tool Map`.
- Any new mode should wrap existing behavior first, then improve it.
- Payment, inventory, checkout, and Webflow/eBay flows require script parse checks before push.
- Version stamp must be bumped on both `dashboard.html` and `sca.html`.
