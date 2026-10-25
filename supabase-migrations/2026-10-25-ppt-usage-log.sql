-- PokemonPriceTracker credit log (2026-10-25).
--
-- Store ask: "any way we can see what's using credits and when?" -- the
-- account went through its 20,000 daily credits by 8 AM with no way to tell
-- what spent them. The Worker writes one row per PPT call it makes (the
-- dashboard's lookups, the daily price sync, the public website pages, eBay
-- listing help): who asked, which route, the credits PPT says it charged
-- (X-API-Calls-Consumed) and the answer's status. Settings -> PRICING APIS
-- -> CREDIT USE reads ppt_usage_summary(). Rows older than 35 days are
-- deleted by the Worker's daily cleanup.

-- grants: service_role only ppt_usage_log
create table if not exists public.ppt_usage_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  store_id uuid,
  source text not null default 'unknown',
  route text not null default '',
  credits integer not null default 0,
  cards integer not null default 0,
  status integer not null default 0
);
create index if not exists ppt_usage_log_at_idx on public.ppt_usage_log (at);
alter table public.ppt_usage_log enable row level security;
revoke all on public.ppt_usage_log from public, anon, authenticated;
grant select, insert, delete on public.ppt_usage_log to service_role;
grant usage, select on sequence public.ppt_usage_log_id_seq to service_role;

-- Credits since p_since: totals, by source, by hour (Pacific), by day
-- (Pacific) and the latest calls. Only the Worker (service_role) runs it.
create or replace function public.ppt_usage_summary(p_since timestamptz, p_recent integer default 40)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'since', p_since,
    'credits', coalesce((select sum(credits) from public.ppt_usage_log where at >= p_since), 0),
    'calls', coalesce((select count(*) from public.ppt_usage_log where at >= p_since), 0),
    'bySource', coalesce((select jsonb_agg(x order by x.credits desc) from (
        select source, sum(credits)::int as credits, count(*)::int as calls, max(at) as last_at
          from public.ppt_usage_log where at >= p_since group by source) x), '[]'::jsonb),
    'byHour', coalesce((select jsonb_agg(x order by x.hour) from (
        select to_char(date_trunc('hour', at at time zone 'America/Los_Angeles'), 'YYYY-MM-DD HH24:00') as hour, sum(credits)::int as credits, count(*)::int as calls
          from public.ppt_usage_log where at >= p_since group by 1) x), '[]'::jsonb),
    'byDay', coalesce((select jsonb_agg(x order by x.day desc) from (
        select (at at time zone 'America/Los_Angeles')::date as day, sum(credits)::int as credits, count(*)::int as calls
          from public.ppt_usage_log where at >= now() - interval '30 days' group by 1) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x.at desc) from (
        select at, source, route, credits, cards, status
          from public.ppt_usage_log where at >= p_since order by at desc limit greatest(1, least(p_recent, 200))) x), '[]'::jsonb)
  );
$$;
revoke all on function public.ppt_usage_summary(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.ppt_usage_summary(timestamptz, integer) to service_role;
