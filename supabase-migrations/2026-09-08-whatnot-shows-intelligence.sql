-- Whatnot live intelligence layer: adds buyer capture (Buyer Momentum /
-- The Bench / Repeat Buyer-Whale Dashboard need to know WHO bought what,
-- which nothing in the Whatnot sale-recording flow captured before now),
-- an experiment tag on the show itself (Show Experiment Engine -- compare
-- aggregate outcomes across shows tagged the same way, e.g. "$1-start" vs
-- "$5-start"), and a room-size snapshot (Audience-Size Logic -- gate which
-- tier of item gets pulled next based on how many people are actually
-- watching). Alters the tables from 2026-09-08-whatnot-shows.sql rather
-- than folding into that file, since it's already been applied/committed.

alter table public.whatnot_show_items add column if not exists buyer_customer_id uuid references public.customers(id) on delete set null;
alter table public.whatnot_show_items add column if not exists buyer_name text;

alter table public.whatnot_shows add column if not exists experiment_tag text;
alter table public.whatnot_shows add column if not exists peak_audience_size integer;
