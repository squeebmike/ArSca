# Research Barcode Scanner and UPC Lookup

## Research flow

The Research quick-search row includes **Scan Barcode**. It opens a responsive scanner sheet with camera scanning, manual/USB scanner input, a category hint, optional fallback product words, status messages, and candidate confirmation.

Barcode is evidence, not identity. No result is saved or routed into Inventory, Buy, Cart, or Comic Appraisal until an operator chooses a candidate. Sealed-product UPCs receive stronger confidence; comic UPCs always retain cover-confirmation requirements.

## Scanner strategy

1. Use the browser `BarcodeDetector` API with UPC-A, UPC-E, EAN-13, EAN-8, and Code 128 when supported.
2. Manual entry is always present. A USB scanner can type into that field and submit with Enter.
3. Browsers without native detection show a manual-entry message. No extra scanner library is shipped in this pass.

Camera permission is requested only when the scanner opens. Tracks stop after a code is captured, when the user stops the camera, and when the modal closes. Frames are never persisted.

## Normalization

`scripts/barcode-lookup.js` exposes `normalizeBarcode(raw)` and preserves leading zeros. It returns raw/cleaned values, primary code, UPC-A, EAN-13, UPC-E, supplement, candidate forms, type guess, and likely check-digit validity.

- `0759606017720` produces EAN-13 `0759606017720` and UPC-A candidate `759606017720`.
- `759606017720` produces UPC-A plus its zero-prefixed EAN-13 candidate.
- `0 759606 017720 00111` preserves supplement `00111`.
- Short reads are rejected. A normal-length code with an unusual check digit is still allowed as low-trust evidence for manual correction/lookup.

## Worker and PriceCharting

`POST /barcode/lookup` accepts `barcode`, `categoryHint`, `supplement`, optional `query`, and `source`. The Worker owns the PriceCharting token.

The route:

1. Tries normalized UPC forms through PriceCharting `/api/product?upc=`.
2. Uses the existing per-isolate one-call-per-second limiter.
3. For a low-confidence comic UPC, uses `/api/products?q=` to return additional cover/product candidates.
4. Uses `/api/products?q=` when optional product words are supplied after a failed UPC.
5. Returns normalized prices in dollars, confidence, reasons, category, image, provider ID/URL, and confirmation flags. It never returns the token or raw upstream error details.

## Categories and sealed products

Classification uses product name, console name, and genre. Sealed terms such as booster box, ETB, collector booster, hobby box, blaster, pack, tin, and case classify the item as a sealed product before card-category classification. Comics, Pokemon, MTG, sports, and other PriceCharting products retain category-specific labels.

Sealed matches may be high confidence, but they still require operator confirmation. Inventory records include barcode evidence, provider ID/URL, sealed-product type, image, market snapshot, and confirmation date.

## Comics and covers

Comic barcode matches receive lower confidence than sealed products. UPC can narrow the issue/product neighborhood, while variant, printing, retailer exclusive, virgin/ratio cover, sticker barcode, facsimile, and supplement ambiguity still require visual confirmation.

Candidate actions include Use This Cover, Appraise Comic, and Use My Photo. Only **Use This Cover** marks the candidate cover confirmed. Other actions preserve `needs-confirmation` so the existing appraisal panel can finish the visual check.

## Confirmed barcode memory

Confirmed mappings use IndexedDB database `arsca_barcode_links_v1`, store `links`. The key combines primary barcode and supplement. Stored fields include category, provider/product ID, title, console, image, confidence, confirmation/use timestamps, notes, and the normalized candidate snapshot.

On a repeat scan, the confirmed mapping appears first but can be forgotten with **Wrong Item / Forget Saved Match**. Unconfirmed API results are never globally trusted or saved.

## Images and offline behavior

Candidate images reuse the existing provider/product/URL-hash IndexedDB image cache. User photos remain higher priority and are never overwritten automatically. Image blobs are not stored in localStorage.

Offline scanning/manual entry checks confirmed mappings only. A match is labeled as a last-known offline snapshot. Unknown codes show `Offline. No saved match for this barcode.`

## Security

- PriceCharting credentials remain Worker-side.
- No credentials are written to browser storage, logs, debug panels, or responses.
- Camera frames are not saved.
- Barcode results are not auto-posted or auto-saved.
- Normal users see concise errors rather than upstream/token details.

## QA examples

- UPC-A: `759606017720`
- EAN-13: `0759606017720`
- Comic supplement: `0 759606 017720 00111`
- Invalid/short: `12-345`

Contract tests cover normalization, Worker UPC and candidate routes, cover confirmation, confirmed memory, build stamp, and token absence.
