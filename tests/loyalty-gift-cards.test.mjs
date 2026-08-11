import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-10-customers-loyalty-gift-cards.sql', 'utf8');

// Migration: tables + atomic balance mutators exist.
for (const table of ['customers', 'loyalty_ledger', 'gift_cards', 'gift_card_transactions']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `migration missing ${table} table`);
}
for (const fn of ['accrue_loyalty_points', 'redeem_loyalty_points', 'redeem_gift_card']) {
  assert.match(migration, new RegExp(`create or replace function public\\.${fn}`), `migration missing ${fn} function`);
}
assert.match(migration, /for update/, 'redeem functions must lock the row to prevent double-spend races');

// pos_sales.id is text (client-generated ids aren't always UUID-shaped --
// see 2026-07-14-atomic-pos-sale.sql), so anything referencing it must be
// text too or the FK constraint fails to create at all (42804).
assert.doesNotMatch(migration, /sale_id uuid references public\.pos_sales/, 'sale_id FK must be text, not uuid -- pos_sales.id is text');
assert.match(migration, /sale_id text references public\.pos_sales\(id\)/, 'loyalty_ledger.sale_id must be text');
assert.match(migration, /issued_sale_id text references public\.pos_sales\(id\)/, 'gift_cards.issued_sale_id must be text');
assert.match(migration, /p_sale_id text/, 'RPC p_sale_id parameters must be text to match pos_sales.id');

// Customers panel is Supabase-backed, not localStorage-only.
assert.match(dashboard, /function loadCustomersFromSupabase/, 'customers must load from Supabase');
assert.match(dashboard, /async function upsertCustomer/, 'customer upsert must be async (writes to Supabase)');
assert.match(dashboard, /sb\.from\('customers'\)\.upsert\(entry, \{ onConflict:'id' \}\)/, 'customer save must upsert to the customers table');
assert.match(dashboard, /customers_cache_v1/, 'customers cache key must exist for store-scoped local-first reads');

// loyaltyRate is a configurable Settings value, not hardcoded.
assert.match(dashboard, /loyaltyRate:3,/, 'loyaltyRate must default to 3%');
assert.match(dashboard, /function getLoyaltyRate/, 'must have a getter for the configured loyalty rate');
assert.match(dashboard, /vendorInput\('loyaltyRate','Loyalty pts % of \$',p\.loyaltyRate,'number'\)/, 'loyalty rate must be editable in Settings');

// Accrual happens at checkout, tied to the sale.
assert.match(dashboard, /async function accrueLoyaltyForContact/, 'loyalty accrual function must exist');
assert.match(dashboard, /accrueLoyaltyForContact\(phone, '', confirmedSaleContext\.sale\.id, confirmedSaleContext\.sale\.total\)/, 'accrual must fire from the receipt-capture step with the real sale id/total');
assert.match(dashboard, /sb\.rpc\('accrue_loyalty_points'/, 'accrual must call the atomic RPC, not a plain balance update');

// Redemption is a real tender line, not a silent discount.
assert.match(dashboard, /LOYALTY_POINTS_PER_DOLLAR/, 'redemption needs a fixed points-to-dollar conversion');
assert.match(dashboard, /function applyLoyaltyRedemption/, 'redemption apply function must exist');
assert.match(dashboard, /method:'loyalty_redeem'/, 'redemption must produce a loyalty_redeem tender line');
assert.match(dashboard, /sb\.rpc\('redeem_loyalty_points'/, 'redemption commit must call the atomic RPC');
assert.match(dashboard, /\['trade_credit','loyalty_redeem','gift_card'\]\.includes\(t\.method\)/, 'confirmLockedPayment must carry forward loyalty/gift-card tenders already applied, not just trade credit');

// Offline durability: both accrual and redemption survive a dropped connection.
assert.match(dashboard, /item\.type === 'loyalty-accrual'/, 'loyalty accrual must be replayable from the offline sync queue');
assert.match(dashboard, /item\.type === 'loyalty-redeem-commit'/, 'loyalty redemption commit must be replayable from the offline sync queue');

// Gift cards: generated only at sale time (never pre-printed with an exposed
// code), rendered as both a scannable code and human-readable text, spend
// tracked server-side via the atomic RPC.
assert.match(dashboard, /function generateGiftCardCode/, 'gift card code generator must exist');
assert.match(dashboard, /function confirmGiftCardSell/, 'gift card sell flow must exist');
assert.match(dashboard, /async function issueGiftCardsFromSaleLines/, 'gift cards must only be issued after the sale actually commits');
assert.match(dashboard, /sb\.from\('gift_cards'\)\.insert\(record\)/, 'gift card issuance must write to the gift_cards table');
assert.match(dashboard, /function showIssuedGiftCardsModal/, 'issued gift card code must be shown to staff (QR + text)');
assert.match(dashboard, /api\.qrserver\.com\/v1\/create-qr-code/, 'issued gift card must render a scannable code, not just text');
assert.match(dashboard, /function lookupGiftCardBalanceForRedeem/, 'gift card redemption lookup must exist');
assert.match(dashboard, /function applyGiftCardRedemption/, 'gift card redemption apply function must exist');
assert.match(dashboard, /method:'gift_card'/, 'redemption must produce a gift_card tender line');
assert.match(dashboard, /sb\.rpc\('redeem_gift_card'/, 'gift card redemption commit must call the atomic RPC');
assert.match(dashboard, /item\.type === 'gift-card-issue'/, 'gift card issuance must be replayable from the offline sync queue');
assert.match(dashboard, /item\.type === 'gift-card-redeem-commit'/, 'gift card redemption commit must be replayable from the offline sync queue');

console.log('Loyalty + gift card contract checks passed');
