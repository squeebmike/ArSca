# Catalog expansion and collector tools

## Prepared changes

- Seven reviewed baseball numeric-base checklists: 2019 Topps Chrome (204), 2023 Topps Series 1 (330), Series 2 (330), Update (329), Bowman (100), Bowman Chrome (100), Topps Chrome (220). Total: 1,613 unique card entries. Bowman prospect subsets are not included in these numeric-base imports.
- Publication policy now starts at 2019. This does not establish complete 2019-onward coverage. The old R2 catalog remains quarantined pending source review.
- 31 printed-team-name pages include historical Cleveland Indians separately from Cleveland Guardians. This is a source-label count, not a claim that MLB has 31 franchises.
- 275 player/printed-team groups have entries in two or more verified sets. Profiles are checklist comparisons, not independently verified person biographies. Trades and shared names require attention to the printed team and exact card.
- Baseball sitemap: 1,928 canonical URLs (1 index + 1 player directory + 275 player groups + 31 teams + 7 sets + 1,613 cards).

## References and prices

MTG and Pokémon set pages show highest reference values from existing catalog fields. MTG ranks nonfoil USD values separately from foil/etched values. Pokémon uses the existing provider's market field. Invalid, missing, nonpositive and duplicate prices are excluded. Partial Pokémon data is explicitly ranked only among loaded cards. Neither ranking creates store Offers or claims current verified transaction values. Price timestamps are not supplied in these views and are labeled as unavailable.

## Collection tools

MTG, Pokémon and baseball set pages offer Have/Need/Want marks saved to `localStorage` on the current device. There is no account sync or database mutation. Tools lazily build their control list when opened. Unmarked cards stay unmarked; exported needs contain only cards explicitly marked Need.

Users can filter the marked selection, print it, export a CSV, back up JSON, restore marks for the current checklist and share the canonical checklist link. Sharing does not disclose collection state. Restore preserves other checklists' existing marks and ignores foreign keys. CSV text that could be interpreted as a spreadsheet formula is prefixed safely. Storage failures are shown honestly.

Pure-state and simulated client tests exercise persistence, scoped restore, filters, safe CSV export and the generated inline script. A real Chrome/mobile pass is still required for layout, print preview, file downloads and native-share behavior. The tools do not replace crawlable server-rendered checklist HTML.

## Pack odds

2023 Series 2 includes four source-checked example rows from page 1 of Topps' official PDF, using only columns 5191 Hobby **pack** and 5192 HTA Jumbo **pack**. The PDF was extracted and visually reviewed. No box-odds column was substituted; category odds are not a named-card probability. Other sets receive no invented odds. Retail and additional categories remain linked in the publisher PDF.

## Source regeneration

`python scripts/topps/import-baseball-expansion.py <source-dir>` generates the four additional sets from exact downloaded publisher PDFs and extracted text. `import-2023-baseball.py` regenerates the original flagship sets and imports the expansion module while preserving old IDs. Both emit LF files. Row counts, numbering and parsed team names are strict; failures stop the import.

The growing catalog should move to reviewed per-set R2 shards before broad 2019-onward imports enlarge the bundle. Do not revive a duplicate Supabase checklist database or bulk-publish incorrectly classified historical rows.

## Validation

`npm run test:baseball-catalog` covers card pages, source policy, printed-team memberships, cross-set player groups and odds scope. `npm run test:catalog-tools` covers reference prices and collection state/client generation. Both are chained into the full suite and the deployment workflow includes the new checks.
