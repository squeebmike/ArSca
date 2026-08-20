-- These tables contain subscriber and notification contact details.
-- All reads and writes go through the Cloudflare Worker with the Supabase
-- service role, so browser roles must not have direct PostgREST access.

alter table public.fan_club_subscribers enable row level security;
alter table public.email_notify_contacts enable row level security;

revoke all on table public.fan_club_subscribers from anon, authenticated;
revoke all on table public.email_notify_contacts from anon, authenticated;
