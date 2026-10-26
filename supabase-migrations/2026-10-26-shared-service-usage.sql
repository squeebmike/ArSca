-- Another store's use of The Mana Pocket's paid services (second-store
-- pilot, 2026-10-26).
--
-- Store decision: pilot stores may use the AI (Anthropic), CardSight,
-- SoldComps and PSA lookups on your accounts. Store ask: "Can we keep track
-- of the usage from the other store?" The Worker writes one row per
-- successful call made for a store other than The Mana Pocket (never for
-- yours): which service, which route, and for Anthropic the model and the
-- tokens it charged for (scripts/shared-service-usage.mjs). The admin page's
-- Features tab reads shared_service_usage_summary(). Rows are kept so past
-- months can be billed back.

-- grants: service_role only shared_service_usage
create table if not exists public.shared_service_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  store_id uuid not null references public.stores(id) on delete cascade,
  service text not null,
  route text not null default '',
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  status integer not null default 0
);
create index if not exists shared_service_usage_store_at_idx on public.shared_service_usage (store_id, at);
alter table public.shared_service_usage enable row level security;
revoke all on public.shared_service_usage from public, anon, authenticated;
grant select, insert, delete on public.shared_service_usage to service_role;
grant usage, select on sequence public.shared_service_usage_id_seq to service_role;

-- One store's usage since p_since: by service, by service and model, by day
-- (Pacific) and calendar month (Pacific). Only the Worker runs it.
create or replace function public.shared_service_usage_summary(p_store_id uuid, p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'since', p_since,
    'byService', coalesce((select jsonb_agg(x order by x.calls desc) from (
        select service, model, count(*)::int as calls, sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens, max(at) as last_at
          from public.shared_service_usage where store_id = p_store_id and at >= p_since group by service, model) x), '[]'::jsonb),
    'byDay', coalesce((select jsonb_agg(x order by x.day desc) from (
        select (at at time zone 'America/Los_Angeles')::date as day, service, count(*)::int as calls, sum(input_tokens + output_tokens)::bigint as tokens
          from public.shared_service_usage where store_id = p_store_id and at >= p_since group by 1, 2) x), '[]'::jsonb),
    'byMonth', coalesce((select jsonb_agg(x order by x.month desc, x.service) from (
        select to_char(at at time zone 'America/Los_Angeles', 'YYYY-MM') as month, service, model, count(*)::int as calls, sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens
          from public.shared_service_usage where store_id = p_store_id group by 1, 2, 3) x), '[]'::jsonb)
  );
$$;
revoke all on function public.shared_service_usage_summary(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.shared_service_usage_summary(uuid, timestamptz) to service_role;
