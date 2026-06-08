# ArSca Bug Trace Report

Diagnostic pass date: 2026-05-12

Scope: diagnostic only. This report traces the recurring bugs through the current `dashboard.html` implementation and identifies source-of-truth conflicts before the next fix pass.

## Authoritative Store Map

Current inventory reads can come from multiple stores:

- Webflow via `loadWebflowInventoryItems()` / `wfGet()` through the Cloudflare Worker.
- Built-in Supabase inventory via `loadBuiltInInventoryItems()` / `updateBuiltInInventoryItem()`.
- Local spreadsheet/local cache via `lba_inventory`.
- Universal local inventory via `walkoff_universal_inventory`.
- Local edit overlay via `inventory_edit_overrides_v1`.
- In-memory arrays: `all`, `filtered`, `soldData`.

Current cart and POS stores:

- Active cart local store: `pos_cart_v2`.
- Active cart worker route: `cartWorkerPath()` via `fetchCartFromWorker()` and `postCartToWorker()`.
- Completed sale log: `pos_transactions`.
- Sold inventory status: Webflow/Supabase/local inventory paths through `markCartItemsSoldFromPayment()`.
- Cash drawer local store: `pos_drawer`.
- Drawer closeouts: `pos_drawer_closeouts`.

Current item/research/auth stores:

- Research results: `qplResults`, `qplMasterResults`.
- Dealer unified-ish item store: `dealer_items_v1`.
- Auth queue: `dealer_items_v1.queuesById.authQueue`.
- Needs review: `research_needs_review_v1`.

## Duplicate Store Conflicts

1. Inventory has no single write/read authority. `loadInventory` is aliased to `loadInventoryByConfiguredSource`, but older direct Webflow load logic still exists. Edits may write to `lba_inventory`, `walkoff_universal_inventory`, Webflow, Supabase, or only an overlay, depending on source.
2. Cart reads worker first, localStorage second. Payment clear currently writes localStorage first and posts the empty cart without awaiting success, so a stale worker cart can repopulate the display.
3. Sales analytics read both inventory sold state and `pos_transactions` in some panels, but not uniformly. Older panels still privilege `all.filter(status === "sold")`.
4. Drawer is browser-local only. `pos_drawer` is not currently a cross-device persistent drawer session.
5. Research/Auth/Buy/Inventory pass item data by copying result objects in many places instead of always passing one canonical item ID.

## Dead or Shadowed Functions

- `renderBuyList()` is defined twice. The second definition wins; the first is unreachable.
- Original `loadInventory()` body is shadowed by `loadInventory = loadInventoryByConfiguredSource;`.
- Older Webflow-only edit assumptions in `confirmEditAndSync()` conflict with the configurable source model.
- Some local save helpers return success even when the item was not in the intended authoritative store.

## Buttons/Paths That Can Toast Without Proven Persistence

- `confirmEdit()` can toast success after writing local override/local cache, while the authoritative source after refresh may be Webflow or Supabase.
- `recordCustomerDisplayPayment()` writes `pos_transactions` locally before inventory mark-sold and before worker cart clear success is proven.
- `saveActiveCartData()` writes local cart then awaits worker post, but worker failure is queued rather than blocking UI success in callers.
- `clearCustomerDisplayCart()` clears local and posts worker, but if worker post fails the next `renderCustomerDisplay()` can read stale worker data.

## Bug Traces

### 1. Inventory edits revert after refresh

- User action/button clicked: Inventory item Edit modal -> `SAVE CHANGES`.
- Frontend function/event handler called: `confirmEdit()` at `dashboard.html:7578`; optional path `confirmEditAndSync()` at `dashboard.html:7619`.
- State object modified: `updates` object, then `all` via `applyDashboardItemUpdate()`.
- API/backend/localStorage/Supabase/Webflow write attempted: `saveInventoryEdit()` at `dashboard.html:11620`.
- Actual store written: built-in path writes Supabase via `updateBuiltInInventoryItem()`; spreadsheet path writes `lba_inventory`; generic path writes `lba_inventory`, `walkoff_universal_inventory`, and `inventory_edit_overrides_v1`. `confirmEditAndSync()` may PATCH Webflow through `WORKER + /proxy/...`.
- Store read after refresh: `loadInventoryByConfiguredSource()` at `dashboard.html:4898` reads Webflow, built-in Supabase, and/or `walkoff_universal_inventory`, then applies `inventory_edit_overrides_v1`.
- Why previous fixes did not work: they added a local overlay but did not choose one authoritative write path. The overlay can visually mask a failed backend write, and it is browser-local, not durable across devices. Also, `confirmEdit()` success means "local/overlay saved", not "authoritative source persisted".
- Exact file/function that needs patching: `dashboard.html`: `confirmEdit()`, `saveInventoryEdit()`, `confirmEditAndSync()`, `loadInventoryByConfiguredSource()`.
- Minimal fix plan: make `SAVE CHANGES` write to the same source selected by `getInventorySource()`. For Webflow source, PATCH Webflow or explicitly label local-only draft. For built-in, require Supabase update success. Only toast success after the selected source write succeeds. Keep overlay only as offline retry/draft, not as proof of persistence.
- Manual test to prove fix: edit cost/notes/condition -> save -> hard refresh -> reload from selected inventory source -> confirm values persist without relying on `inventory_edit_overrides_v1`.

