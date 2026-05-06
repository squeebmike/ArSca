-- Walk-Off Card & Comic Dealer OS
-- Supabase Auth + Store Workspace Schema + RLS
-- Version: 2026.05.06.1
--
-- Paste this whole file into Supabase SQL Editor and run it once.
-- Safe to rerun: uses IF NOT EXISTS / CREATE OR REPLACE where practical.
--
-- IMPORTANT:
-- - Use only the Supabase project URL + anon/publishable key in frontend code.
-- - Never put the service_role key in dashboard.html or sca.html.
-- - RLS is enabled on every app table below.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'store_role') then
    create type public.store_role as enum ('owner','admin','manager','employee','scanner_only');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'store_status') then
    create type public.store_status as enum ('active','disabled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_session_status') then
    create type public.scan_session_status as enum ('active','closed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_queue_status') then
    create type public.scan_queue_status as enum ('pending','reviewed','rejected','added');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text not null,
  logo_url text,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'America/Los_Angeles',
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  status public.store_status not null default 'active'
);

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.store_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(store_id, user_id)
);

create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  payment_settings jsonb not null default '{}'::jsonb,
  modules jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  receipt_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'in_stock',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  payment_type text,
  totals jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  device_name text,
  created_by uuid references auth.users(id) on delete set null,
  status public.scan_session_status not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.scan_queue (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  session_id uuid references public.scan_sessions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status public.scan_queue_status not null default 'pending',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null,
  role public.store_role not null default 'employee',
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  unique(store_id, email)
);

create index if not exists idx_store_members_user on public.store_members(user_id, active);
create index if not exists idx_store_members_store on public.store_members(store_id, active);
create index if not exists idx_inventory_items_store on public.inventory_items(store_id, status, updated_at desc);
create index if not exists idx_sales_store on public.sales(store_id, created_at desc);
create index if not exists idx_scan_sessions_store on public.scan_sessions(store_id, status, created_at desc);
create index if not exists idx_scan_queue_store on public.scan_queue(store_id, status, created_at desc);
create index if not exists idx_store_invites_email on public.store_invites(lower(email));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_store_settings_updated_at on public.store_settings;
create trigger trg_store_settings_updated_at
before update on public.store_settings
for each row execute function public.touch_updated_at();

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email,''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_store_member(check_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = check_store_id
      and sm.user_id = auth.uid()
      and sm.active = true
  );
$$;

create or replace function public.current_store_role(check_store_id uuid)
returns public.store_role
language sql
security definer
set search_path = public
stable
as $$
  select sm.role
  from public.store_members sm
  where sm.store_id = check_store_id
    and sm.user_id = auth.uid()
    and sm.active = true
  order by
    case sm.role
      when 'owner' then 1
      when 'admin' then 2
      when 'manager' then 3
      when 'employee' then 4
      when 'scanner_only' then 5
    end
  limit 1;
$$;

create or replace function public.can_manage_store(check_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_store_role(check_store_id) in ('owner','admin');
$$;

create or replace function public.can_sell_or_scan(check_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_store_role(check_store_id) in ('owner','admin','manager','employee','scanner_only');
$$;

create or replace function public.can_write_inventory(check_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_store_role(check_store_id) in ('owner','admin','manager');
$$;

create or replace function public.create_store_for_current_user(
  store_display_name text,
  store_name text default null
)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  created_store public.stores;
  normalized_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  normalized_name := coalesce(nullif(trim(store_name), ''), lower(regexp_replace(trim(store_display_name), '[^a-zA-Z0-9]+', '-', 'g')));
  normalized_name := trim(both '-' from normalized_name);
  if normalized_name = '' then
    normalized_name := 'store-' || substr(auth.uid()::text, 1, 8);
  end if;

  insert into public.stores (name, display_name, owner_user_id)
  values (normalized_name, coalesce(nullif(trim(store_display_name), ''), 'My Store'), auth.uid())
  returning * into created_store;

  insert into public.store_members (store_id, user_id, role, active)
  values (created_store.id, auth.uid(), 'owner', true)
  on conflict (store_id, user_id) do update set role = 'owner', active = true;

  insert into public.store_settings (store_id, payment_settings, modules, theme, receipt_settings)
  values (
    created_store.id,
    '{}'::jsonb,
    jsonb_build_object('inventorySource', 'built_in'),
    '{}'::jsonb,
    jsonb_build_object('storeName', created_store.display_name, 'footer', 'Thanks for shopping with us!')
  )
  on conflict (store_id) do nothing;

  return created_store;
end;
$$;

create or replace function public.invite_store_member(
  target_store_id uuid,
  target_email text,
  target_role public.store_role default 'employee'
)
returns public.store_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.store_invites;
begin
  if not public.can_manage_store(target_store_id) then
    raise exception 'Only owner/admin can invite members';
  end if;

  insert into public.store_invites (store_id, email, role, invited_by)
  values (target_store_id, lower(trim(target_email)), target_role, auth.uid())
  on conflict (store_id, email) do update
    set role = excluded.role,
        invited_by = auth.uid(),
        accepted_by = null,
        accepted_at = null,
        expires_at = now() + interval '14 days'
  returning * into invite;

  return invite;
end;
$$;

create or replace function public.accept_store_invite(target_store_id uuid)
returns public.store_members
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.store_invites;
  member public.store_members;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select lower(email) into user_email from auth.users where id = auth.uid();

  select *
  into invite
  from public.store_invites
  where store_id = target_store_id
    and lower(email) = user_email
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if invite.id is null then
    raise exception 'No active invite for this user/store';
  end if;

  insert into public.store_members (store_id, user_id, role, active)
  values (invite.store_id, auth.uid(), invite.role, true)
  on conflict (store_id, user_id) do update set role = excluded.role, active = true
  returning * into member;

  update public.store_invites
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invite.id;

  return member;
end;
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.store_settings enable row level security;
alter table public.inventory_items enable row level security;
alter table public.sales enable row level security;
alter table public.scan_sessions enable row level security;
alter table public.scan_queue enable row level security;
alter table public.store_invites enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select using (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists stores_select_member on public.stores;
create policy stores_select_member on public.stores for select using (public.is_store_member(id));

drop policy if exists stores_insert_self_owner on public.stores;
create policy stores_insert_self_owner on public.stores for insert with check (owner_user_id = auth.uid());

drop policy if exists stores_update_owner_admin on public.stores;
create policy stores_update_owner_admin on public.stores for update using (public.can_manage_store(id)) with check (public.can_manage_store(id));

drop policy if exists store_members_select_member on public.store_members;
create policy store_members_select_member on public.store_members for select using (public.is_store_member(store_id));

drop policy if exists store_members_insert_owner_admin on public.store_members;
create policy store_members_insert_owner_admin on public.store_members for insert with check (public.can_manage_store(store_id));

drop policy if exists store_members_update_owner_admin on public.store_members;
create policy store_members_update_owner_admin on public.store_members for update using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));

drop policy if exists store_members_delete_owner_admin on public.store_members;
create policy store_members_delete_owner_admin on public.store_members for delete using (public.can_manage_store(store_id));

drop policy if exists store_settings_select_member on public.store_settings;
create policy store_settings_select_member on public.store_settings for select using (public.is_store_member(store_id));

drop policy if exists store_settings_insert_owner_admin on public.store_settings;
create policy store_settings_insert_owner_admin on public.store_settings for insert with check (public.can_manage_store(store_id));

drop policy if exists store_settings_update_owner_admin on public.store_settings;
create policy store_settings_update_owner_admin on public.store_settings for update using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));

