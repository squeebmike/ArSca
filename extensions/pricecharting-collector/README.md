# Mana Pocket Card Collector — cloud edition (1.3.1)

## Install once

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder (the one containing `manifest.json`).
3. Pin **Mana Pocket Card Collector**. Click it to open the review page.

This is an unpacked extension, not a Chrome Web Store listing. Permissions cover PriceCharting/SportsCardsPro, your ArSca dashboard, queue recovery storage, scripting, and a recovery alarm. Download permission has been removed. If updating version 1.0, replace the source files and click Reload in Chrome.

Open the signed-in [ArSca dashboard](https://squeebmike.github.io/ArSca/dashboard.html), then click **Connect cloud** in the collector. The dashboard's existing session authorizes cloud requests as The Mana Pocket's owner/admin. No Supabase access token is copied into the extension. Keep Chrome and that dashboard tab open while collecting. If sign-in expires, collection pauses with a recoverable pending metadata batch.

You can now use the **Cloud card collector** panel on the regular ArSca dashboard. Click **Start newest first** to discover baseball and football directories together, then collect linked eligible sets in descending set-year order. Known release dates and the provider's New Releases list help order sets within a year; undated same-year sets fall back to alphabetical order. Article writing dates are never used. The panel shows live cloud counts, the current set, and Pause/Resume controls. If it is missing after installation, reload the dashboard.

## Update from 1.3.0 without losing progress

Click **Reload** for this existing extension in Chrome, then reload the dashboard. The current source position, pending upload, completed sources and cloud records are preserved. No new permissions are requested.

Version 1.3.1 fixes a discovery filter that omitted unsuffixed flagship sources such as `2026-topps` and `2023-bowman`. Click **Recheck source directories** to revisit the saved directory roots while keeping the active source and pending queue. Already-seen set URLs are skipped; newly eligible source links are added in newest-first order after the current source. Do not click Start to repair an existing job: Start creates a replacement job.

Click **Queue earlier price backfill** to schedule one revisit of the actual 2025/2026 sources already saved in the cloud. It starts automatically after the main queue finishes, uses the current price-aware parser, and upserts the same records. Blank source prices remain unavailable; old values are not invented or represented as store offers. The panel distinguishes queued, active and completed price revisits. Both controls preserve an explicit owner/source pause.

## Minimal-work collection

Click **Collect baseball sets** or **Collect football sets** to start from the public set directory. Or open a set or set directory on PriceCharting/SportsCardsPro, click **Use current source tab**, then **Collect sets & cards**. You can also paste multiple source URLs, one per line.

The collector enables **Include Variants**, uses normal **more results** controls, follows set links from directory pages, and uploads every batch directly to Cloudflare. It collects card names, numbers, parallel labels, print runs when shown, source links and available photo URLs. It keeps entries without images. Default sports discovery includes Topps/Bowman releases from 2019 onward. Uncheck that filter to collect other sources deliberately.

Keep Chrome and the dashboard tab open. You can close the collector review page; collection continues in its source tab. **Pause / Resume** work across browser restarts. Don't browse elsewhere in the collector tab while it is running. One job supports up to 500 linked sets and 1,000 batches per source. It waits four seconds between batches and stops for access challenges or stalled pages. It never solves CAPTCHAs or bypasses access restrictions. If a source has no picture, the extension cannot create one. Source directories may not link every set the provider has.

Slow pagination gets a 30-second recovery wait, with at most three attempts without new card rows before pausing for review. A temporarily missing More button or a full-page POST does not complete a set. New rows reset the recovery count. Access challenges still pause immediately.

## Cloud references — no image files or exports

Review cloud sets in pages of 100 cards. Filter the loaded cards by player/card number, parallel, or missing photos. **Sync earlier captures** moves version 1.0 captures into the cloud and removes each local set shard only after acknowledgement. New collections retain only progress, a connection tab ID and one pending batch in Chrome for recovery. Replayed uploads upsert the same source card rather than duplicating it.

Photo URLs and card details persist in Cloudflare independently of the eBay offer cache. Version 1.3 also saves positive USD estimates from visibly labeled Ungraded, Grade 9 and PSA 10 columns. Each estimate retains its collection date. Missing values, zeros and unknown currencies are omitted; older or unpriced uploads do not erase a newer estimate for the same identity. No image bytes, customer data, cookies or browsing history are uploaded. URLs do not grant image-reuse rights. Check permission to display source photos. Reference photos do not represent cards the store owns or active listings.

## Update to 1.3 without restarting the collection

Reload **Mana Pocket Card Collector** in Chrome Extensions, then use **Connect cloud** and **Resume collection** on the dashboard if needed. The saved queue, completed sources and pending batch persist. Do not click Start newest first to apply this update. Existing archived records without prices remain unpriced until collected again; no estimate is invented from an eBay asking price. This update captures prices during ordinary collection, not through per-visitor source requests. A continuous scheduled price refresh is not enabled.

## Automatic website connection

Uploaded references are available through the website's existing card-photo lookup. Exact source set, subject, card number, finish and known print run must match. Ambiguous photos, including one image reused across different finishes, are not shown as exact matches. Ordinary base photos are never substituted for numbered parallels.

Reference photos have no three-hour eBay expiration. They update when the collector revisits and uploads the source card. Missing/expired eBay listings do not delete references. Existing shop inventory, purchase buttons and eBay affiliate offers remain separate. The current website reference lookup supports sports checklists; other card categories retain their existing catalog image sources.
