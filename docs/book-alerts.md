# Book alerts

Article readers can choose one email for a specific title and issue: preorder
opening, cutoff within 48 hours, or stock availability. The existing six-hour
Worker cron checks subscriptions. This does not enroll historical staff
requests or add anyone to a newsletter. Duplicate signups remain one request;
an anonymous signup cannot reactivate an unsubscribed or completed request.

`POST /public/book-alerts` accepts `storeId`, `book`, `event`, `contactEmail`,
and boolean `consent:true`. Events: `preorder_open`, `preorder_cutoff`, `in_stock`.
The public form is rate limited and uses service-role writes. Subscriber data
and the claim RPC are inaccessible to anonymous and authenticated clients.

The sender reuses the existing Twilio Email configuration. Every send requires
a current opt-out check, complete store mailing address, valid unsubscribe
token, exact catalog title/issue match and an atomic delivery claim. The
unsubscribe link shows a confirmation form; POST cancels only that alert, so
mail scanners cannot silently unsubscribe readers by fetching the link.
Existing global email opt-outs are also honored.

Delivery monitoring (authorized service-role/admin access only):

```sql
select status, count(*) from public.book_alert_subscriptions group by status;
select id, event, book, last_error, lease_until
from public.book_alert_subscriptions
where status in ('sending','failed');
```

`checking` leases expire after ten minutes and can be reclaimed. `sending`
is deliberately never reclaimed: a timeout or crash may happen after Twilio
accepts a message. Review provider delivery logs before considering a manual
retry. The scheduler logs aggregate counts and subscription IDs, not email
addresses or unsubscribe tokens. Pre-send failures defer six hours.

The sweep claims at most 100 oldest due subscriptions per run. Watch backlog
age as usage grows; increase processing frequency or move delivery to a queue
before a large backlog prevents cutoff reminders from arriving in time.

Verification: `npm run test:book-alerts`, article tests, and deployment gates.
Migration: `supabase-migrations/2026-10-02-book-alerts.sql`.
