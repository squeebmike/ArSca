-- Store report: "these owner-level tasks aren't daily, they're weekly,
-- monthly, quarterly, or yearly -- and right now every task in the
-- checklist behaves like it resets every single day." daily_task_items
-- only ever understood one recurrence shape: days_of_week, which repeats
-- identically every 7 days. That's the right model for "every day" and
-- "every Monday", but "end of month", "once a quarter", and "once a year"
-- don't fit a weekday pattern at all.
--
-- Adds an explicit cadence to each task instead of inventing a second,
-- parallel scheduling table. 'daily' and 'weekly' keep using days_of_week
-- exactly as before -- this is purely additive for existing rows (default
-- 'daily' matches how every current row already behaves: due again each
-- time its days_of_week matches). 'monthly'/'quarterly'/'yearly' tasks
-- ignore days_of_week; the backend (scripts/daily-tasks.mjs) instead
-- checks daily_task_completions for ANY completion inside the task's
-- current calendar period (month/quarter/year) -- present means done for
-- the period (and the task drops off today's list, same "goes away" model
-- as a daily task), absent means still due, and a period that rolled over
-- with zero completions is surfaced as overdue.
alter table public.daily_task_items
  add column if not exists cadence text not null default 'daily';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_task_items_cadence_check'
  ) then
    alter table public.daily_task_items
      add constraint daily_task_items_cadence_check
      check (cadence in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly'));
  end if;
end $$;

-- Store report: "reassigning a task to cover for someone should be a
-- one-tap swap for just today, not a permanent handoff." Until now the
-- only reassignment was permanent (daily_task_items.assigned_to_user_id --
-- see 2026-09-09-daily-task-assignment.sql), which is right for "this is
-- just Sean's task now" but wrong for "Sean's out today, Jaccob's covering
-- it" -- that shouldn't quietly change who owns the task every day after.
-- A same-day-only override table keeps the permanent default untouched:
-- the read path in daily-tasks.mjs checks for a row here first (today's
-- cover), falling back to the item's own default assignee when none
-- exists. Deleting the row (userId not provided) reverts to the default
-- for that date.
create table if not exists public.daily_task_overrides (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  task_id uuid not null references public.daily_task_items(id) on delete cascade,
  task_date date not null,
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  assigned_to_label text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (task_id, task_date)
);

create index if not exists daily_task_overrides_store_date
  on public.daily_task_overrides (store_id, task_date);

alter table public.daily_task_overrides enable row level security;

drop policy if exists daily_task_overrides_select_member on public.daily_task_overrides;
create policy daily_task_overrides_select_member on public.daily_task_overrides
  for select using (public.is_store_member(store_id));

-- Same permission floor as checking a task off (daily_task_completions):
-- any working staff member can cover a task for the day, not just
-- owner/admin/manager.
drop policy if exists daily_task_overrides_write_member on public.daily_task_overrides;
create policy daily_task_overrides_write_member on public.daily_task_overrides
  for all using (public.can_sell_or_scan(store_id)) with check (public.can_sell_or_scan(store_id));
