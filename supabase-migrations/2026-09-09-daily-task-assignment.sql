-- Store report: "who completed it, who is assigned to" -- a task was only
-- ever scoped to a role (any staff in that role could do it), with no way
-- to name a specific person as the one responsible for it. Adds an
-- optional per-task assignee; leaving it unset keeps today's "any staff in
-- this role" behavior exactly as-is, it's purely additive.
--
-- assigned_to_label is denormalized (captured at assign time) rather than
-- always joining store_members/auth.users on read -- same reasoning as
-- comic_skus.variant_label elsewhere in this app: the checklist read path
-- runs on every tab load and shouldn't need an extra round trip just to
-- show a name that essentially never changes mid-day.
alter table public.daily_task_items
  add column if not exists assigned_to_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to_label text;

create index if not exists daily_task_items_assigned_to
  on public.daily_task_items (assigned_to_user_id) where assigned_to_user_id is not null;
