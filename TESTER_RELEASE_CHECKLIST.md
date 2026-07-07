# ArSca Tester Beta Checklist

Branch: `main`

Release label: tester beta, not production-ready multi-store.

## Start Locally

1. Open this repo checkout.
2. Run `npm install` if dependencies are missing.
3. Run `npm test`.
4. For browser smoke tests, run `npm run test:smoke:manual` after Playwright is available on PATH or invoke it through `npx playwright test --config=tests/playwright.config.js`.

## Tester Data

Use `supabase/seed.sql` only in a local Supabase database or disposable test project. Do not run it against live store data. Demo mode keeps browser data local and must not write to live Supabase.

## Core Pages To Test

- `dashboard.html`: login/demo entry, Research, Inventory, Buy, Sell/cart, Settings.
- `sca.html`: scanner and scanner handoff.
- `index.html` / `storefront.html`: public/storefront smoke only.

## Core Flows

- Enter Local Demo mode and confirm the orange demo banner is visible.
- Research searches: `charizard 4/102`, `sol ring`, `fire // ice`, `psa 10 charmander`, `booster bundle 151`, `Amazing Spider-Man 300`.
- Inventory add/edit/archive/restore from the dashboard.
- Add an inventory item to cart, lock checkout, confirm payment once, then try a rapid second confirmation.
- Scanner manual search and handoff to dashboard Research Queue.
- Mobile smoke at 390px: dashboard nav, Research panel, Inventory list, Sell/cart controls.

## Demo Vs Live

- Demo mode is local/browser storage only and should not write to live Supabase.
- Live mode uses the public Supabase anon key, authenticated sessions, store membership, `store_id`, and RLS policies.
- Service-role credentials are not expected in browser-delivered code.

## Do Not Test As Production-Ready Yet

- Broad multi-store production claims.
- Full consignment payout workflow.
- Cloud-persistent wantlist workflow beyond the current customer wants capture.
- Deck Lab expansion or external deck import/browsing.

## Bug Reports

Include the query or item, current mode (Demo or Live), browser/device width, expected result, actual result, and console/network errors if available.
