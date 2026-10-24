# Sports parallel coverage — October 24, 2026

The remaining 33 releases now have release-specific finish programs, bringing release coverage from 29/62 to 62/62. Every imported ordinary base card in these 62 releases resolves to a nonempty program. This does **not** mean every subset/finish has verified metadata or every finish has a live photo.

Across all 62 releases: **40,023 card references** have a finish program or a documented fixed/maximum run, with **459,221 finish links**. **8,835 finish links** explicitly display “Numbering not confirmed.” Counts are reference links, not physical stock or unique sale listings.

## Added release coverage

| Release | Imported base cards | Configured subset programs | Card references with programs | Finish links | Distinct finish names with unconfirmed runs |
|---|---:|---:|---:|---:|---:|
| 2019 Topps Chrome Baseball | 204 | 4 | 279 | 3,624 | 0 |
| 2025 Topps Update Series Baseball | 350 | 2 | 385 | 14,560 | 7 |
| 2026 Topps Series 2 Baseball | 350 | 3 | 642 | 14,644 | 1 |
| 2026 Topps Update Series Baseball | 350 | 10 | 550 | 12,600 | 0 |
| 2026 Bowman Baseball | 100 | 19 | 956 | 16,156 | 0 |
| 2026 Bowman Chrome Baseball | 100 | 11 | 616 | 8,883 | 0 |
| 2026 Topps Holiday Baseball | 200 | 4 | 470 | 9,070 | 0 |
| 2019 Topps Series 1 Baseball | 350 | 3 | 485 | 4,255 | 0 |
| 2019 Topps Series 2 Baseball | 350 | 6 | 555 | 4,465 | 0 |
| 2022 Topps Chrome Platinum Anniversary Baseball | 500 | 1 | 630 | 17,930 | 0 |
| 2022 Topps Chrome Update Series Baseball | 200 | 0 | 200 | 2,200 | 0 |
| 2024 Topps Chrome Baseball | 300 | 10 | 534 | 7,978 | 0 |
| 2022 Topps Chrome Sonic Baseball | 220 | 3 | 280 | 3,155 | 0 |
| 2023 Topps Finest Baseball | 100 | 10 | 346 | 3,135 | 0 |
| 2023 Topps Pristine Baseball | 300 | 2 | 381 | 4,626 | 0 |
| 2023 Bowman's Best Baseball | 70 | 17 | 442 | 3,045 | 0 |
| 2023 Bowman Sterling Baseball | 100 | 7 | 250 | 2,325 | 0 |
| 2025 Topps Holiday Baseball | 200 | 8 | 687 | 7,261 | 3 |
| 2026 Topps Heritage Baseball | 400 | 5 | 795 | 4,755 | 0 |
| 2024 Topps Archives Baseball | 300 | 0 | 300 | 2,700 | 4 |
| 2025 Topps Heritage Baseball | 500 | 11 | 1,106 | 7,082 | 0 |
| 2022 Topps Gallery Baseball | 200 | 8 | 465 | 3,460 | 0 |
| 2024 Topps Stadium Club Baseball | 300 | 8 | 745 | 6,490 | 8 |
| 2022 Topps Cosmic Chrome | 200 | 5 | 318 | 2,027 | 0 |
| 2022 Topps Stadium Club Chrome | 400 | 9 | 643 | 4,252 | 0 |
| 2021 Bowman Draft Baseball | 200 | 6 | 544 | 6,528 | 0 |
| 2026 Topps Chrome Baseball | 300 | 5 | 368 | 16,250 | 0 |
| 2020 Topps Baseball Series 1 | 350 | 4 | 605 | 5,125 | 0 |
| 2025 Topps Chrome Black Football | 150 | 10 | 458 | 3,853 | 11 |
| 2026 Topps Flagship Football | 300 | 16 | 1,295 | 14,850 | 0 |
| 2025 Topps Finest Football | 300 | 13 | 658 | 9,547 | 0 |
| 2026 Topps Heritage Football | 400 | 19 | 803 | 4,129 | 0 |
| 2026 Topps Holiday Football | 200 | 6 | 515 | 7,035 | 7 |

## Numbering still unconfirmed

These options remain visible with an explicit uncertainty label. They are never labeled unnumbered or assigned another release’s run. Subset runs may differ even when a base finish has the same name.

- **2025 Topps Update Series Baseball:** Canvas; Memorial Day Camo; Wood; Gold Diamante Foil; Orange Diamante Foil; Black Diamante Foil; Red Diamante Foil.
- **2026 Topps Series 2 Baseball:** Canadian Independence Day.
- **2025 Topps Holiday Baseball:** Refractor; Glitter Holiday; Red Glitter Holiday.
- **2024 Topps Archives Baseball:** Blue Foilboard; Orange Hot Foilboard; FoilFractor; Printing Plates.
- **2024 Topps Stadium Club Baseball:** Gold Rainbow Foil; Green Refractor; Orange Refractor; Purple Refractor; Pearl White Refractor; Red; Black; Green.
- **2025 Topps Chrome Black Football:** Refractor; Blue Refractor; Green Refractor; Purple Refractor; Purple Mini Diamond Refractor; Gold Refractor; Gold Mini Diamond Refractor; Orange Refractor; Rose Gold Wave; White Refractor; Red Refractor.
- **2026 Topps Holiday Football:** Stocking Stuffer Metallic Gingerbread Man; Stocking Stuffer Metallic Candy Cane; Stocking Stuffer Metallic Stocking; Stocking Stuffer Metallic Santa Bag; 25th; Red Metallic Holiday; Green Glitter Holiday.

## Sources and limits

Release-specific source URLs, checked dates, publisher PDF SHA-256 digests and supplemental reference links are stored in scripts/topps/remaining-parallel-programs.mjs. Three older releases use attributed editorial checklists where a publisher parallel sheet was unavailable. Supplemental references are labeled separately from publisher odds. Pack odds are not used to infer serial-number print runs. Final actual production can differ from solicitations.

Finest NFL uses #1–100 / #101–200 / #201–300 tier-specific runs. Flagship NFL restricts plates and Sandglitter by published card-type ranges. Sonic SPs receive only the four separately documented finishes. Pristine encased finish matching requires evidence beyond the product name. 2022 Chrome Update Red remains /25, not the ordinary Chrome /5. Platinum Anniversary Toile White Orange is /25 in Topps’ NumberedTo column.

Only imported checklist subjects receive options; missing subjects, image variations, additional retail editions and unverified insert/autograph rainbows are not fabricated. Own inventory is matched from the page’s existing public catalog snapshot. Gallery eBay lookups retain the two-request concurrency limit, lazy visibility loading, cache/backoff and affiliate checks. These lookups do not query Supabase per card or alter eBay listings.

Photos and asking prices appear when an eligible own-stock or exact seller match is found. Unavailable photos stay labeled unavailable; a different finish’s image is not substituted. No new PriceCharting image reuse has been enabled.

## Validation

Regression checks cover all 62 base catalogs, all configured section IDs, unique finish IDs, Finest tier boundaries, unknown numbering, impossible seller serials, negative Frozenfractor serials, Pristine encasing evidence, source URL provenance and publisher hashes. Full baseball/football route and sitemap checks are run before deployment. Production publication is verified separately after CI.
