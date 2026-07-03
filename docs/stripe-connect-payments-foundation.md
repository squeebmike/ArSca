# Stripe Connect payments foundation

ArSca uses Stripe Connect direct charges for independent stores. A payment is created in the connected store's Stripe account using the `Stripe-Account` context. The store receives the sale proceeds, Stripe deducts its processing fee from that connected account when the account's fee payer is `account`, and ArSca receives only an optional application fee.

Live card payments are deliberately blocked unless the retrieved connected-account record reports `controller.fees.payer = account`. ArSca explicitly creates full-Dashboard connected accounts with that controller setting. This choice is made at account creation and cannot be silently changed later. Existing connected accounts must pass the same status check.

## Setup

Apply `supabase/stripe-connect-and-consignments.sql` after the existing workspace and POS-ledger migrations. Configure these Worker secrets/variables separately:

- `STRIPE_SECRET_KEY_TEST`
- `STRIPE_SECRET_KEY_LIVE`
- `STRIPE_WEBHOOK_SECRET_TEST`
- `STRIPE_WEBHOOK_SECRET_LIVE`
- `STRIPE_PUBLISHABLE_KEY_TEST`
- `STRIPE_PUBLISHABLE_KEY_LIVE`
- `STRIPE_PLATFORM_MODE` (`test` or `live`)
- `ARSCA_PLATFORM_FEE_ENABLED`
- `ARSCA_PLATFORM_FEE_PERCENT_BPS`
- `ARSCA_PLATFORM_FEE_FIXED_CENTS`

The legacy `STRIPE_WEBHOOK_SECRET` is accepted only as a compatibility fallback. New deployments should configure separate test and live endpoints/secrets. Subscribe the Connect webhook endpoint to `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.succeeded`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.closed`, and `account.updated`.

## Data handling and security

ArSca stores safe references and status only: connected-account ID, PaymentIntent/Charge/Refund IDs, mode, amounts, application fee, card brand/last four, and lifecycle status. Card numbers, CVC, bank/routing numbers, tax IDs, identity documents, Stripe secret keys, and webhook secrets are never stored in the browser or database.

All Connect, payment-status, PaymentIntent, and refund routes authenticate the Supabase session and verify active store membership. Onboarding and refunds require Owner/Admin. Payment amounts come from the server-side `pos_sales` row rather than the browser request. Stripe idempotency keys prevent repeated charge/refund actions. Webhooks fail closed without a valid signature and persist event IDs before processing.

## Store onboarding

Settings → Payments creates or reuses a full-Dashboard connected account and opens Stripe-hosted onboarding. Stripe collects bank, business, tax, and identity information. ArSca shows details-submitted, charges-enabled, payouts-enabled, requirements, disabled reason, fee-payer verification, and test/live mode. Full-Dashboard accounts use their normal Stripe sign-in; Express login links remain supported for pre-existing Express accounts.

The Settings information-architecture pass places these existing controls under **Checkout & Payments**. It does not alter onboarding, charge routing, fee-payer enforcement, webhook processing, or refund behavior.

## Checkout and manual tenders

Cash and Venmo/PayPal/Cash App QR flows remain manual-confirmed tenders. Stripe Card is provider-verified: ArSca persists a pending sale, the Worker validates its total, creates a direct-charge PaymentIntent, Stripe's Payment Element collects card data, and the sale finalizes only after a Worker status check returns `succeeded`. Declines, cancellation, processing states, and setup errors do not finalize inventory.

The existing Stripe-hosted QR option is retained as a compatibility payment choice. It is separate from the new verified in-app Connect card flow and should be migrated to Connect in a later cleanup pass before being used for connected-store live payments.

## Application fees

Application fees default to zero. When enabled, the Worker adds the configured fixed cents plus percentage basis points, capped below the sale total. The calculated amount is stored with the payment. Refunds default to `refund_application_fee=true`, which makes Stripe refund a proportional application fee for partial refunds and the full fee for full refunds.

## Refunds and inventory

Owner/Admin can issue full or partial refunds from recent Stripe payment history. The Worker validates store ownership, provider, successful status, and remaining refundable balance, then creates the refund in the original connected-account context. It does not use destination-charge `reverse_transfer` behavior.

Refund records are durable and idempotent. Optional restocking creates one `refund_restock` inventory movement per refund/sale line, protected by a unique constraint. Built-in Supabase inventory UUIDs are restored automatically; legacy Webflow/non-UUID inventory references remain recorded but require manual restocking.

Stripe generally does not return the original processing fee. The connected store remains responsible for Stripe's refund and negative-balance behavior.

## Test/live safety and limitations

Every connected account, payment, refund, and webhook event carries a mode. Test and live account IDs are stored separately. The UI displays a mode badge. Live charging cannot proceed until fee payer, onboarding, and charge capability checks pass.

This pass does not implement Stripe Terminal, reader pairing, Stripe Tax, payout reporting, subscription billing changes, automated surcharge logic, or dispute evidence tools. Disputes are status-only and should be handled in Stripe Dashboard.
