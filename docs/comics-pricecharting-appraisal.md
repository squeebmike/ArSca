# Comics PriceCharting and Appraisal Workflow

## Data flow

1. The browser normalizes a natural comic query through `scripts/query-routing.js`.
2. The browser calls `GET /pricing/pricecharting/search?q=`. The Worker calls PriceCharting `/api/products` and returns multiple normalized candidates.
3. The operator confirms the exact candidate. Refresh/detail calls `GET /pricing/pricecharting/product/:id`; the Worker calls `/api/product?id=`.
4. The selected result holds a last-known price snapshot, cover source/confidence, and shop appraisal state. Saving maps those additive fields into the flexible inventory record.

The browser never receives a PriceCharting credential. `PRICECHARTING_TOKEN` or `PRICECHARTING_API_KEY` is read only from the Worker environment.

## Comic price mapping

PriceCharting integer pennies are converted to dollars once in Worker normalization.

| PriceCharting field | Comic UI label |
| --- | --- |
| `loose-price` | Raw / Ungraded |
| `cib-price` | Graded 4.0 / 4.5 estimate |
| `new-price` | Graded 6.0 / 6.5 estimate |
| `graded-price` | Graded 8.0 / 8.5 estimate |
| `box-only-price` | Graded 9.2 estimate |
| `condition-17-price` | Graded 9.4 estimate |
| `manual-only-price` | Graded 9.8 estimate |
| `bgs-10-price` | Graded 10.0 estimate |

The grade buckets are not labeled CGC, CBCS, PSA, or another grading company unless the provider identifies one. In particular, comic 9.8 is not PSA 10.

## Search and ranking

Comic aliases include ASM, TMNT, UXM, X-Men, Hulk, FF, Detective, and TEC. The adapter extracts issue/year and edition terms such as newsstand, direct, Mirage, sketch, foil, virgin, ratio, first/second printing, reprint, and facsimile. Exact issue/title and requested edition terms receive ranking boosts. Unrequested facsimiles, reprints, trades, graphic novels, omnibuses, and compendiums receive penalties.

## Covers and photos

Cover priority is user photo, PriceCharting image, existing ComicVine metadata route, then placeholder. External covers begin as `needs-confirmation`; the operator can explicitly confirm or replace one.

User cover photos are stored as blobs in the `walkoff_comics_cache_v1` IndexedDB `images` store. Inventory/localStorage holds only `userPhotoBlobKey`, never the image blob or data URL. Runtime object URLs are recreated from IndexedDB for display. Existing uploaded inventory photos are never overwritten automatically.

Fields record `imageSource`, `coverConfidence`, and `coverConfirmed`. The current metadata-provider fallback is useful for issue-level matching but is not assumed to prove a particular variant cover.

## Inventory mapping

Comic saves add or map: `category`, `series`, `issueNumber`, `issue`, `volume`, `year`, `publisher`, `variant`, `printing`, `newsstandDirect`, `providerProductId`, `providerUrl`, `coverImageUrl`, `userPhotoBlobKey`, `conditionText`, `numericGrade`, `isSlabbed`, `grader`, `certNumber`, `pageQuality`, `defects`, `notes`, `costBasis`, `marketValue`, `listPrice`, `location`, `box`, `lastPriceUpdate`, `priceSource`, `appraisalConfidence`, `appraisalSummary`, and a `comicMetadata` object. Existing generic fields remain intact for older inventory records.

Inventory filters cover comic raw/slabbed, needs-cover-confirmation, no market/photo, high value, listing state, and free-text publisher/series/issue/location/box searches.

## Appraisal logic

This is a shop estimate, not certified grading. Raw condition applies broad factors to the ungraded guide (Poor through Near Mint). Slabbed numeric grades use the nearest available PriceCharting grade bucket and say so. Missing buckets remain unavailable rather than being invented.

Recommended list defaults to the rounded estimated market value and supports a manual override. Suggested buy range defaults to 40%-60%. Confidence is High only after issue and cover confirmation, Medium for an exact issue with unconfirmed cover, otherwise Low. The copied summary includes source/date, raw and 9.8 references, estimated value, list recommendation, buy range, confidence reasons, and grading disclaimer.

## Offline and refresh behavior

Live search/detail requires the Worker. Cached comic results and price snapshots remain visible as last-known data. User photos live in IndexedDB. Refresh by product ID updates price/image snapshots and timestamps but does not alter cost basis or a manual list override. A failed refresh leaves existing values in place.

## Limitations

- PriceCharting and metadata-provider naming may not fully identify every retailer-exclusive or ratio variant.
- ComicVine is metadata/cover assistance only, not the price authority.
- Raw condition factors and buy percentages are configurable shop heuristics, not guarantees.
- No PDF appraisal export is included in this pass.