### 2. Sell cart does not clear after payment

- User action/button clicked: Customer display payment button such as Cash/Card paid.
- Frontend function/event handler called: `recordCustomerDisplayPayment(method, total, tenderType)` at `dashboard.html:11695`.
- State object modified: `cart`, `items`, `tx`, `drawerState`, `pos_cart_v2`.
- API/backend/localStorage/Supabase/Webflow write attempted: local `pos_transactions`; local `pos_cart_v2`; worker cart via `postCartToWorker(empty)`.
- Actual store written: `pos_transactions` and `pos_cart_v2` in localStorage; worker post is not awaited during final clear.
- Store read after refresh/render: `renderCustomerDisplay()` and `getActiveCartData()` call `fetchCartFromWorker()` first, then `pos_cart_v2`.
- Why previous fixes did not work: if the worker still has the old cart, `renderCustomerDisplay()` can prefer the stale worker cart over the cleared local cart. The clear does not wait for worker success or mark a local clear version that wins over stale worker data.
- Exact file/function that needs patching: `recordCustomerDisplayPayment()`, `getActiveCartData()`, `renderCustomerDisplay()`, `postCartToWorker()`.
- Minimal fix plan: introduce cart revision/timestamp. On payment success, write `clearedAt` locally and post empty cart to worker; if worker fails, keep a local "clear wins until newer worker revision" guard. Do not render stale worker cart older than local `clearedAt`.
- Manual test to prove fix: add item -> cash paid -> inspect `pos_cart_v2.items=[]` -> force render/refresh -> cart remains empty even if worker fetch returns stale data.

### 3. Sales stats and BUY SIGNALS do not update

- User action/button clicked: payment completion.
- Frontend function/event handler called: `recordCustomerDisplayPayment()` -> `renderStats()` -> `renderBuySignals()`.
- State object modified: `pos_transactions`; inventory item status only for tracked items in `markCartItemsSoldFromPayment()`.
- API/backend/localStorage/Supabase/Webflow write attempted: local `pos_transactions`; optional inventory sold write via `markInventoryRecordSold()`.
- Actual store written: local `pos_transactions`, plus Webflow/Supabase/local inventory only when cart item has `shopId` or `wfId`.
- Store read after refresh: `renderStats()` uses `all.filter(status === "sold")` plus `transactionSoldRows()` in the current file. `renderBuySignals()` uses `all` plus a local transaction mapping.
- Why previous fixes did not work: sales history is split. Quick/manual cart lines are sale records but not inventory records, so panels that only read sold inventory remain empty. `getSalesSignal()` still only reads `all`, not `pos_transactions`.
- Exact file/function that needs patching: `renderStats()`, `renderCats()`, `renderSoldTable()`, `renderBuySignals()`, `getSalesSignal()`, `recordCustomerDisplayPayment()`.
- Minimal fix plan: designate `pos_transactions` as completed-sale authority, then derive home stats, Buy Signals, Sales tab, EOD report, and item velocity from it. Inventory status should be a separate side effect, not the sales source of truth.
- Manual test to prove fix: complete one manual sale and one inventory sale -> refresh -> Home sold/revenue, Sales tab, Buy Signals, and EOD export all show both sales.

### 4. Cash drawer not linked to POS payments

