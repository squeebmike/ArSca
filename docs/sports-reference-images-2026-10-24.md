# Sports reference images

The header social links use actual Facebook, Instagram and Whatnot SVG marks, grouped immediately after the store logo. The wo-scripts release is b19809a, pinned in the Worker and the published Webflow footer.

Base-card photos are inside the native parallel disclosure. Clicking or keyboard-activating the summary opens its finish gallery; finish controls are mounted only after opening. Own stock stays first. A matching eBay seller photo/price stays next; when no matching listing exists, an exact PriceCharting / SportsCardsPro reference can appear instead, with attribution and a notice that it is not a copy for sale. A missing finish never receives the ordinary base-card photo.

The initial verified import contains 530 image links for 2022 Topps Chrome Platinum Anniversary: 499 base cards and 31 additional image-bearing Griffey finishes. All 500 base entries were checked; the provider itself shows its no-image placeholder for A.J. Alexy #362. The provider also lists no photo for several other Griffey finishes. Card identities, URLs and image links were read from its public set table; price data is not imported.

Other families use an on-demand public-page resolver cached for seven days. One family page covers all finishes of that card number. It uses no Supabase reads and no PriceCharting API key or pricing calls. Provider failures pause further outbound calls across families for six hours, and the existing two-request visible-tile queue is shared with reference images. Known image references remain usable while the provider is unavailable.

Provider access is a real remaining limitation: direct public HTML requests from this environment returned HTTP 403, and the existing deployed image resolver returned no image for a verified existing card. This deployment therefore does not establish full image coverage across all 62 releases. It supports exact reference fallback across the catalog, but only images actually resolved or imported are shown. Additional verified batches can extend scripts/topps/reference-image-seeds.mjs without touching inventory or eBay listings.

Checks cover provider URL/image allowlists, exact player/card/finish identity, ambiguity rejection, ordinary-base versus parallel separation, reference fallback during marketplace failure, no inventory reads from enrichment endpoints, and provider-wide backoff. The full existing baseball/football route, sitemap and shopping checks remain in place.
