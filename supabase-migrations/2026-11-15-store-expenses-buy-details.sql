-- TRADES & BUYS PER SHOW (store, 2026-11-15: "what you took in on trades/buys -- how many cards and their market value;
-- what you gave for them, in trade credit and cash; the gain"). A customer buy or trade-in is recorded in Costs as an
-- 'inventory' entry; these details ride along so each show can list what came in:
--   { "cards": 42, "market": 350.25, "paid": "trade" | "cash", "method": "Trade-in" }
-- The show itself is the existing show_session_id. Nothing here changes profit: a trade's gain sits in inventory until
-- the cards sell (each sale's profit is its price minus what was paid for the card).
alter table public.store_expenses add column if not exists details jsonb;