- User action/button clicked: Open Drawer, then payment button.
- Frontend function/event handler called: `openDrawer()` at `dashboard.html:10535`; `recordCustomerDisplayPayment()` at `dashboard.html:11695`.
- State object modified: `drawerState`, `pos_drawer`, `pos_transactions`.
- API/backend/localStorage/Supabase/Webflow write attempted: localStorage only for drawer; no Supabase drawer write found.
- Actual store written: `pos_drawer` and `pos_transactions`.
- Store read after refresh: `drawerState = JSON.parse(localStorage.getItem('pos_drawer') || 'null')`; `getDrawerSnapshot()` reads local `pos_transactions`.
- Why previous fixes did not work: drawer totals are local-browser calculations. Cash payment writes `drawerState.cashSales`, but cross-device drawer state is not persisted. It also does not create a distinct cash movement record; expected cash is inferred from transactions plus adjustment log.
- Exact file/function that needs patching: `recordCustomerDisplayPayment()`, `saveDrawer()`, `getDrawerSnapshot()`, `openDrawer()`, drawer storage schema.
- Minimal fix plan: create drawer movement records inside the same completed-sale transaction path: `{drawerSessionId, type:'cash_sale', amount}`. Persist drawer session/movements to the chosen backend if multi-device accuracy is required.
- Manual test to prove fix: open drawer at 200 -> cash sale 20 -> `pos_transactions` has drawerSessionId and tender cash -> drawer expected 220 -> refresh -> expected remains 220.

### 5. Pokemon collector number search returns wrong variant

- User action/button clicked: Research search for `charizard 199/165` or `alakazam ex 201/165`.
- Frontend function/event handler called: `runPriceLookup()` -> `searchQuickCatalog()` -> provider fetchers -> `rankQuickLookupResults()`.
- State object modified: `qplMasterResults`, `qplResults`.
- API/backend/localStorage/Supabase/Webflow write attempted: none; provider reads only.
- Actual store written: in-memory search result arrays.
- Store read after refresh: none; search reruns.
- Query parser: `getStrictTcgIntent()` now detects slash collector numbers and stores numerator/denominator.
- Confidence calculation: provider rows carry their own `confidence`; `rankQuickLookupResults()` computes `rankScore`, but visible confidence badge still uses original `r.confidence`.
- Why previous fixes did not work: ranking penalties can move wrong card numbers down, but the original provider confidence can still display HIGH CONFIDENCE on a wrong-number fallback. Also denominator is only checked against `card_number` text, not set total metadata.
- Exact file/function that needs patching: `rankQuickLookupResults()`, `qplStrictAllows()`, provider normalization in `fetchPokemonCatalog()` and `fetchWorkerTcgCatalog()`, display confidence in `quickLookupResultCard()`.
- Minimal fix plan: when strict collector number is present, exclude wrong numbers from primary, mark fallback as low confidence, and derive displayed confidence from strict-match validation. Add set total/set alias field if provider returns it.
- Manual test to prove fix: `charizard 199/165` cannot show Expedition #6 as primary or high confidence; exact 199/165 ranks first if returned.

### 6. SIR/IR/SAR abbreviation searches fail

- User action/button clicked: Research search for `pikachu sir`, `charizard SIR 151`.
- Frontend function/event handler called: `runPriceLookup()` -> `searchQuickCatalog()` -> `rankQuickLookupResults()`.
- State object modified: `qplResults`.
- API/backend/localStorage/Supabase/Webflow write attempted: none.
- Actual store written: in-memory only.
- Normalization path: `SMART_SEARCH_SYNONYMS`, `expandSmartQuery()`, `getStrictTcgIntent()`.
- Providers receiving expanded query: PriceCharting CSV/live through `qplQueryVariants()`, worker TCG, PokemonTCG, Scryfall.
- Why previous fixes did not work: abbreviation expansion and strict filtering are not consistently applied at provider query time. Some providers receive broad query text, and strict filtering happens after mixed results return. If no strict match exists, fallback handling is UI-only.
- Exact file/function that needs patching: `expandSmartQuery()`, `qplQueryVariants()`, `getStrictTcgIntent()`, `qplStrictAllows()`, `renderQuickLookupResults()`.
- Minimal fix plan: separate `queryForProvider` from `strictFilters`; require strict modifiers in primary results and force visible confidence to low/closest for fallback results.
- Manual test to prove fix: `pikachu sir` either shows SIR primary results only or a "No exact strict matches" block with closest results collapsed.

### 7. Condition dropdown does not affect TCGPlayer/JustTCG price/search

