-- Saved Shed Dungeon setups (store, 2026-11-24: "I want to be able to have you set up the dungeons. I tell you what's in
-- each chest each floor, the boss and stretch goals. You set it up, and then it's in the Whatnot show tab saved").
-- One row per setup: its name, the Whatnot show it's for (optional), and the plan (floors -> boss, room, reward,
-- chests; stretch goals). Read and written by the Worker only (service role); the remote loads one into Live Studio.
create table if not exists public.dungeon_setups (
  id text primary key,
  store_id uuid not null,
  name text not null,
  show_id text,
  show_title text,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dungeon_setups_store on public.dungeon_setups (store_id, updated_at desc);
alter table public.dungeon_setups enable row level security;
-- grants: service_role only dungeon_setups
revoke all on public.dungeon_setups from anon, authenticated;
grant select, insert, update, delete on public.dungeon_setups to service_role;
