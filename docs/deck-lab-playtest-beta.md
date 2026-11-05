# Public Deck Lab playtest beta

Public route: `/deck-lab`. Linked from the Rules Academy, the Magic set index,
and Pocket Guides. The staff inventory Deck Lab remains unchanged.

Visitors can paste an Arena/text export for each player, or import a local text
file. Names and explicit printing identifiers are resolved through Scryfall's
collection endpoint in batches of at most 75; exact printing/name mismatches and
unresolved rows stop loading. Main decks, sideboards, and commander sections are
kept distinct. Only main-deck cards enter the current two-player game.

Deck text is local to the browser. Saving is explicit, device-only, bounded to
20 decks. Card metadata is cached locally for seven days, bounded to 500 cards.
No paid AI, pricing API, inventory mutation, authentication change or secret is
required. Opponent hand and library are hidden in automated mode.

## Online private rooms

The same `/deck-lab` page offers a private host/guest room on separate devices.
Each player loads their own deck. A separate SQLite-backed Durable Object owns
each room, including its shuffled cards, revisions and actions. Host plays
first. Rules rooms use the exact same source as the tested browser engine;
`deck-lab-server-engine.mjs` is a static copy, checked for source equality by
tests, so the Worker never evaluates arbitrary source.

The server independently looks up uploaded Scryfall IDs and quantities, ignoring
client-supplied card costs, text or stats. Only supported cards enter a rules
room. A freeform room accepts other verified cards and players apply their
effects themselves. Each player can move only their own cards and adjust their
own life. Private library search is explicit and ends on shuffle.

The host receives a random seat capability and a distinct single-use guest
invite. Only SHA-256 capability digests are stored server-side. The invite is
in the URL fragment and removed when claimed. Seat keys travel in Authorization
headers, not URLs. Browser storage retains the seat for reconnecting. Polling
syncs revisions every 2.5 seconds while visible; stale writes cannot overwrite
a later decision. No undo is offered in online rooms.

Neither player's library identities nor the opponent's hand identities are
sent to the browser. An explicit private library search reveals only the
requesting player's library. Room actions and card data are stored up to four
hours and then deleted by an alarm. No public lobby, spectator access, chat,
or automatic matching is included. Creation and API calls have rate limits.

Verification: `node tests/deck-lab-rooms.test.mjs` plus the real Workerd/SQLite
test `tests/deck-lab-rooms-runtime.test.mjs` (uses the same STUDIO_TOOLING
convention as the existing live-studio runtime test). Tests cover independent
seats, single-use invites, reconnects, hidden information, cross-room denial,
actor ownership, turn legality, simultaneous conflicting writes and concession.

## Automated scope

Basic Plains/Island/Swamp/Mountain/Forest, single-face normal-layout creatures
with no Oracle abilities and numeric power/toughness, Lightning Bolt, Shock,
and Giant Growth. Unsupported text, costs and layouts are rejected before an
automated match starts. Both built-in 60-card practice decks use this subset.

The engine enforces colored/generic automatic land payment, one land per turn,
London mulligans with explicit bottom choices, first-player draw skip, priority,
LIFO spell responses, summoning sickness, attackers, multiple blockers,
simultaneous combat damage, lethal state checks, cleanup, hand-size discards,
life-loss and empty-library results. Combat damage is assigned automatically.
All physical cards have stable IDs. Undo restores a complete decision snapshot.

Learning plays straightforward cards and attacks. Regular evaluates trades,
removal targets and opening land count. Practiced can respond with Giant Growth
to save its creature from lethal removal. Difficulty never changes draws or
reads the human player's hand. This is not competitive-strength AI or a
general Magic rules engine, and match results are not win-rate estimates.

## Freeform scope

Both hands are visible. Either side can draw, move cards among hand,
battlefield, graveyard, exile and library bottom, tap/untap, turn multi-face cards
over, and change life. The user applies rules and effects manually. This beta
does not yet provide token creation, arbitrary counters, control changes,
Commander rules, multiplayer, sideboarding, or a complete ability engine.

## Remaining work

Direct public deck URL import with provider-specific API support and text export
fallback; selecting among all saved decks; drag/drop; supported keywords and
more spell effects; targeted card-rule fixtures; match review explanations;
format legality; best-of-three sideboarding. An arbitrary-deck automated mode
requires a substantially broader rules engine rather than guessed Oracle text.

Tests: `node tests/deck-lab-match.test.mjs`; three full deterministic practice
matches run through ordinary actions to a result, checking unique IDs and card
conservation, alongside stack, mulligan, mana, combat and freeform fixtures.
Local preview: `node scripts/mtg/preview-deck-lab.mjs`.
