-- SMS/A2P 10DLC compliance: consent + opt-out tracking.
--
-- Prior state (found during a compliance audit ahead of a Twilio campaign
-- resubmission): no table anywhere recorded whether a customer had agreed to
-- receive texts, or whether they had ever texted STOP. Every outbound SMS
-- path (staff free-text, want-list back-in-stock alerts, the inbound-webhook
-- relay) sent unconditionally to whatever phone-shaped string it was given.
-- storefront.html/buylist.html already rendered a fully-worded consent
-- checkbox, but its checked value was never read, sent, or stored anywhere
-- -- the disclosure was shown, but the answer was thrown away.
--
-- This adds the columns that let both halves of that gap close: capturing
-- consent at collection time, and honoring STOP at send time.

alter table public.customers add column if not exists sms_consent boolean not null default false;
alter table public.customers add column if not exists sms_consent_at timestamptz;
alter table public.customers add column if not exists sms_opted_out boolean not null default false;
alter table public.customers add column if not exists sms_opted_out_at timestamptz;

alter table public.storefront_orders add column if not exists sms_consent boolean not null default false;
alter table public.buylist_submissions add column if not exists sms_consent boolean not null default false;
