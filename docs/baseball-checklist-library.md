# Public baseball checklist library

The public `/baseball` library begins with the 2023 Topps Series 1, Series 2 and Update **base** checklists: 330, 330 and 329 card numbers respectively. The official Update PDF says US250 does not exist. Repeated subject rows are grouped under one card number, preserving all players/teams and source notes. Inserts and parallels are explicitly outside this first import; each set links to the complete official PDF.

The legacy R2 catalog's sport/year labels are not sufficient to publish: a verified audit found basketball and Star Wars labels, disclaimer text used as set names, and missing core 2023 sets. This initial verified seed is a small reference catalog (about 200 KB), not inventory. Expanding to the full 2023-onward collection should use reviewed per-set R2 shards rather than import the 57 MB historical gzip into each request or keep growing the Worker bundle.

## Regeneration

Save the exact source PDFs and their extracted UTF-8 text as `series-1.pdf/.txt`, `series-2.pdf/.txt`, `update.pdf/.txt`. URLs and PDF SHA256 checksums are preserved in the generated seed. Run `python scripts/topps/import-2023-baseball.py <source-folder>`. Text can be extracted with pypdf's `PdfReader` and `page.extract_text()`. The importer rejects unrecognized team rows and missing card numbers, rather than quietly publishing a truncated list.

## Routes and discovery

- `/baseball`: verified set index, linked from the sports inventory department.
- `/baseball/checklists/{set-id}`: 60 entries per page, ordinary HTML pagination and GET search.
- `/baseball/checklists/{set-id}/cards/{card-id}`: permanent individual reference page.
- `/sitemap-baseball.xml`: index, set and card URLs (993 at initial launch); included in the site's sitemap index.

Card pages use WebPage schema. They are references, not store offers. Prices and store availability appear only for matching live storefront listings and link to the existing item checkout page. No card image is published without a verified source.

Search-result variants are noindex with the main set canonical. Pagination pages have their own canonical URLs. Checklist HTML is present before JavaScript. No browser-only inventory fetching is required.

## Exact stock matching

The existing public storefront normalization exposes an optional cleaned `subset` value from inventory `subset`, `cardSubset` or `checklistSection`. Matching requires sports singles and identical verified year, set, player, card number, subset and variant. Missing metadata does not imply Base. No source inventory records are edited, and eBay listings are unchanged.

## Affiliates

The optional `EBAY_PARTNER_CAMPAIGN_ID` Worker variable enables owner-attributed eBay **search** links. Until the owner provides the campaign ID, these are hidden. Adjacent disclosure and `rel="noopener sponsored"` are present. Search results are not represented as confirmed exact marketplace offers; no eBay listing price/image is fabricated.

The existing MTG/Pokémon interactive viewer has its separate TCGplayer affiliate format. This change does not alter that integration.

Tests: `npm run test:baseball-catalog`. All 989 reference card pages, 993 sitemap entries, canonical/title/H1 uniqueness, pagination, query noindex, strict stock identity and affiliate gating are covered. Deploy through the existing main-branch Worker workflow; only the new baseball namespace and sitemap are added to routes.
