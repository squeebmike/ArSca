-- Explicit, one-shot subscriptions. Old staff requests are not enrolled.
create table public.book_alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 200),
  book text not null check (length(book) between 2 and 200),
  book_key text not null,
  event text not null check (event in ('preorder_open','preorder_cutoff','in_stock')),
  status text not null default 'active' check (status in ('active','checking','sending','sent','unsubscribed','failed')),
  consent_at timestamptz not null default now(),
  consent_version text not null default 'book-alert-v1',
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  next_check_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(store_id,email,book_key,event)
);
alter table public.book_alert_subscriptions enable row level security;
revoke all on public.book_alert_subscriptions from anon, authenticated;
grant all on public.book_alert_subscriptions to service_role;
create index book_alert_due on public.book_alert_subscriptions(next_check_at)
  where status in ('active','checking');

-- Atomic, bounded work claims. Only pre-send checks can be reclaimed.
-- An ambiguous email send stays 'sending' for staff investigation, never
-- automatically retried: the provider may already have accepted it.
create function public.claim_book_alerts(batch_size integer default 50)
returns setof public.book_alert_subscriptions language sql security invoker
set search_path = public as $$
  with due as (
    select id from public.book_alert_subscriptions
    where (status = 'active' and next_check_at <= now())
       or (status = 'checking' and lease_until < now())
    order by next_check_at, id
    limit greatest(1, least(batch_size,100)) for update skip locked
  )
  update public.book_alert_subscriptions s
    set status='checking', lease_token=gen_random_uuid(), lease_until=now()+interval '10 minutes'
    from due where s.id=due.id returning s.*;
$$;
revoke all on function public.claim_book_alerts(integer) from public,anon,authenticated;
grant execute on function public.claim_book_alerts(integer) to service_role;
