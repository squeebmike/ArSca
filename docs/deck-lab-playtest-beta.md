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
