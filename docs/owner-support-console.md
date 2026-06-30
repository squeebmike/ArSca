# Owner Support Console

The console is a separate protected surface at `admin.html`. It is intended for
cross-store troubleshooting and carefully audited corrections.

## Security model

- The browser signs in with a normal Supabase user session.
- The Cloudflare Worker validates that JWT with Supabase Auth.
- The Worker then verifies an active row in `platform_admins`.
- The Supabase service role remains a Worker secret and is never sent to the browser.
- Store, inventory, and member changes require a reason and write immutable before/after records to `platform_admin_audit_log`.
- Sales are read-only in this pass. The console does not impersonate store users.

## One-time setup

1. Run `supabase/platform-admin-support.sql` in the Supabase SQL Editor.
2. Run the bootstrap statement shown at the bottom of that file with the login email for the platform owner.
3. Confirm the Worker has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets.
4. Deploy the Worker and open `https://squeebmike.github.io/ArSca/admin.html`.

## Supported operations

- Search and inspect every store.
- Review store health counts and recent activity.
- Browse inventory, sales, members, and support audits.
- Edit allowlisted store metadata and status.
- Correct allowlisted inventory data with optimistic conflict detection.
- Change store-member role or active state.

Financial ledger rows and hard deletes are deliberately excluded from this first pass.
