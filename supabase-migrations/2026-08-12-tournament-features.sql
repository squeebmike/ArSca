-- Tournament feature expansion: check-in, top-cut bracket, prize/payout
-- tracking, series/season grouping.
-- Run after 2026-08-11-tournament-events.sql.
--
-- All additions are nullable/defaulted so existing events/registrations/
-- matches created before this migration keep working unchanged.

alter table public.event_registrations add column if not exists checked_in boolean not null default false;
alter table public.event_registrations add column if not exists prize_amount numeric(12,2) not null default 0;

alter table public.events add column if not exists top_cut_size integer;
alter table public.events add column if not exists series_name text;

-- stage distinguishes Swiss rounds from the single-elimination bracket that
-- can follow them; bracket_slot is the match's position within its bracket
-- round, used to compute who plays whom in the next round (slot 2k and
-- slot 2k+1's winners meet at slot k next round).
alter table public.event_matches add column if not exists stage text not null default 'swiss';
alter table public.event_matches add column if not exists bracket_slot integer;

create index if not exists idx_events_series on public.events(store_id, series_name) where series_name is not null;
