-- Loupe's COMPARE TO REAL CARD (scripts/card-compare.js): after a compare,
-- staff tap REAL / FAKE / NOT SURE, and the compare's scores are kept with
-- the answer so its thresholds can be tuned from real cards. Written only
-- by the Worker (/card-compare/feedback) with the service role.
-- grants: service_role only card_compare_feedback
create table if not exists public.card_compare_feedback (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  answer text not null check (answer in ('real', 'fake', 'unsure')),
  card jsonb not null default '{}'::jsonb,
  verdict text,
  overall numeric,
  zones jsonb not null default '[]'::jsonb,
  app_version text
);
create index if not exists card_compare_feedback_store_created_idx on public.card_compare_feedback (store_id, created_at desc);
alter table public.card_compare_feedback enable row level security;
grant select, insert, update, delete on public.card_compare_feedback to service_role;
