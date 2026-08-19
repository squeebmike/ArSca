-- Free "get notified" list for /fan-club, replacing three dead paid-pledge
-- forms (Supporter, Patron, one-time) that had no backend and no frontend
-- handler behind any of them. unsubscribe_token backs the CAN-SPAM
-- unsubscribe link every email to this list must carry.

create table if not exists public.fan_club_subscribers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  email text not null,
  source text not null default 'fan-club-page',
  subscribed_at timestamptz not null default now(),
  unsubscribed boolean not null default false,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create unique index if not exists fan_club_subscribers_store_email_key
  on public.fan_club_subscribers (store_id, lower(email));

create index if not exists fan_club_subscribers_unsubscribe_token_idx
  on public.fan_club_subscribers (unsubscribe_token);
