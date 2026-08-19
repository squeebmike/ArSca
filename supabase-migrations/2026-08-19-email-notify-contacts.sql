-- CAN-SPAM compliance for the one path that sends promotional email
-- (sendContactNotification's email branch, used by the dashboard's
-- back-in-stock notifications and /notify/send): CAN-SPAM doesn't require
-- prior consent to email someone (unlike SMS/TCPA), but every message needs
-- a working unsubscribe and the sender's physical address, and opt-outs
-- must be honored.
--
-- Not tied to the customers table -- plenty of contacts on this path
-- (want-list entries, ad-hoc notify requests) never have a formal customer
-- record, so a row here is created on first send instead, giving every
-- email address a stable unsubscribe token and an opt-out flag checked
-- before every subsequent send.

create table if not exists public.email_notify_contacts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  email text not null,
  unsubscribe_token uuid not null default gen_random_uuid(),
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists email_notify_contacts_store_email_key
  on public.email_notify_contacts (store_id, lower(email));

create index if not exists email_notify_contacts_token_idx
  on public.email_notify_contacts (unsubscribe_token);
