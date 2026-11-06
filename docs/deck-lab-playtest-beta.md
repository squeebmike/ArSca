# Public Deck Lab playtest beta

Public route: `/deck-lab`. Linked from the Rules Academy, the Magic set index,
and Pocket Guides. The staff inventory Deck Lab remains unchanged.

Visitors can paste an Arena/text export for each player, or import a local text
file. Names and explicit printing identifiers are resolved through Scryfall's
collection endpoint in batches of at most 75; exact printing/name mismatches and
unresolved rows stop loading. Main decks, sideboards, and commander sections are
kept distinct. Only main-deck cards enter the shuffled library; designated commanders begin in the command zone.

Deck text is local to the browser. Saving is explicit, device-only, bounded to
20 decks. Card metadata is cached locally for seven days, bounded to 500 cards.
No paid AI, pricing API, inventory mutation, authentication change or secret is
required. Opponent hand and library are hidden in automated mode.

## Online private rooms

The same `/deck-lab` page offers private two-player rooms and four-player Commander pods on separate devices.
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

The host receives a random seat capability and a distinct single-use invite for each guest seat. Only SHA-256 capability digests are stored server-side. The invite is
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

The match opens in a viewport-sized battlefield with a centered fanned hand,
separate land and permanent rows, a combat lane and a compact spell stack.
Click a glowing playable spell to preview casting, choose legal targets, and review the highlighted lands. Auto-pay proposes lands; click your untapped lands to change that payment. Confirm payment to tap the chosen lands and put the spell on the stack, or cancel without spending mana. The server validates exact colors, ownership, and untapped status. Land plays remain one click. Use its
magnifier to inspect it without casting. Damage and pump spells enter target
selection and highlight legal creatures or players. Spell and blocker lines
show exact physical targets. Attackers move into the combat lane; select an
untapped blocker, then click an attacker to assign it. Confirm declarations
before proceeding to the next response window.

Phase pills and priority text identify the current decision. Space activates
the primary action and Escape cancels target/blocker selection. Decks & room
returns to setup; Resume battlefield restores the match view. Viewing setup
stays respected when another online action arrives. Reduced-motion preference
disables card flights. Local freeform offers the opponent's hand through an
explicit button; online opponents' hidden card identities remain unavailable.

`tests/deck-lab-battlefield.test.mjs` exercises actual engine-backed direct-play,
target selection, attack toggles and blocker assignment. Casting during the
attacker/blocker declaration choice or cleanup discard is rejected in both
the browser and the shared server rules implementation.

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

Your hand is visible; the local opponent hand opens through an explicit button. Either side can draw, move cards among hand,
battlefield, graveyard, exile and library bottom, tap/untap, turn multi-face cards
over, and change life. The user applies rules and effects manually. This beta
does not yet provide token creation, arbitrary counters, control changes,
midgame sideboarding, or a complete ability engine.

## Remaining work

Direct public deck URL import with provider-specific API support and text export
fallback; selecting among all saved decks; drag/drop; supported keywords and
more spell effects; targeted card-rule fixtures; match review explanations;
expanded format validation; best-of-three sideboarding. An arbitrary-deck automated mode
requires a substantially broader rules engine rather than guessed Oracle text.

Tests: `node tests/deck-lab-match.test.mjs`; three full deterministic practice
matches run through ordinary actions to a result, checking unique IDs and card
conservation, alongside stack, mulligan, mana, combat and freeform fixtures.
Local preview: `node scripts/mtg/preview-deck-lab.mjs`.

## Standard and Commander

The format selector separates custom practice, Standard and 1v1 Commander.
Standard checks at least 60 main cards, at most 15 sideboard cards, combined
copy limits (including basic-land and Oracle copy exceptions), and Scryfall
Standard legality. Sideboards stay outside the shuffled deck. Provider metadata
can be cached for seven days; these checks are not event certification.

Commander checks 100 cards including one or two designated commanders,
singleton limits, color identity and provider Commander legality. Commander
sections are recognized in exports; an exact commander-name field can designate
a single matching card when the export lacks a section. Two-commander pairing
eligibility requires manual review. This is 40-life one-on-one Commander
practice, not Duel Commander. Online rooms support two or four players.

Commander uses freeform mode locally and online. Commanders have stable physical
IDs, stay outside the opening library, and retain their command-zone cast count
through zone changes. The cast action places the commander on the public stack;
resolve/counter actions and return-to-command-zone moves are explicit. The UI
shows the printed cost plus two generic mana for each previous command-zone
cast. Players pay costs, apply abilities, timing restrictions and replacement
or state-based zone choices themselves. No complete Commander bot is claimed.

Incoming commander combat damage is tracked separately for each opposing
commander. Recording it does not also change life. A total of 21 prompts players
to check the loss condition and relevant effects; the freeform table does not
automatically end the game. Opening decisions must finish before manual actions.
Online rooms keep the selected format, verify card IDs and sections server-side,
and never expose opponents' hands, libraries or sideboard identities.

Validation: `tests/deck-lab-formats.test.mjs` covers format checks, commander
conservation, opening hands, tax persistence, per-commander damage and seat
projection. The real SQLite room runtime test covers Commander cast/counter/zone
return, 40 life, private hands and guest-seat normalization.

## Four-player Commander pods and responsive play

Choose four players in the online room setup. This selects Commander freeform;
the host loads one deck and receives three different one-use guest links. Each
guest claims one seat, loads their own deck, and submits it. The match starts
only after all four decks are verified. Four-player local/bot play is not offered.

Every seat receives its own hand, hidden library identities unless explicitly
searching, and only the public zones of the other three players. Projection
rotates players, stack controllers, active player, results and commander owners
into each seat's viewpoint. Turns rotate through remaining players. Conceding
removes that player's cards/spells and skips their seat; it does not end the
whole pod unless one player remains. Empty-library draws eliminate only that
player. Commander losses and arbitrary card effects still require manual play.
The first multiplayer mulligan is free; the starting player also draws, with
beginning steps applied manually. No full Commander ability engine is implied.

Desktop shows three opposing battlefields above your own. Portrait phones have
horizontally scrollable opposing seats; landscape phones use a compact table
with controls beside it and a separate hand lane. Safe-area insets and dynamic
viewport height keep controls reachable. Tests cover four-seat privacy, turn
rotation, invite reuse rejection, casting, per-commander damage and concessions
in both pure models and real Workerd/SQLite rooms.

## Direct tabletop controls

In manual tables, click a land in your hand to put it onto the battlefield;
click another spell to place it on the shared stack. Command-zone casting keeps
its existing tax counter. Click a battlefield card to tap/untap; the magnifier
still opens card text and explicit actions. Drag a card to the drop tray to
choose a zone, or onto your battlefield/hand. Hand-to-battlefield drops of spells
use the stack. Costs, timing and effects remain manual. Escape cancels a drag.

Players can create bounded groups of named creature tokens with numeric stats,
and add/remove +1/+1, -1/-1, loyalty, charge and stun counters. Power/toughness
counter totals appear on cards; other counter effects are manual. Counters reset
when a card changes zones; tokens disappear when moved off the battlefield.
The server enforces ownership and payload bounds. Generic spells can resolve
from the shared stack to a chosen public zone; effects are applied by players.

A manual phase marker highlights beginning, main, combat and ending phases. Only
the active online seat advances it, and the stack must be empty. The marker does
not execute card effects or declare attacks/blocks automatically.
