# Known Issues

This branch is tester beta with limitations. It should not be described as production-ready multi-store until RLS tests and live browser smoke tests pass against a real Supabase test project.

## Search

- Research search has an active sequence guard and keeps stale responses from overwriting current results, but the full requested QA matrix has not been automated on this branch.
- Ranking is strongest for the existing Pokemon, MTG, comics, sports, and cached/catalog paths already covered by code. Edge queries can still need manual review.
- Live API failures should surface as recoverable states; testers should report any blank result panels.

## Inventory

- Built-in Supabase inventory is store-scoped by schema/RLS and browser updates now include a `store_id` filter.
- Checkout has an in-memory finalization lock to reduce duplicate sale/inventory mutations from rapid confirmation.
- Inventory quantity is clamped at zero for built-in data writes, but this branch does not yet provide a full reservation/concurrency system.
- Hard delete remains available only behind an explicit `DELETE` prompt. Archive is the safer tester path.

## Consignments

- Consignment ownership/ledger concepts exist in docs and some UI/local flows, but a complete cloud-safe receive to sell to settle workflow is not proven in this branch.
- Treat consignments as beta/local-only unless the store has separately validated schema, RLS, payout math, and settlement reporting.

## Wantlists

- Customer wants capture exists around checkout and local/dashboard workflows.
- A full cloud-persistent wantlist model with open/contacted/filled/canceled workflow is not proven here. Treat wantlists as beta/local-only unless validated in a test Supabase project.

## Multi-Store Status

- Supabase migrations include store membership and RLS policies for key tables.
- Automated cross-store RLS tests were not present in this branch during this pass.
- Release should be labeled single-store/tester beta until same-store allow and cross-store deny tests are run with realistic authenticated roles.

## Mobile/UI

- Core dashboard mobile smoke still needs a Playwright/manual run at 390px after Playwright is installed or available.
- Report clipped buttons, horizontal overflow, or modals that cannot close as beta blockers.

## Deck Lab

- Deck Lab is not expanded in this pass. It should remain Beta/local-only and must not block dashboard, Research, Inventory, or Sell flows.
