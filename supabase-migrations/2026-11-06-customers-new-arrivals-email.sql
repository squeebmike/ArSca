-- New-arrivals email list (store, 2026-11-06): a customer is on it when the
-- store adds them; the time is kept like sms_consent_at.
alter table public.customers add column if not exists new_arrivals_email boolean not null default false;
alter table public.customers add column if not exists new_arrivals_email_at timestamptz;
