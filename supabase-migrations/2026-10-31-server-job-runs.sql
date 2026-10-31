-- What each scheduled server job did on its last runs (2026-10-31: the
-- comic/sports PriceCharting sync ran without checking anything, and its
-- Cloudflare-side log wasn't readable). Written by the Worker with the
-- service key only; nothing in the app reads it.
create table if not exists public.server_job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  store_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb
);
create index if not exists server_job_runs_job_started on public.server_job_runs(job, started_at desc);
alter table public.server_job_runs enable row level security;
-- grants: service_role only server_job_runs
grant select, insert, update, delete on public.server_job_runs to service_role;
grant usage, select on sequence public.server_job_runs_id_seq to service_role;