- User action/button clicked: condition dropdown on a result card.
- Frontend function/event handler called: `updateQplVariant(idx,{selectedCondition:this.value})`.
- State object modified: selected result object in `qplResults[idx]`: `selectedCondition`, `selectedVariant`, `market`, `priceSource`.
- API/backend/localStorage/Supabase/Webflow write attempted: `hydrateQplVariantMatrix()` and possibly `refreshQplSkuPrice()`.
- Actual store written: in-memory search result only.
- Store read after refresh: none; selected state is lost unless item is added to buy/inventory.
- Why previous fixes did not work: non-JustTCG providers use `buildQplVariantsFromPrices()` which only has NM real price and generates estimated variants. For JustTCG, condition changes only work if `availableVariants` has exact condition/finish/language and the selected result source is `justtcg`.
- Exact file/function that needs patching: `updateQplVariant()`, `applyQplSelectedVariant()`, `hydrateQplVariantMatrix()`, `addQuickLookupToBuyOffer()`, `addQuickLookupToInventory()`.
- Minimal fix plan: make variant matrix hydration mandatory before variant controls are considered exact. Store `selectedVariantId`, price label, and source when routing to Buy/Inventory. TCGPlayer external link should be rebuilt from selected variant where possible.
- Manual test to prove fix: select JustTCG card -> switch NM to LP -> `selectedVariant.variantId/skuId` changes and buy offer stores that ID.

### 8. Foil/finish selection does not change exact variant

- User action/button clicked: finish dropdown on result card.
- Frontend function/event handler called: `updateQplVariant(idx,{selectedFinish:this.value})`.
- State object modified: `qplResults[idx].selectedFinish`, `selectedVariant`, `market`.
- API/backend/localStorage/Supabase/Webflow write attempted: JustTCG matrix/SKU endpoints only for JustTCG rows.
- Actual store written: in-memory only until routed.
- Store read after refresh: none.
- Why previous fixes did not work: PriceCharting and Scryfall rows can produce pseudo variants; only JustTCG has exact raw TCG variant semantics. `qplVariantOptionValues()` filters options based on current condition/finish/language, which can hide valid alternate finishes if the current condition combination is missing.
- Exact file/function that needs patching: `qplVariantOptionValues()`, `qplSelectedVariant()`, `applyQplSelectedVariant()`, `normalizeQplVariantMatrix()`, routing functions.
- Minimal fix plan: for JustTCG, build finish options from all real variants but condition options from selected finish/language. For non-JustTCG, label as estimate/product-level and do not present as exact variant.
- Manual test to prove fix: select a card with normal and foil variants -> finish changes selected SKU and price; unavailable finishes absent.

### 9. Images missing

- User action/button clicked: search result display or route Research -> Buy -> Inventory -> Sell.
- Frontend function/event handler called: provider fetchers, `quickLookupResultCard()`, routing functions.
- State object modified: provider row `imageUrl`, inventory `thumbnail`, cart line `img`, dealer item `images`.
- API/backend/localStorage/Supabase/Webflow write attempted: depends on route.
- Actual store written: in-memory `qplResults`, `walkoff_universal_inventory`, `pos_cart_v2`, `dealer_items_v1`.
- Renderer expectation: research cards expect `r.imageUrl`; inventory table expects `thumbnail`; cart/customer display expects `img`; auth expects `item.images`.
- Why previous fixes did not work: image field names are not normalized once at the boundary. PriceCharting rows only use `m.imageUrl`; possible fields like `image-url`, `box-art-url`, `coverUrl`, `thumbnail` are not fully normalized in every provider path. Moving between modules renames image fields repeatedly.
- Exact file/function that needs patching: provider row mappers `fetchPriceChartingCsvCatalog()`, `fetchPriceChartingLiveCatalog()`, `fetchWorkerTcgCatalog()`, `fetchPokemonCatalog()`, plus routing functions `selectQuickLookupResult()`, `addQuickLookupToInventory()`, `addQuickLookupToSaleCart()`, `dealerItemFromResearchResult()`.
- Minimal fix plan: add one `normalizeImageUrl(raw)` boundary helper and one canonical `imageUrl` on research/unified items; map to `thumbnail`/`img` only at final target write.
- Manual test to prove fix: result with PriceCharting image shows in Research, then appears in Buy line, Inventory, Sell cart, and Auth Check.

### 10. Chart modal opens but history not fetched

