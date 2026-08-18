-- Phone system milestone two: voicemail and business-hours-aware call
-- routing, plus the settings table that drives both.
--
-- phone_settings is a singleton row per store (unique on store_id) --
-- there's exactly one ring-group config per shop, not one per user, so this
-- deliberately does NOT follow phone_endpoints' per-user shape.
--
-- business_hours is stored as jsonb keyed by lowercase three-letter weekday
-- (mon/tue/wed/thu/fri/sat/sun), each value {open:'HH:MM', close:'HH:MM',
-- closed:boolean}. An empty/null business_hours object means "always open"
-- -- this is the milestone-one behavior, preserved as the default so a store
-- that never visits the new settings panel sees no change at all.
--
-- Deliberately no new granular permission strings, matching phone-system.sql:
-- settings are gated owner/admin (Worker-side, same requireStoreUser()
-- pattern) since ring-group/voicemail config is a store-policy decision, not
-- a per-employee one -- while calls/messages/voicemails stay readable by the
-- same operational roles as the rest of the phone system.

create table if not exists public.phone_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  voicemail_enabled boolean not null default true,
  -- Played before <Record> when a caller is being sent to voicemail
  -- (after-hours, or nobody answered the ring group).
  greeting_message text,
  -- Played (with no <Record> after it) when after-hours and voicemail is
  -- turned off.
  closed_message text,
  business_hours jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_phone_settings_store on public.phone_settings(store_id);

create table if not exists public.voicemails (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  call_sid text,
  from_number text,
  to_number text,
  -- Twilio's Recording resource SID -- the audio itself stays hosted on
  -- Twilio (fetched through the Worker's own Basic-Auth proxy route at
  -- playback time, same credentials sendSms() already uses), never mirrored
  -- into Supabase storage.
  recording_sid text,
  recording_url text,
  duration_seconds integer,
  heard boolean not null default false,
  customer_id uuid references public.customers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_voicemails_store_created on public.voicemails(store_id, created_at desc);
create index if not exists idx_voicemails_customer on public.voicemails(customer_id) where customer_id is not null;

alter table public.phone_settings enable row level security;
alter table public.voicemails enable row level security;

drop policy if exists phone_settings_select_member on public.phone_settings;
create policy phone_settings_select_member on public.phone_settings for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists voicemails_select_member on public.voicemails;
create policy voicemails_select_member on public.voicemails for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

-- Both tables are written server-side only (the Worker's service-role key,
-- which bypasses RLS) -- no insert/update policy for dashboard clients,
-- matching calls/messages in phone-system.sql. phone_settings writes are
-- additionally owner/admin-gated at the Worker route level even though the
-- service-role key itself has no such restriction.
