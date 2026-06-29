# ArSca API Search Map

> Each API is weird in a different way. ArSca should translate normal human searches into provider-specific queries instead of forcing users to know the API wording.

## Source Map

| Category | Primary source | Search use | Detail use |
| --- | --- | --- | --- |
| Pokemon | PokemonPriceTracker | Cards, sets, sealed products | Exact `tcgPlayerId`, prices, history, eBay/graded values, population |
| MTG | Scryfall and the downloaded Scryfall bulk catalog | Name/fuzzy and oracle/type/keyword search | Images, print data, USD/foil values, sets |
| Sports cards | SportsCardsPro / PriceCharting | Multi-result product candidates | Exact product ID and current grade values |
| Comics | PriceCharting | Multi-result issue/product candidates | Exact product ID and comic grade values |
| Comic metadata | Existing ComicVine/GCD-compatible routes only where already wired | Covers and issue metadata | Not the primary pricing source |

## Official Documentation

- PriceCharting: https://www.pricecharting.com/api-documentation
- PokemonPriceTracker: https://www.pokemonpricetracker.com/api
- PokemonPriceTracker overview: https://www.pokemonpricetracker.com/pokemon-card-price-api
- Scryfall: https://scryfall.com/docs/api

## Worker Routes In This Repository

### PokemonPriceTracker

- `GET /pricing/pokemon/cards`
- `GET /pricing/pokemon/sets`
- `GET /pricing/pokemon/sealed-products`
- `POST /pricing/pokemon/parse-title`
- `GET /pricing/pokemon/population`
- Export routes already present under `/pricing/pokemon/export`

The Worker owns `POKEMONPRICE_API_KEY` and sends `Authorization: Bearer ...` upstream. Browser code must never receive or log the key.

Search uses the full adapted natural-language query with `language` and `limit=5`. Exact selected-card hydration uses `tcgPlayerId`, `limit=1`, and only adds `includeHistory` or `includeEbay` when detail behavior needs those fields.

### SportsCardsPro / PriceCharting

- `GET /pricing/sportscardspro/products?q=` wraps multi-result `/api/products`
- `GET /pricing/sportscardspro/product?id=` wraps exact `/api/product`
- `GET /pricing/pricecharting/search?q=` wraps multi-result `/api/products`
- `GET /pricing/pricecharting/product/:id` wraps exact `/api/product?id=`

`PRICECHARTING_TOKEN` and `SCP_ACCESS_TOKEN` remain Worker-side. PriceCharting authenticates upstream with the private `t` parameter. Search must start with `/products`; `/product?q=` returns only one best match and hides candidates. PriceCharting permits one API call per second, so adapter queries are deduplicated and capped.

### Scryfall

The current dashboard uses Scryfall directly because it has no private key:

- `GET https://api.scryfall.com/cards/search?q=`
- `GET https://api.scryfall.com/cards/named?fuzzy=` where existing helpers use it
- `GET https://api.scryfall.com/sets`
- `GET https://api.scryfall.com/bulk-data`

Use the local downloaded bulk catalog first when configured. Mechanic searches use Scryfall oracle syntax such as `o:deathtouch o:landfall`; likely card names continue through the existing name/full-text behavior.

## PriceCharting Price Fields

Prices are integer pennies upstream and are converted to dollars once in Worker normalization.

### Cards

| Upstream field | UI meaning |
| --- | --- |
| `loose-price` | Ungraded |
| `cib-price` | Grade 7 / 7.5 |
| `new-price` | Grade 8 / 8.5 |
| `graded-price` | Grade 9 |
| `box-only-price` | Grade 9.5 |
| `manual-only-price` | PSA 10 |
| `condition-17-price` | CGC 10 |
| `condition-18-price` | SGC 10 |
| `bgs-10-price` | BGS 10 |

### Comics

| Upstream field | UI meaning |
| --- | --- |
| `loose-price` | Ungraded comic |
| `cib-price` | Graded 4.0 / 4.5 |
| `new-price` | Graded 6.0 / 6.5 |
| `graded-price` | Graded 8.0 / 8.5 |
| `box-only-price` | Graded 9.2 |
| `condition-17-price` | Graded 9.4 |
| `manual-only-price` | Graded 9.8 |
| `bgs-10-price` | Graded 10.0 |

Comic labels must never reuse card labels such as PSA 10 for the 9.8 field.

## Query Adapter Rules

1. Normalize whitespace, punctuation, voice terms, aliases, and collector-number slashes without discarding numbers.
2. Respect a manually selected category. In Auto/All mode, infer at most the two strongest categories.
3. Build a small deduplicated provider query plan.
4. Prefer local/offline data first when that mode is enabled.
5. Search multi-result endpoints before exact product detail endpoints.
6. Merge by provider ID, then normalized name/set/card number when no ID exists.
7. Rank exact IDs and numbers first, then name/player, year, set/brand, variant, and category evidence.
8. Penalize wrong card numbers, issues, players, years, sets, and categories.
9. Preserve the active search sequence guard so stale and stale-empty responses cannot overwrite current results.
10. Show generated queries, called routes, result counts, and match reasons only in Debug Mode.

## What Not To Do

- Do not expose provider secrets in HTML, localStorage, console output, bug reports, or debug panels.
- Do not use PriceCharting `/api/product?q=` as the first sports/comics search.
- Do not fire one PriceCharting request per sport or per result.
- Do not strip Pokemon collector numbers, promo codes, set words, or rarity terms.
- Do not call Pokemon history/eBay detail for every search candidate.
- Do not force MTG mechanic text into an exact card-name lookup.
- Do not clear useful local results because a later provider returns an empty list.
- Do not render responses from an older `_qplSearchSeq`.
