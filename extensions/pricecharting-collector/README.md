# Mana Pocket Card Collector

## Install once

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder (the one containing `manifest.json`).
3. Pin **Mana Pocket Card Collector**. Click it to open the review page.

This is a local extension, not a Chrome Web Store listing. Permissions cover only PriceCharting/SportsCardsPro, local saved data, one collection tab, downloads, and a recovery alarm. No API keys, account data, prices, cookies, or browsing history are exported. Nothing is sent to The Mana Pocket automatically.

## Minimal-work collection

Click **Collect baseball sets** or **Collect football sets** to start from the public set directory. Or open a set or set directory on PriceCharting/SportsCardsPro, click **Use current source tab**, then **Collect sets & cards**. You can also paste multiple source URLs, one per line.

The collector enables **Include Variants**, uses normal **more results** controls, follows set links from directory pages, and saves every batch. It collects card names, numbers, parallel labels, print runs when shown, source links and available photo URLs. It keeps entries without images. Default sports discovery includes Topps/Bowman releases from 2019 onward. Uncheck that filter to collect other sources deliberately.

Keep Chrome open. You can close the review page; collection continues in the source tab. **Pause / Resume** work across browser restarts. Don't browse elsewhere in the collector tab while it is running. One job supports up to 500 sets and 1,000 batches per source. It waits four seconds between batches and stops for access challenges or stalled pages. It never solves CAPTCHAs or bypasses access restrictions. If a source has no picture, the extension cannot create one.

## Review and export

Filter by set, player/card number, parallel, or missing photos. **Export JSON / CSV** export the entire matching selection, not just the first 100 cards on screen. **Download matching photos** optionally saves local JPGs in set folders; keep the review page open for that operation. Chrome may ask about multiple downloads. Stop cancels future queued downloads, not a file already downloading.

Photos remain source references. Collecting a URL or file does not grant commercial image rights. Check reuse permission and the exact printing before publishing. No fake images, missing serial numbers, or duplicate finish assumptions are invented.

## Connect a reviewed sports set to the site

From the ArSca repo:

```
node scripts/import-reference-capture.mjs capture.json --set=2022-topps-chrome-platinum-anniversary
```

This produces `capture.json.review.json` without changing the site. It verifies the source set, exact player, card number, finish and known print run against the existing checklist. Ambiguous matches and photos reused across finishes are rejected for review. After reviewing ownership and matches, add `--write` to update the existing reference-image seed file, then run the sports checklist tests and deploy normally. No Supabase copy is created. A local capture does not become live until imported and deployed. TCG captures export normally; this sports importer intentionally does not map them into baseball/football checklists.
