-- Consignor Stripe Connect payouts: lets a consignor be paid their cut
-- automatically via a Stripe Transfer instead of only ever being marked
-- "paid" by hand (Venmo/check/cash off-app, unrecorded). Each consignor
-- gets their own Connect account (separate from the store's own connected
-- account in store_stripe_accounts) so money can be transferred directly
-- into it.

alter table public.consignor_people add column if not exists stripe_account_id text;
alter table public.consignor_people add column if not exists stripe_onboarding_status text not null default 'not_started';
alter table public.consignor_people add column if not exists stripe_transfers_enabled boolean not null default false;

alter table public.consignment_items add column if not exists stripe_transfer_id text;
alter table public.consignment_items add column if not exists paid_via text;

create index if not exists idx_consignor_people_stripe_account on public.consignor_people(stripe_account_id) where stripe_account_id is not null;