- User action/button clicked: result card `CHART`.
- Frontend function/event handler called: `openQplChartModal(idx, range)`.
- State object modified: `qplResults[idx].graphRangeLabel`, `graphDuration`, `selectedVariant.priceHistory`, `chartLastFetchStatus`.
- API/backend/localStorage/Supabase/Webflow write attempted: JustTCG card/SKU endpoints; PokemonPriceTracker worker candidate endpoints.
- Actual store written: in-memory only.
- Store read after refresh: none.
- Why previous fixes did not work: PokemonPriceTracker mapping is guessed by name/set/cardNumber at click time. No confirmed `pokemonPriceTrackerCardId` is stored in the item. If the worker endpoint does not exist or returns 404, status may become failed/no data, but no durable mapping is recorded.
- Exact file/function that needs patching: `openQplChartModal()`, `fetchPokemonPriceTrackerHistory()`, worker route(s), provider normalization to include chart IDs.
- Minimal fix plan: add worker-supported mapping endpoint and return a stable chart source object with `cardId`, `status`, `points`. Store chart ID on selected result/unified item. Keep PriceCharting out of history.
- Manual test to prove fix: click Chart -> network call to confirmed worker route -> status becomes fetched/no_mapping/no_data/failed, never not_fetched; points render if returned.

### 11. Auth Check queue click does not select item

- User action/button clicked: row in Auth Queue.
- Frontend function/event handler called: row `onclick="openItemInAuthCheck(id)"`.
- State object modified: `activeAuthItemId`.
- API/backend/localStorage/Supabase/Webflow write attempted: none.
- Actual store written: none.
- Store read after refresh: `dealer_items_v1` queue and `activeAuthItemId` is runtime only.
- Why previous fixes did not work: previous button markup could have been invalid/nested in ways that swallowed events. Current path renders `div role="button"`, but workspace selection still depends on the ID existing inside `dealer_items_v1.itemsById`.
- Exact file/function that needs patching: `renderAuthCheckWorkbench()`, `openItemInAuthCheck()`, enqueue functions that create `dealer_items_v1`.
- Minimal fix plan: verify enqueue stores `itemsById[id]` and queue ID match. Add debug trace to log clicked ID, item exists, activeAuthItemId, workspace render item title.
- Manual test to prove fix: send result to Auth Check -> click second queue row -> center and right panels show that row's title and selected row state.

### 12. Customer display exposes dealer controls

- User action/button clicked: Sell/Customer Display tab.
- Frontend function/event handler called: static DOM under `tab-display`, then `renderCustomerDisplay()`.
- State object modified: none for rendering; cart actions mutate cart.
- API/backend/localStorage/Supabase/Webflow write attempted: cart worker/local if controls are clicked.
- Actual store written: `pos_cart_v2` and worker cart for controls.
- Customer display container: `#customer-display` plus surrounding `#tab-display` markup.
- Why previous fixes did not work: dealer controls and customer-safe display are in the same tab and layout. Hiding individual buttons is fragile because future dealer controls can accidentally be added inside the display tab again.
- Exact file/function that needs patching: static `tab-display` markup, `renderCustomerDisplay()`, `renderCustomerPaymentLinks()`.
- Minimal fix plan: split dealer controls into a separate dealer-only panel outside the customer display boundary. Make `#customer-display` a pure render target with no action handlers except safe QR/payment links.
- Manual test to prove fix: open Customer Display with cart items -> no clear cart, no internal shortcut/config/debug/cost/profit/source ID text.

## Required Debug Instrumentation Plan

Do this after this report and before root-cause patches:

1. Add `DEBUG_WORKFLOW_TRACE` helper:
   - Enabled only for owner/admin and `localStorage.workflow_trace === "1"`.
   - Logs to console only.
   - Never writes into customer display DOM.
2. Inventory trace event chain:
   - `inventory.save.click`
   - `inventory.save.payload`
   - `inventory.save.writeTarget`
   - `inventory.reload.source`
3. Payment trace event chain:
   - `payment.click`
   - `payment.sale.write`
   - `payment.drawer.write`
   - `payment.cart.localClear`
   - `payment.cart.workerClear`
   - `payment.stats.refresh`
4. Search trace event chain:
   - `search.rawQuery`
   - `search.strictIntent`
   - `search.providerQueries`
   - `search.rankReasons`
5. Chart trace event chain:
   - `chart.click`
   - `chart.selectedItem`
   - `chart.mapping`
   - `chart.workerRequest`
   - `chart.pointsLength`

## Minimal Patch Order

1. Inventory persistence: choose/read/write the same authority.
2. Cart clear: make local cleared revision beat stale worker cart.
3. Sales authority: make `pos_transactions` the single completed-sales source.
4. Drawer movements: record drawer movements from transactions.
5. Pokemon strict confidence: make wrong collector numbers impossible as high-confidence primary.
6. Variant linkage: require exact JustTCG matrix before real variant labels.
7. Image normalization: normalize `imageUrl` at provider boundary.
8. Chart mapping: implement confirmed worker mapping/status contract.
9. Customer display boundary: pure customer-safe render component.
10. Tablet layout cleanup after workflow correctness is proven.

