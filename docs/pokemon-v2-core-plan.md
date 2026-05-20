# Pokémon V2 Core Plan

Goal:
Build a stable dealer-first Pokémon workflow before expanding to other categories.

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
3. Buy flow only
4. Inventory carryover only
5. Scanner-to-Research handoff only

Rules:
- One pass = one workflow.
- No comics, sports, games, Funko, cash drawer, or UI overhaul in this branch yet.
- Do not fetch giant result sets.
- Use PokemonPriceTracker as primary Pokémon source.
- Use PriceCharting only as fallback/guide.
- Cache exact cards by tcgPlayerId.
- Dropdown changes must not make API calls.
- Main price always comes from activePriceBasis.
