# Topps offline R2 migration

The Topps checklist is reference data, not store-owned inventory. Its master bundle now belongs in Cloudflare R2 and each selected device imports the active version into IndexedDB.

## Layout

- `topps/manifest.json` is the small active-version pointer and is uploaded last.
- `topps/<version>/sets.jsonl.gz` contains the set browser records.
- `topps/<version>/cards.jsonl.gz` contains compact checklist card records.
- The Worker exposes only the manifest and those two manifest-approved objects.
- Device import writes a complete new version, activates it only after both files succeed, then removes the prior version.

## Release order

1. Run **Publish Topps offline catalog to beta** manually.
2. Deploy the `beta` branch and open the beta Worker URL.
3. In Offline Data, select **Topps Sports**, then choose **Update selected**.
4. Confirm 740 sets and 426,540 cards, disconnect the network, and verify player, card number, year, set, team, and rookie/autograph/relic searches.
5. Publish the same immutable bundle to production R2 and deploy the UI/Worker from the normal release process.
6. Observe production device adoption before running the retirement SQL.

Pokémon is intentionally outside this pipeline. It remains on PokémonPriceTracker and will use the PPT business export when enabled.

## Safety gate

Do not run the Supabase retirement migration until the production R2 manifest is reachable, at least one production device has imported and searched it offline, and a database backup exists. The migration refuses to run unless its explicit guard setting is enabled for that SQL session.
