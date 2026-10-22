-- Consignment payouts on online sales split what's left after the
-- marketplace's fees (eBay, Whatnot): the store asked how it should be,
-- and on Goblin Storm (eBay, $445.50, $60.78 in eBay fees, 33% store) the
-- store paid the whole fee out of its cut and kept about 19%. A register
-- sale has no fee (0) and still splits the full price. Sales recorded
-- before this keep 0, so their payouts don't change after the fact.

alter table public.consignment_items add column if not exists marketplace_fee numeric not null default 0;
