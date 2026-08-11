-- Lets a pull list series remember which Metron series it was matched to,
-- so "find upcoming issues" doesn't have to re-run the name search (and
-- re-risk picking the wrong series among reboots/relaunches) every time.
-- Run after 2026-08-12-pull-lists.sql.

alter table public.pull_list_series add column if not exists metron_series_id text;
