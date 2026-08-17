# Comic FOC preorders and live shipping

## Weekly preorder workflow

1. Open **More → Comics / FOC** in the dashboard.
2. Upload the current PRH FOC CSV or XLSX file.
3. Review the exact-cover wall. Standard covers are available for paid preorder; ratio incentives remain request-only until a secured quantity is entered.
4. Adjust customer price, store quantity, secured incentive quantity, heat, or notes as needed.
5. Keep the cycle open through **12:01 AM Monday, America/Los_Angeles**. The database creates that cutoff automatically from the PRH FOC date.
6. On Monday, close the cycle and export the PRH order CSV. The export combines paid customer quantities with store quantities and uses exact UPCs.

Customers use `/preorders`, pay for regular exact covers through Stripe, and can review or cancel their orders before the cutoff. An unsecured ratio-cover request never charges the customer.

## Shippo setup

Real carrier quotes require both a secret token and a complete ship-from address.

1. Create a Shippo account and connect the carriers you want to offer.
2. Copy a Shippo test token first. It begins with `shippo_test_`.
3. Store it as the Cloudflare Worker secret `SHIPPO_API_TOKEN`. Never paste this token into Webflow or client-side JavaScript.
4. In the dashboard's shipping settings, save the ship-from business name, street address, city, state, ZIP, phone, and email.
5. Save the default parcel dimensions and weight.
6. Place a test order to a real deliverable address and confirm that the displayed carrier/service/price matches Shippo.
7. Replace the test token with a `shippo_live_` token and repeat one low-value production test.

The preorder checkout refuses to invent a shipping price: a customer must request and select a current Shippo rate before payment. The older Webflow cart is temporarily pickup-only until its separate checkout Worker is moved to the same verified quote flow, preventing the obsolete `$3/$7` estimate from being charged.

## Operations and safety

- Re-importing the same PRH file is idempotent.
- Existing store quantities, secured quantities, customer pricing, and enable/disable choices are preserved on later catalog imports unless staff changes them.
- Exact identifiers stay strings so 13- and 17-digit UPC/ISBN values are never rounded.
- The public browser only receives publishable Supabase credentials. Service-role and Shippo credentials stay in the Worker.
- Paid orders are linked to the authenticated customer and Stripe PaymentIntent.

