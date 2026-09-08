# Mana Pocket — Feature Roadmap (not yet built)

Working backlog of ideas the store wants, captured so nothing gets lost
between sessions. This is a planning doc, separate from the in-app "What's
New" changelog (`FEATURE_LOG` in `dashboard.html`), which only tracks what's
actually shipped. Check items off / move to `FEATURE_LOG` as they get built.

## Pending action

- [ ] **Apply `supabase-migrations/2026-09-08-storefront-notify-requests.sql`**
      to the production Supabase project. This session doesn't have write
      access to the real database (only to two unrelated test projects), so
      the storefront "let us know" feature (shipped, commit `c7d92ff`) is
      built and pushed but won't actually work until this migration runs.
      Reminder scheduled for the next session.

---

## Inventory Intelligence

- [ ] **Dead Inventory Radar.** Dashboard actively flags stuff that isn't
      moving instead of waiting to be asked: "Owned 143 days · 3 views ·
      market down 18% · $220 trapped." Then suggests a concrete next step —
      markdown, Whatnot auction, bundle, eBay best-offer, convention box, or
      hold. (Builds directly on the Slow Movers report and 90-day aging
      data already shipped — this is the proactive/alerting layer on top
      of that, plus view counts and market-trend data it doesn't have yet.)

- [ ] **Inventory Opportunity Matching.** Cross-references sales velocity
      against current stock depth and upcoming FOC to surface gaps:
      "You're selling TMNT MTG quickly but only have 4 left." / "You sold 7
      Spider-Man comics in 14 days; next week's FOC has 3 related
      releases." Makes FOC, inventory, and sales history actually talk to
      each other instead of being three separate screens.

- [ ] **Bundle Brain.** Finds inventory that makes sense bundled together
      instead of randomly discounted: connecting covers, artist sets,
      Pokémon evolution lines, team/player lots, Commander themes, etc.
      Calculates a bundle price that clears stock without murdering
      margin.

## FOC Intelligence 2.0

- [ ] **FOC Intelligence 2.0.** New PRH FOC comes in → compares it against
      prior orders, current inventory, presales, characters/artists that
      have actually sold, upcoming movies/events/signings, and previous
      FOC weeks. Outputs a recommendation per book: ORDER / REDUCE / SKIP /
      SPEC. Also flags books that quietly disappeared from a newer FOC
      file compared to an older one, so a title doesn't get missed
      entirely (the "He-Man situation").

## Show Builder & Live Selling (Whatnot / Twitch / eBay Live)

- [ ] **"What Should I Sell Tonight?" Show Builder.** Pick platform, show
      length, and category; the software drafts a running order from
      current inventory — opening heat, cheap engagement items, mid-show
      anchors, giveaways, closers. Tracks actual sale prices afterward and
      learns what works at different points in a show over time.

- [ ] **Show Planner + Run of Show.** Same idea, more explicit: select
      Pokémon / MTG / comics / sports / mixed, show length, format
      (singles, breaks, sudden death, etc). Builds warm-up → engagement →
      bigger items → cooldown → finale, deliberately not blowing the best
      inventory in the first 15 minutes.

- [ ] **Live Auction Companion.** Second-screen UI next to OBS with huge
      buttons: NEXT ITEM, SOLD, PASS, GIVEAWAY, PULL HEAT FOR LATER.
      Entering a sale price instantly shows estimated profit and pulls up
      the next item.

- [ ] **Live Floor-Price Warning.** Mid-auction, if bidding stalls below
      what makes sense given cost: "⚠️ DANGER — break-even ~$21.40" (you
      paid $17, running it at $1, stalled at $18). Can't stop a live
      Whatnot auction, but this teaches which inventory shouldn't be
      started at $1 next time.

- [ ] **$1 Auction Risk Score.** Pre-show rating per item: SAFE AT $1 /
      RISKY / DO NOT $1 START. Based on cost, comps, demand, past Whatnot
      performance, category, and audience size — a $150 card isn't
      automatically safe to $1-start just because it's worth $150.

- [ ] **Audience-Size Logic.** Ties inventory selection to how many people
      are actually in the room: "Hold the $300 Charizard, current room
      isn't deep enough — run the $25–$50 cards," unlocking bigger items
      once viewer/bidder count crosses a threshold.

- [ ] **Buyer Heat Map.** Sales intelligence from the store's own shows,
      not creepy tracking: which regular buyers go for which categories
      (e.g. "Mariners + Griffey," "Pokémon SIRs," "Spawn/90s comics"), so
      relevant inventory can be surfaced when they're active in a show.

- [ ] **Buyer Momentum.** Mid-show pattern detection: someone buys 4
      Pokémon cards in 20 minutes → suggest running another related card
      or bundle. Live-commerce version of "customers also bought."

- [ ] **Show Inventory Bucket.** Drag ~100 items into "Tonight's Show"
      instead of exposing the whole inventory database. Items get
      numbered/ordered for easy physical pull, then auto-sort afterward
      into SOLD / UNSOLD / GIVEAWAY / NEEDS RELISTING.

- [ ] **Whatnot vs. eBay Decision.** Per-item channel recommendation:
      WHATNOT / EBAY BIN / EBAY AUCTION / HOLD / CONVENTION. A $12 card can
      be a bad eBay listing but great Whatnot filler; a $600 card can be
      the wrong thing to expose to a thin $1-start room.

- [ ] **Show P&L.** Immediately at stream end: Gross / COGS / est. fees /
      giveaways / est. profit / profit per hour. Comparable across shows
      (e.g. Pokémon Tuesday vs. MTG Thursday vs. Comics Sunday).

- [ ] **True Giveaway Cost.** Tracks not just the giveaway item's cost but
      shipping/fees/other costs attributable to it, then reports whether
      giveaway-heavy shows actually correlate with better sales.

- [ ] **Loss-Leader Tracking.** Distinguishes "bad loss" from "customer
      acquisition" — losing $5 on an opening auction is fine if that same
      buyer goes on to spend $140 later in the show.

- [ ] **Repeat Buyer / Whale Dashboard.** Beyond "who spent the most":
      shows attended, total purchases, average order, categories, last
      purchase date. Someone spending $80/week for 15 weeks can matter
      more than a single $500 drop-in.

- [ ] **Show Experiment Engine.** A/B-style testing across shows: $1 vs $5
      starts, 30s vs 15s auction timers, giveaways every 30 vs 60 minutes,
      Pokémon-only vs mixed, Saturday 7pm vs Tuesday 6pm. After enough
      shows, tells the store what actually works for their audience
      instead of general Whatnot-guru folklore.

- [ ] **The Bench.** While live, a dynamic queue of the next 5–10 items the
      software thinks should run next, reacting to real-time momentum
      instead of blindly following the pre-planned order:
      > MOMENTUM: MTG ↑
      > Run next: TMNT Collector Booster
      > Then: Splinter Surge Foil
      > Hold: Greninja SIR
      > Reason: Pokémon auctions averaging 71% of target; MTG averaging 108%.

- [ ] **Three dashboard modes** (organizing idea for the above, not a
      separate build): **RESEARCH MODE** (should I buy this?), **SELL
      MODE** (where/how should I sell this?), **LIVE MODE** (what should I
      run next?).

## The Mana Pocket Pulse

- [ ] **One home-screen summary** replacing "here's all my data" with
      "here's what I should do next":
      > TODAY  $846 sales · $271 est. gross profit · 17 items sold · $4,810 cash tied up >90 days
      >
      > DO THESE 5 THINGS
      > → Send offers on 8 watched eBay items
      > → Reprice Greninja
      > → Move 6 stale comics into tonight's Whatnot
      > → Reorder penny sleeves
      > → FOC closes tonight: 7 books need decisions

      Pulls from features above once they exist (Dead Inventory Radar,
      eBay watched-item offers, FOC Intelligence, restock suggestions) —
      likely the LAST thing to build, since it's a rollup of everything
      else rather than its own data source.
