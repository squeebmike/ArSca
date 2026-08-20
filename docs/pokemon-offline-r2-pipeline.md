# Pokemon Offline R2 Pipeline

## Architecture

This pipeline covers what the existing `/pricing/pokemon/export` bulk CSV route (Cards/Sealed/eBay-Graded/Population, already wired into the dashboard) does **not**: real set metadata (name, series, release date, set logo) and actual card image bytes, so the app is fully usable offline with no dependency on TCGPlayer's CDN or per-device PPT credits.

R2 is the shared shelf (same `arsca-offline-catalogs` bucket the MTG/Topps pipelines already use, under a `pokemon/` prefix), IndexedDB is each device's offline database, and card images are content-addressed by TCGPlayer ID so they're stored once no matter how many sets or devices reference them.

Data flow:

1. **Sets** (`.github/workflows/pokemon-offline-sets-daily.yml`, scheduled daily): `scripts/pokemon/build-pokemon-offline-bundle.mjs` pulls every set from PokemonPriceTracker's `/sets` endpoint, writes `sets.jsonl.gz`, uploads it plus `pokemon/manifest.json` (manifest last).
2. **Images** (`.github/workflows/pokemon-offline-images.yml`, manual `workflow_dispatch` only): the same build script, run with `--images=all` or `--images=set:<tcgPlayerNumericId>`, pulls that scope's cards from PPT's `/cards` endpoint (1 credit/card, no history/eBay flags), downloads the actual 200px + 400px JPEGs, and uploads them to R2 at `pokemon/images/{tcgPlayerId}/{size}.jpg`. Coverage is tracked additively in the manifest (`images.setsCovered`) and in per-scope index files, so running one set at a time eventually reaches full "all sets" coverage without re-downloading what's already there.
3. The Worker exposes the manifest, the sets file, an image-coverage index per scope, and the image bytes themselves -- never an arbitrary R2 key.
4. The dashboard's `scripts/pokemon/offline-browser.js` verifies the sets file's hash, decompresses it, and imports it into IndexedDB. For images, it reads the coverage index for whatever scope the user picks (a specific set, or "All Sets") and only downloads images it doesn't already have.

Images are deliberately **not** part of the daily scheduled job -- harvesting thousands of card images is a slow, deliberate operation you kick off from the GitHub Actions tab when you want it, not something that should silently run (and burn PPT credits) every night. The sets job is cheap and safe to run nightly since set metadata rarely changes.

## R2 Layout

```text
pokemon/manifest.json
pokemon/<version>/sets.jsonl.gz
pokemon/images/{tcgPlayerId}/200.jpg
pokemon/images/{tcgPlayerId}/400.jpg
pokemon/images/index-set-{tcgPlayerNumericId}.json
pokemon/images/index-all.json
```

The Worker binding is `MTG_CATALOG_R2` (shared with MTG/Topps); the bucket is `arsca-offline-catalogs`.

## Worker Routes

- `GET /catalog/pokemon/manifest`
- `GET /catalog/pokemon/download?file=sets`
- `GET /catalog/pokemon/images/manifest?set=<tcgPlayerNumericId|all>` -- list of card IDs with cached images for that scope
- `GET /catalog/pokemon/image?id=<tcgPlayerId>&size=200|400` -- the actual JPEG bytes

## IndexedDB

Database: `arscaPokemonOfflineImages` (separate from the existing `walkoff_catalog_v1` DB that holds the PPT bulk price/sealed/ebay/population exports).

- `sets`: keyed by `tcgPlayerNumericId` -- real set name, series, release date, logo URLs
- `images`: keyed by `[tcgPlayerId, size]` -- actual image `Blob`s
- `meta`: sync state per scope

## Run Manually

Build a small local fixture bundle (sets only, no network/credits):

```powershell
npm.cmd run pokemon:build:sample
```

Build and publish the real sets bundle:

```powershell
$env:POKEMONPRICE_API_KEY='...'
npm.cmd run pokemon:build -- --version=YYYY-MM-DD --upload
```

Harvest and publish images for one set or every set:

```powershell
npm.cmd run pokemon:build -- --version=YYYY-MM-DD --images=set:1407 --upload
npm.cmd run pokemon:build -- --version=YYYY-MM-DD --images=all --upload
```

`tcgPlayerNumericId` for a set comes from the sets bundle (also shown as the value in the dashboard's "IMAGE SCOPE" dropdown once sets are downloaded).

## GitHub Actions Secrets

Both workflows require:

- `CLOUDFLARE_API_TOKEN`: R2 object write access (already configured)
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID (already configured)
- `POKEMONPRICE_API_KEY`: **new secret** -- same PokemonPriceTracker key already set as a Worker secret (`POKEMONPRICE_API_KEY` / `POKEMON_PRICE_TRACKER_API_KEY`). This must be added under repo Settings > Secrets and variables > Actions before either workflow can run; a Worker secret and a GitHub Actions secret are separate stores even when the value is identical.

Requires a PokemonPriceTracker **Business plan** key -- the image harvest and `/sets` pagination both call PPT's live endpoints directly.

## Deploy And Test

```powershell
npm.cmd test
npm.cmd run pokemon:build:sample
npx.cmd --yes wrangler@latest deploy --config wrangler.deploy.jsonc --dry-run
```

In the dashboard, open Offline Catalogs, find "Pokemon Sets & Card Images", click **DOWNLOAD / REFRESH** under Sets, pick a scope in the dropdown, and click **SYNC IMAGES FOR SCOPE**. If nothing has been built server-side yet for that scope, the sync reports that plainly instead of silently doing nothing -- run the "Build Pokemon Offline Card Images" GitHub Action for that scope first.

## Known Limitations

- Image harvesting is manual (`workflow_dispatch`), not scheduled -- run it once per new set as sets release, or trigger an "all" run periodically.
- Set logo images (from `/sets`) are referenced by URL only, not harvested into R2 -- only card images get the full offline treatment in this pass.
- The `all` and per-set coverage indexes are merged additively across runs but are rebuilt from whatever the previous manifest reported; a manual R2 object deletion outside this pipeline would desync them from reality until the next upload run for that scope.
