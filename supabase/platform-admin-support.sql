-- Walk-Off platform support console. Safe to re-run in Supabase SQL Editor.
-- Browser sessions never receive the service role key; these tables are Worker-only.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'support' check (role in ('support', 'super_admin')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_store_id uuid references public.stores(id) on delete set null,
  entity_type text not null,
  entity_id text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_admin_audit_created
  on public.platform_admin_audit_log(created_at desc);
create index if not exists idx_platform_admin_audit_store
  on public.platform_admin_audit_log(target_store_id, created_at desc);

alter table public.platform_admins enable row level security;
alter table public.platform_admin_audit_log enable row level security;

-- Deliberately no authenticated/anonymous policies. The Worker uses its service
-- role only after verifying both the Supabase JWT and platform_admins record.
revoke all on public.platform_admins from anon, authenticated;
revoke all on public.platform_admin_audit_log from anon, authenticated;

-- One-time bootstrap (replace the email, then run separately):
-- insert into public.platform_admins (user_id, role, active)
-- select id, 'super_admin', true from auth.users
-- where lower(email) = lower('YOUR_LOGIN_EMAIL')
-- on conflict (user_id) do update set role = excluded.role, active = true;
