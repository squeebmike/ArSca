# Sports checklist photo discovery — October 24, 2026

## Changes

- Baseball and football checklist Browse searches include auctions and Buy It Now offers in one request. Other article, dashboard, selling and inventory flows keep their existing filters.
- Auction-only results use `currentBidPrice` (or the offered starting price when that field is absent), with its currency. Cards label this as an auction bid, not a Buy It Now asking price. Listings offering both formats retain the Buy It Now price.
- Numeric checklist numbers without a `#` are accepted only as separate title tokens, after removing serial fractions and slab grades. The release, player, section, finish and serial checks still apply.
- Selected-parallel results are validated against the selected parallel, rather than its base record.
- If no exact card matches the first search, one fallback removes redundant base-section wording and the serial search token. The exact finish and serial validator remains unchanged. Specific standalone subset wording is retained.
- Cache version 12, 15-minute results, one optional fallback, the existing shared cache/backoff and two concurrent visible browser lookups. No added inventory/database queries. EPN campaign attribution is retained.

## Alternative source pilot

OCDB's documentation advertises public card/image tables and image-level source/license fields. Its documented API hostname `xoheywavlyadnczmdzaf.supabase.co` returned DNS `ENOTFOUND` during the read-only probe. No card/image records could be checked. It was not added as a production dependency, and no coverage or reuse rights are claimed.

## Validation

Regression tests cover auction-only and dual-format prices, both catalog search adapters, a valid bare checklist number, serial/grade false positives, rejection of Gold Foil for Gold, a maximum of two searches, and cache reuse. Existing numbered-card tests retain exact release/finish and print-run guards.

The standard `npm test` command exceeds Windows' command-line length because `test:all` is a long chain. The same commands can be executed individually with the repository's dashboard-source preload; CI uses Linux and runs `npm test` normally.

The migration-grant test also compared Windows backslash paths against a forward-slash grandfather list, falsely reporting old migrations. Its file paths now use forward slashes on both platforms; no migrations or grants were changed.

The expanded Windows run subsequently stopped at an existing `/dev/null` path in the Whatnot sticker test. Full-suite confirmation therefore relies on the normal Linux CI run. Targeted shopping/numbered-card tests and Worker syntax checks pass locally.

Before deployment, six real public lookups returned HTTP 200: four had matching eBay images and two had none. The sample is not a catalog-wide coverage estimate. Live comparison results are saved in the task outputs.