drop policy if exists inventory_items_select_member_not_scanner on public.inventory_items;
create policy inventory_items_select_member_not_scanner on public.inventory_items for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists inventory_items_insert_manager on public.inventory_items;
create policy inventory_items_insert_manager on public.inventory_items for insert with check (public.can_write_inventory(store_id));

drop policy if exists inventory_items_update_manager on public.inventory_items;
create policy inventory_items_update_manager on public.inventory_items for update using (public.can_write_inventory(store_id)) with check (public.can_write_inventory(store_id));

drop policy if exists inventory_items_delete_owner_admin on public.inventory_items;
create policy inventory_items_delete_owner_admin on public.inventory_items for delete using (public.can_manage_store(store_id));

drop policy if exists sales_select_member_not_scanner on public.sales;
create policy sales_select_member_not_scanner on public.sales for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists sales_insert_employee on public.sales;
create policy sales_insert_employee on public.sales for insert with check (
  public.current_store_role(store_id) in ('owner','admin','manager','employee')
  and created_by = auth.uid()
);

drop policy if exists scan_sessions_select_member on public.scan_sessions;
create policy scan_sessions_select_member on public.scan_sessions for select using (public.is_store_member(store_id));

drop policy if exists scan_sessions_insert_scanner on public.scan_sessions;
create policy scan_sessions_insert_scanner on public.scan_sessions for insert with check (public.can_sell_or_scan(store_id) and created_by = auth.uid());

drop policy if exists scan_sessions_update_creator_or_manager on public.scan_sessions;
create policy scan_sessions_update_creator_or_manager on public.scan_sessions for update using (
  public.current_store_role(store_id) in ('owner','admin','manager')
  or created_by = auth.uid()
) with check (
  public.current_store_role(store_id) in ('owner','admin','manager')
  or created_by = auth.uid()
);

drop policy if exists scan_queue_select_member_limited on public.scan_queue;
create policy scan_queue_select_member_limited on public.scan_queue for select using (
  public.current_store_role(store_id) in ('owner','admin','manager','employee')
  or created_by = auth.uid()
);

drop policy if exists scan_queue_insert_scanner on public.scan_queue;
create policy scan_queue_insert_scanner on public.scan_queue for insert with check (public.can_sell_or_scan(store_id) and created_by = auth.uid());

drop policy if exists scan_queue_update_employee on public.scan_queue;
create policy scan_queue_update_employee on public.scan_queue for update using (
  public.current_store_role(store_id) in ('owner','admin','manager','employee')
  or created_by = auth.uid()
) with check (
  public.current_store_role(store_id) in ('owner','admin','manager','employee')
  or created_by = auth.uid()
);

drop policy if exists store_invites_select_owner_admin_or_self on public.store_invites;
create policy store_invites_select_owner_admin_or_self on public.store_invites for select using (
  public.can_manage_store(store_id)
  or lower(email) = lower(coalesce((select au.email from auth.users au where au.id = auth.uid()), ''))
);

drop policy if exists store_invites_insert_owner_admin on public.store_invites;
create policy store_invites_insert_owner_admin on public.store_invites for insert with check (public.can_manage_store(store_id));

drop policy if exists store_invites_update_owner_admin on public.store_invites;
create policy store_invites_update_owner_admin on public.store_invites for update using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.create_store_for_current_user(text, text) to authenticated;
grant execute on function public.invite_store_member(uuid, text, public.store_role) to authenticated;
grant execute on function public.accept_store_invite(uuid) to authenticated;

commit;

