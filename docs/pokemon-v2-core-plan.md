# Pokémon V2 Core Plan

Goal:
Build a stable dealer-first Pokémon workflow before expanding to other categories.

V2 scope lock:
This branch is ONLY for the Pokémon dealer workflow. Work in this branch must stay focused on exact Pokémon research, pricing basis selection, buy offer preparation, inventory carryover, and scanner-to-Research handoff.

Locked workflow:
Research Pokémon
→ exact card resolution
→ all condition/finish prices visible
→ activePriceBasis
→ buy offer
→ add to inventory
→ scanner sends candidate to Research

Build phases:
1. API layer only
2. Research UI only
3. Condition Matrix only
4. Buy Offer only
5. Inventory carryover only
6. Scanner-to-Research handoff only

Rules:
- One pass = one workflow.
- No comics, sports, games, Funko, cash drawer, or UI overhaul in this branch yet.
- Forbidden work: cash drawer, non-Pokémon categories, UI overhaul, scanner redesign, checkout/payment.
- Do not fetch giant result sets.
- Use PokemonPriceTracker as primary Pokémon source.
- Use PriceCharting only as fallback/guide.
- Cache exact cards by tcgPlayerId.
- Dropdown changes must not make API calls.
- Main price always comes from activePriceBasis.
