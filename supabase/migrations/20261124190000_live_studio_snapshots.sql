-- A read-only copy of each store's Live Studio state (dungeon plan, chests, stretch goals, settings), refreshed every
-- 10 minutes by the Worker (scripts/live-studio-mirror.mjs), so it can be looked up outside the studio. Service role only.
create table if not exists public.live_studio_snapshots (
  store_id uuid primary key,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.live_studio_snapshots enable row level security;
-- grants: service_role only live_studio_snapshots
revoke all on public.live_studio_snapshots from anon, authenticated;
grant select, insert, update, delete on public.live_studio_snapshots to service_role;
