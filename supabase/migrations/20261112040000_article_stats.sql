-- Article views and buy-box clicks, a row per article per day (2026-11-12:
-- "any way for me to see how many books get sold because of his articles?
-- In the dashboard... see views"). Written by the Worker only (service role).
create table if not exists public.article_stats (
  slug text not null,
  day date not null,
  views integer not null default 0,
  clicks integer not null default 0,
  primary key (slug, day)
);
alter table public.article_stats enable row level security;
-- grants: service_role only article_stats
revoke all on public.article_stats from anon, authenticated;
grant select, insert, update on public.article_stats to service_role;

create or replace function public.bump_article_stat(p_slug text, p_kind text)
returns void language sql security definer set search_path = public as $$
  insert into public.article_stats (slug, day, views, clicks)
  values (left(p_slug, 120), (now() at time zone 'America/Los_Angeles')::date,
          case when p_kind = 'view' then 1 else 0 end, case when p_kind = 'click' then 1 else 0 end)
  on conflict (slug, day) do update set
    views = article_stats.views + excluded.views,
    clicks = article_stats.clicks + excluded.clicks;
$$;
revoke all on function public.bump_article_stat(text, text) from public, anon, authenticated;
grant execute on function public.bump_article_stat(text, text) to service_role;
