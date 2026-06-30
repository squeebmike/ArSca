# MTG Offline R2 Pipeline

## Architecture

R2 is the central daily bundle shelf, IndexedDB is each device's offline database, and image blobs are separate and deduplicated by Scryfall ID, size, face index, and URL hash.

The data flow is:

1. A daily GitHub Actions job downloads Scryfall `default_cards` and the private PriceCharting MTG CSV.
2. `scripts/mtg/build-mtg-offline-bundle.mjs` streams and normalizes both sources.
3. The builder writes compressed cards, prices, links, and sets files plus a build report.
4. Versioned files are uploaded to Cloudflare R2. `mtg/manifest.json` is uploaded last.
5. The Worker exposes the manifest and whitelisted files without exposing PriceCharting credentials or arbitrary R2 keys.
6. The dashboard verifies the compressed file hash, decompresses JSONL in Chrome, and imports versioned rows into IndexedDB.
7. The active catalog pointer changes only after every required file imports successfully.

Scryfall owns card identity, set metadata, rules text, legalities, and image URLs. PriceCharting owns the daily price snapshot and product IDs. Offline prices are never labeled live.

## R2 Layout

```text
mtg/manifest.json
mtg/YYYY-MM-DD/cards.jsonl.gz
mtg/YYYY-MM-DD/prices-pricecharting.jsonl.gz
mtg/YYYY-MM-DD/links-scryfall-pricecharting.jsonl.gz
mtg/YYYY-MM-DD/sets.jsonl.gz
mtg/YYYY-MM-DD/build-report.json
```

The Worker binding is `MTG_CATALOG_R2`; the configured bucket is `arsca-offline-catalogs`.

## Worker Routes

- `GET /catalog/mtg/manifest`
- `GET /catalog/mtg/download?file=cards`
- `GET /catalog/mtg/download?file=prices`
- `GET /catalog/mtg/download?file=links`
- `GET /catalog/mtg/download?file=sets`

Downloads are selected from the ready manifest. The route rejects unknown file types and never accepts an arbitrary R2 object path.

## IndexedDB

Database: `arscaOfflineCatalog`

- `mtg_cards`: versioned by `catalogVersion + scryfallId`
- `mtg_sets`: versioned by `catalogVersion + setCode`
- `mtg_prices`: versioned by `catalogVersion + pricechartingId`
- `mtg_price_links`: versioned by `catalogVersion + scryfallId`
- `mtg_meta`: active/import state and manifest hash
- `mtg_images`: separately stored image blobs

Imports write the new version beside the active version. A failed download, checksum, parse, or import removes only the failed target version. The previous active catalog remains usable.

## Search And Prices

The default mode is **Offline first, online backup**. The other modes are **Online only** and **Offline only**.

Offline search covers card name, set code/name, collector number, artist, rarity, type line, oracle text, keywords, colors, and mana cost. The UI joins `mtg_cards -> mtg_price_links -> mtg_prices`. Unmatched cards remain visible with `No PriceCharting match yet`.

PriceCharting values are converted from pennies to dollars once during bundle creation. UI labels are Ungraded, Grade 7, Grade 8, Grade 9, Grade 9.5, PSA 10, BGS 10, CGC 10, and SGC 10.

## Image Cache

Card records contain image URLs only. Viewed images may be stored as blobs under:

```text
mtg-image:{scryfallId}:{faceIndex}:{size}:{urlHash}
```

The cache skips an unchanged key and replaces an older URL for the same card face and size. It never stores blobs in localStorage, preloads the whole catalog, or overwrites inventory photos.

## Run Manually

Build a small checked-in fixture bundle:

```powershell
npm.cmd run mtg:build:sample
```

Build the production bundle:

```powershell
$env:PRICECHARTING_MTG_CSV_URL='https://private-download-url'
npm.cmd run mtg:build -- --version=YYYY-MM-DD
```

Build and upload versioned files plus the manifest:

```powershell
npm.cmd run mtg:build -- --version=YYYY-MM-DD --upload
```

The upload command requires Wrangler authentication and access to the configured R2 bucket. Raw and generated bulk files under `data/mtg/` are gitignored.

## GitHub Actions Secrets

The daily workflow requires:

- `CLOUDFLARE_API_TOKEN`: R2 object write access
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID
- `PRICECHARTING_MTG_CSV_URL`: private MTG CSV download URL

The workflow runs once daily, validates gzip files, uploads versioned objects and the build report, then publishes the manifest last. It does not echo secret values.

## Deploy And Test

```powershell
npm.cmd test
npm.cmd run mtg:build:sample
npx.cmd --yes wrangler@latest deploy --config wrangler.deploy.jsonc --dry-run
npx.cmd --yes wrangler@latest deploy --config wrangler.deploy.jsonc --keep-vars
```

In the dashboard, open Offline Catalog Download Manager, choose a search mode, and select **Refresh MTG Offline Data**. Verify a second refresh reports the current version without downloading again. In Chrome DevTools, switch Network to Offline and test name, oracle text, artist, set, and collector-number searches.

## Known Limitations

- First device import is large and requires enough browser storage and a Chrome version with `DecompressionStream`.
- Price links below confidence 75 are omitted; unmatched is safer than wrong.
- PriceCharting snapshots are daily, not live market quotes.
- Only viewed MTG images are cached in this pass.
- Subscriber redistribution and bring-your-own-token behavior are intentionally deferred.
