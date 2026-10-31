# Mana Pocket Arcade V3 Live Studio

Status: implemented and tested locally; not pushed, merged or deployed.

## Integration

The Whatnot tab contains the Live Studio controls. The overlay is `arcade-overlay.html`, a transparent 1080 × 1920 OBS browser source. Its default 700 × 120 purple/green sign sits at x=190, y=850; adjust to the actual divider between the existing camera sources. Effects and coins are clipped to the sign. No camera, inventory, image, listing or sale-writing code was replaced.

Controller requests use existing Supabase session verification and active store membership, restricted to owner/admin/manager. One SQLite-backed Cloudflare Durable Object per store persists settings and broadcasts via WebSocket. It uses no additional Supabase tables or inventory polling. OBS gets a separate read-only token valid for 12 hours. Only its SHA-256 hash is stored; the token travels in the URL fragment and first WebSocket frame, not the HTTP URL. Replace/revoke closes existing viewers. Settings use revision checks to prevent stale controller saves. Connections restore current settings and an ongoing countdown; completed celebrations are not replayed.

Sound is synthesized, muted by default, with volume controls. In OBS enable Control audio via OBS and unmute the source. Browser autoplay policy may require Interact → click once. Actual OBS audio output and camera positioning still need rehearsal.

## Automatic events

Uses the existing signed `/whatnot/webhook` receiver; Claude's `onEvent` inventory callback remains in place. The separate overlay handoff is awaited before acknowledging; a handoff failure returns 503 so Whatnot can retry. This may delay the existing event callback during an overlay service outage; the existing inventory reconciliation cron remains unchanged.

Automatic effects default off. The operator supplies the exact seller ID and show ID. Only signed v2 events matching both are eligible. `shows.started` maps to READY, `shows.ended` to GAME OVER. `orders.created` maps to SOLD/JACKPOT only for an auction order in pending_fulfillment for that show. Jackpot compares the configured currency and subtotal, not tax/shipping. No buyer details are broadcast. Events older than 60 seconds are deliberately ignored for animations; retries are atomically deduplicated for seven days and out-of-order show events are rejected. Individual bids and auction clocks are not assumed to exist; countdown remains manual.

Official references checked 2026-10-31:
- https://developers.whatnot.com/getting-started/webhooks
- https://developers.whatnot.com/webhooks/tag/orders/webhook/post/orders.created
- https://developers.whatnot.com/webhooks/tag/shows/webhook/post/shows.started
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/

## Inspection and coordination

- Repository: squeebmike/ArSca. Reconciled against main `1c9191f`, including Claude branch `df1a9ca` and automatic inventory/show sync.
- Production Worker: still-resonance-4f87. Confirmed encrypted WHATNOT_API_KEY, WHATNOT_WEBHOOK_SECRET and Supabase secret metadata; no secret values retrieved.
- Supabase project vroknjrxubsqyexngwus: observed restart then healthy state; inspected live public inventory/sales schema and repository store-membership definitions. No schema changes made. Live store-membership policies were not independently audited.
- Claude's unpublished desktop changes could not be inspected: the app access request timed out. Published branch work was inspected and retained.
- Earlier V3 ZIP was referenced in the prior chat but was not available as an attachment. This implements the described V3 features; it is not a byte-for-byte port of that ZIP.

## Verification

Passed:
- `node tests/live-studio.test.mjs`: validation, role gate, revision conflict, seller/show isolation, event age/type filtering and Whatnot signatures.
- `node tests/live-studio-runtime.test.mjs`: actual local Workers runtime, SQLite, WebSockets, cross-store rejection, read-only access, countdown reconnect, atomic event deduplication, event ordering and link revocation.
- `node tests/live-studio-browser.test.mjs`: isolated Chrome controls/preview, safe literal text, animation, link generation and store-switch guard.
- `node tests/whatnot-webhook.test.mjs`, `node tests/whatnot-sync.test.mjs`, `node tests/whatnot-qty-check.test.mjs`.
- `node tests/parse-check.js`, `git diff --check`, full production Worker `wrangler deploy --dry-run`.

Runtime/browser tests require Node 22+, miniflare/esbuild and Playwright respectively. Set STUDIO_TOOLING or STUDIO_PLAYWRIGHT to the package.json next to installed dependencies when using external test tooling. STUDIO_BROWSER_CHANNEL=chrome uses installed Chrome. Tool versions used: Wrangler 4.156.0, Miniflare 5.20261023.3-beta, Node 22.23.4. Local test data only; no real sales triggered.

Three legacy tests failed both before modifications and in the initial overlay checkout: whatnot-bridge, whatnot-live-stickers, whatnot-show-builder. Those baseline failures were reproduced at main 63c7699. This is not a claim that the full repository suite passes.

## Remaining release work

1. Approve/push the isolated `codex/mana-live-studio` branch; review any unpublished Claude work. Follow the repository beta/release process; do not overwrite main.
2. Deploy the Worker binding and `mana-live-studio-v1` SQLite class migration, plus frontend files. Both production and beta configs include the new binding; beta needs its existing isolated credentials and readiness configuration.
3. Verify the actual Whatnot API connection, enabled scopes and webhook subscriptions. Only stored-secret presence was inspected; actual API authentication and delivery have not been proven in this pass.
4. Rehearse logged-in control/authorization, genuine signed show/order events, two-camera geometry, OBS sound and reconnect behavior before enabling automatic effects.

No production Worker, frontend, Supabase schema, Whatnot subscription, OBS source or card image was changed by this work.
