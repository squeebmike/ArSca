-- Round timer + overtime settings for tournament events. Optional per event
-- (round_length_minutes null = no timer shown, matching how round_count
-- already works as an optional planning field). Run after
-- 2026-08-11-tournament-events.sql.
--
-- Overtime mode covers how different games actually handle time-up:
--   'none'          -- no formal overtime; TO calls it by house rules
--   'extra_turns'   -- Magic-style: N additional turns, tracked manually
--                       via round_timer_overtime_turn (not time-based)
--   'extra_minutes' -- Pokemon/Yu-Gi-Oh-style: a fixed extra minutes block
--
-- round_timer_state/started_at/elapsed_seconds form a single running clock:
-- elapsed_seconds accumulates whenever the timer is paused, and
-- started_at (when state = 'running') marks where the live count resumes
-- from -- the same start/accumulate pattern as a stopwatch, so pausing and
-- resuming doesn't lose or double-count time.

alter table public.events add column if not exists round_length_minutes integer;
alter table public.events add column if not exists round_overtime_mode text not null default 'none';
alter table public.events add column if not exists round_overtime_turns integer not null default 5;
alter table public.events add column if not exists round_overtime_minutes integer not null default 5;
alter table public.events add column if not exists round_timer_state text not null default 'idle';
alter table public.events add column if not exists round_timer_started_at timestamptz;
alter table public.events add column if not exists round_timer_elapsed_seconds integer not null default 0;
alter table public.events add column if not exists round_timer_overtime_turn integer not null default 0;
