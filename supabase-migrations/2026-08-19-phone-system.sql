-- Phone/SMS system milestone one: browser softphone ring-group target,
-- persisted call/message history, and the employee-approved-mobile number
-- used by "Call From My Phone" (server-derived only -- the browser never
-- supplies the bridge-back number, see cloudflare-worker-full.js).
--
-- Deliberately no call_legs table: Twilio's own <Dial action="..."> callback
-- already reports exactly one outcome per ring-all attempt (which single leg
-- answered, or none), so per-leg correlation to avoid duplicate missed-call
-- noise falls out of Twilio's own semantics -- no extra table needed for that.
--
-- Deliberately no phone.read/phone.call/phone.text/phone.admin granular
-- permissions: this app has no granular permission system anywhere (it's
-- role-based only -- owner/admin/manager/employee/scanner_only, checked via
-- requireStoreUser()). Gating phone routes by the same roles already used
-- for other operational routes matches the existing app, rather than
-- inventing a new permission model for one feature.

create table if not exists public.phone_endpoints (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Matches the identity string /api/phone/token issues in the Access
  -- Token's grant, and what /twilio/voice builds <Client> nouns from.
  identity text not null,
  -- Opt-in: whether this staff member's browser should be included as a
  -- ring-all target. An unregistered/offline <Client> leg just fails fast
  -- with no visible side effect, so this can safely stay on even when the
  -- browser tab is closed -- it only rings when the SDK is actually
  -- connected.
  enabled boolean not null default false,
  -- The employee's own mobile number for "Call From My Phone" -- set by the
  -- employee themselves, never supplied by the browser at call time. This is
  -- the toll-fraud guard: the bridge-back number is always server-looked-up
  -- from this column, never a client-supplied value.
  approved_mobile text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_phone_endpoints_unique on public.phone_endpoints(store_id, user_id);
create unique index if not exists idx_phone_endpoints_identity on public.phone_endpoints(identity);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  -- The parent/inbound leg's own CallSid, or the outbound call's CallSid for
  -- calls initiated from the dashboard.
  call_sid text not null unique,
  direction text not null default 'inbound',
  from_number text,
  to_number text,
  status text not null default 'ringing',
  -- 'answered'/'no-answer'/'busy'/'failed', from <Dial>'s DialCallStatus.
  dial_call_status text,
  customer_id uuid references public.customers(id) on delete set null,
  -- Who initiated (outbound) or is credited with answering (best-effort,
  -- only known for browser-answered legs), nullable otherwise.
  staff_user_id uuid references auth.users(id) on delete set null,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_calls_store_created on public.calls(store_id, created_at desc);
create index if not exists idx_calls_customer on public.calls(customer_id) where customer_id is not null;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  message_sid text unique,
  direction text not null default 'inbound',
  from_number text not null,
  to_number text not null,
  body text,
  media_urls jsonb not null default '[]'::jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  staff_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'received',
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_store_created on public.messages(store_id, created_at desc);
create index if not exists idx_messages_customer on public.messages(customer_id) where customer_id is not null;
-- Conversation-thread lookups group by the other party's number regardless
-- of direction (From on inbound, To on outbound).
create index if not exists idx_messages_store_from on public.messages(store_id, from_number);
create index if not exists idx_messages_store_to on public.messages(store_id, to_number);

alter table public.phone_endpoints enable row level security;
alter table public.calls enable row level security;
alter table public.messages enable row level security;

drop policy if exists phone_endpoints_select_member on public.phone_endpoints;
create policy phone_endpoints_select_member on public.phone_endpoints for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists phone_endpoints_insert_self on public.phone_endpoints;
create policy phone_endpoints_insert_self on public.phone_endpoints for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee') and user_id = auth.uid());
drop policy if exists phone_endpoints_update_self on public.phone_endpoints;
create policy phone_endpoints_update_self on public.phone_endpoints for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee') and user_id = auth.uid()) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee') and user_id = auth.uid());

drop policy if exists calls_select_member on public.calls;
create policy calls_select_member on public.calls for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

-- calls/messages are written server-side only (Twilio webhooks + the
-- Worker's own outbound routes, both using the service-role key, which
-- bypasses RLS) -- no insert/update policy for dashboard clients, matching
-- how every other webhook-fed table in this app is written.
