import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleAccountRequest } from '../scripts/customer-account.mjs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-18-customer-web-accounts.sql', 'utf8');

assert.match(worker, /import \{ handleAccountRequest \} from '\.\/scripts\/customer-account\.mjs';/);
assert.match(worker, /handleAccountRequest\(request, env, url, \{/, 'the router must wire the new module in');
assert.match(worker, /sendSms, normalizePhoneDigits, lookupCustomerIdByPhone,/, 'the account routes need the existing SMS + phone-matching helpers, not new copies');
assert.match(migration, /alter table public\.pos_sales add column if not exists customer_id/, 'every sale needs a customer link for "purchases in store" to be queryable at all');
assert.match(migration, /alter table public\.customers add column if not exists trade_credit_balance/);
assert.match(migration, /create unique index if not exists idx_customers_linked_user[\s\S]+where linked_user_id is not null/, 'one web account must not be able to link two customer records in the same store');
assert.match(migration, /create or replace function public\.accrue_trade_credit/);
assert.match(migration, /create or replace function public\.redeem_trade_credit/);

function json(data, status = 200) { return { status, body:data }; }
function url(path, params = {}) {
  const u = new URL('https://example.com' + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}
function baseDeps(overrides = {}) {
  return {
    CORS:{}, json,
    requireAuthenticatedUser: async () => ({ user:{ id:'user-1', email:'jane@example.com' } }),
    readJsonWithLimit: async (request) => ({ data: request.__body || {} }),
    sendSms: async () => {},
    normalizePhoneDigits: (s) => String(s || '').replace(/\D/g, '').slice(-10),
    lookupCustomerIdByPhone: async () => null,
    supabaseAdminFetch: async () => { throw new Error('unexpected db call'); },
    ...overrides,
  };
}
function fakeRequest(body, method = 'GET') { return { __body:body, method }; }

async function run() {
  // Unauthenticated request must be rejected before touching the database.
  {
    let dbCalled = false;
    const deps = baseDeps({
      requireAuthenticatedUser: async () => ({ error: json({ ok:false, error:'not signed in' }, 401) }),
      supabaseAdminFetch: async () => { dbCalled = true; return { data:[] }; },
    });
    const res = await handleAccountRequest(fakeRequest({}), {}, url('/public/account/summary', { store_id:'store1' }), deps);
    assert.equal(res.status, 401);
    assert.equal(dbCalled, false, 'must never query the database before auth succeeds');
  }

  // start-verify: too-short phone number is rejected before any SMS spend.
  {
    let smsCalled = false;
    const deps = baseDeps({ sendSms: async () => { smsCalled = true; } });
    const res = await handleAccountRequest(fakeRequest({ storeId:'store1', phone:'12345' }, 'POST'), {}, url('/public/account/phone/start-verify'), deps);
    assert.equal(res.status, 400);
    assert.equal(smsCalled, false);
  }

  // start-verify: valid phone sends exactly one SMS and stores a hashed code (never the raw code).
  {
    let smsBody = '', inserted = null;
    const deps = baseDeps({
      supabaseAdminFetch: async (env, path, options) => {
        if (path.startsWith('phone_verifications?') && !options) return { data:[] }; // recent-code lookup
        if (path === 'phone_verifications' && options?.method === 'POST') { inserted = JSON.parse(options.body); return { data:[] }; }
        throw new Error('unexpected db call: ' + path);
      },
      sendSms: async (env, to, body) => { smsBody = body; },
    });
    const res = await handleAccountRequest(fakeRequest({ storeId:'store1', phone:'2065551234' }, 'POST'), {}, url('/public/account/phone/start-verify'), deps);
    assert.equal(res.status, 200);
    assert.match(smsBody, /\d{6}/, 'the SMS must contain a 6-digit code');
    assert.ok(inserted, 'a phone_verifications row must be inserted');
    assert.equal(inserted.code_hash.length, 64, 'the stored code must be a sha256 hex digest, not the plaintext code');
    assert.notEqual(inserted.code_hash, smsBody, 'the code must never be stored in plaintext');
  }

  // start-verify: resending within 60s of an unverified code is rate-limited.
  {
    const deps = baseDeps({
      supabaseAdminFetch: async (env, path) => {
        if (path.startsWith('phone_verifications?')) return { data:[{ created_at:new Date().toISOString() }] };
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({ storeId:'store1', phone:'2065551234' }, 'POST'), {}, url('/public/account/phone/start-verify'), deps);
    assert.equal(res.status, 429);
  }

  // confirm-verify: wrong code increments attempts and fails, without linking anything.
  {
    let patched = null;
    const deps = baseDeps({
      supabaseAdminFetch: async (env, path, options) => {
        if (path.startsWith('phone_verifications?') && !options) {
          return { data:[{ id:'pv1', attempts:0, expires_at:new Date(Date.now() + 60000).toISOString(), code_hash:'x'.repeat(64) }] };
        }
        if (path === 'phone_verifications?id=eq.pv1' && options?.method === 'PATCH') { patched = JSON.parse(options.body); return { data:[] }; }
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({ storeId:'store1', phone:'2065551234', code:'000000' }, 'POST'), {}, url('/public/account/phone/confirm-verify'), deps);
    assert.equal(res.status, 400);
    assert.equal(patched.attempts, 1);
  }

  // confirm-verify: correct code links to an existing unlinked customer found by phone.
  {
    const code = '123456';
    const { createHash } = await import('node:crypto');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const patches = [];
    const deps = baseDeps({
      lookupCustomerIdByPhone: async () => 'cust-9',
      supabaseAdminFetch: async (env, path, options) => {
        if (path.startsWith('phone_verifications?') && !options) {
          return { data:[{ id:'pv2', attempts:0, expires_at:new Date(Date.now() + 60000).toISOString(), code_hash:codeHash }] };
        }
        if (path === 'phone_verifications?id=eq.pv2' && options?.method === 'PATCH') return { data:[] };
        if (path.startsWith('customers?') && path.includes('linked_user_id=eq.user-1') && !options) return { data:[] }; // no existing link yet
        if (path === 'customers?id=eq.cust-9&select=linked_user_id,email') return { data:[{ linked_user_id:null, email:null }] };
        if (path === 'customers?id=eq.cust-9' && options?.method === 'PATCH') { patches.push(JSON.parse(options.body)); return { data:[] }; }
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({ storeId:'store1', phone:'2065551234', code }, 'POST'), {}, url('/public/account/phone/confirm-verify'), deps);
    assert.equal(res.status, 200);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].linked_user_id, 'user-1');
  }

  // confirm-verify: phone already linked to a different account is rejected, not silently reassigned.
  {
    const code = '654321';
    const { createHash } = await import('node:crypto');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const deps = baseDeps({
      lookupCustomerIdByPhone: async () => 'cust-owned-by-someone-else',
      supabaseAdminFetch: async (env, path, options) => {
        if (path.startsWith('phone_verifications?') && !options) {
          return { data:[{ id:'pv3', attempts:0, expires_at:new Date(Date.now() + 60000).toISOString(), code_hash:codeHash }] };
        }
        if (path === 'phone_verifications?id=eq.pv3' && options?.method === 'PATCH') return { data:[] };
        if (path.startsWith('customers?') && path.includes('linked_user_id=eq.user-1')) return { data:[] };
        if (path === 'customers?id=eq.cust-owned-by-someone-else&select=linked_user_id,email') return { data:[{ linked_user_id:'some-other-user', email:'x@example.com' }] };
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({ storeId:'store1', phone:'2065551234', code }, 'POST'), {}, url('/public/account/phone/confirm-verify'), deps);
    assert.equal(res.status, 409, 'linking a phone already owned by a different account must be refused');
  }

  // summary: surfaces both the durable loyalty balance and the new durable trade-credit balance.
  {
    const deps = baseDeps({
      supabaseAdminFetch: async (env, path) => {
        if (path.startsWith('customers?')) return { data:[{ id:'cust-1', name:'Jane', phone:'2065551234', email:'jane@example.com', loyalty_points_balance:120, trade_credit_balance:45.5 }] };
        if (path.startsWith('gift_cards?')) return { data:[{ code:'GC1', balance:10, initial_value:25 }] };
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({}), {}, url('/public/account/summary', { store_id:'store1' }), deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.linked, true);
    assert.equal(res.body.customer.loyaltyPointsBalance, 120);
    assert.equal(res.body.customer.tradeCreditBalance, 45.5);
    assert.equal(res.body.giftCards.length, 1);
  }

  // orders: matches by verified email OR linked phone, and nothing else; line items are attached by sale_id.
  {
    const deps = baseDeps({
      supabaseAdminFetch: async (env, path) => {
        if (path.startsWith('customers?')) return { data:[{ id:'cust-1', phone:'206-555-1234' }] };
        if (path.startsWith('storefront_orders?')) return {
          data:[
            { id:'o1', sale_id:'sale-1', customer_email:'jane@example.com', customer_phone:'000-000-0000' },
            { id:'o2', sale_id:'sale-2', customer_email:'nobody@example.com', customer_phone:'(206) 555-1234' },
            { id:'o3', sale_id:'sale-3', customer_email:'stranger@example.com', customer_phone:'999-999-9999' },
          ],
        };
        if (path.startsWith('pos_sale_lines?')) return { data:[{ sale_id:'sale-1', title:'Charizard VMAX', quantity:1, unit_price:39.99 }] };
        if (path.startsWith('pos_sales?')) return { data:[{ id:'sale-1', total:39.99 }, { id:'sale-2', total:12 }] };
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({}), {}, url('/public/account/orders', { store_id:'store1' }), deps);
    assert.equal(res.status, 200);
    const ids = res.body.orders.map(o => o.id).sort();
    assert.deepEqual(ids, ['o1', 'o2'], 'must match by email OR by phone digits regardless of formatting, and exclude unrelated orders');
    const o1 = res.body.orders.find(o => o.id === 'o1');
    assert.equal(o1.items.length, 1, 'matched orders must carry their line items');
    assert.equal(o1.items[0].title, 'Charizard VMAX');
    assert.equal(o1.total, 39.99, 'storefront_orders has no total column -- it must come from the linked pos_sales row');
    const o2 = res.body.orders.find(o => o.id === 'o2');
    assert.deepEqual(o2.items, [], 'an order with no lines returned must not throw, just show empty');
  }

  // in-store: unlinked account gets an explicit linked:false, not an error or someone else's data.
  {
    const deps = baseDeps({ supabaseAdminFetch: async (env, path) => { if (path.startsWith('customers?')) return { data:[] }; throw new Error('unexpected: ' + path); } });
    const res = await handleAccountRequest(fakeRequest({}), {}, url('/public/account/in-store', { store_id:'store1' }), deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.linked, false);
    assert.deepEqual(res.body.purchases, []);
  }

  // in-store: linked account gets sales grouped with their line items.
  {
    const deps = baseDeps({
      supabaseAdminFetch: async (env, path) => {
        if (path.startsWith('customers?')) return { data:[{ id:'cust-1' }] };
        if (path.startsWith('pos_sales?')) return { data:[{ id:'sale-1', total:19.99, created_at:'2026-08-01T00:00:00Z' }] };
        if (path.startsWith('pos_sale_lines?')) return { data:[{ sale_id:'sale-1', title:'Booster Pack', quantity:1, unit_price:19.99 }] };
        throw new Error('unexpected db call: ' + path);
      },
    });
    const res = await handleAccountRequest(fakeRequest({}), {}, url('/public/account/in-store', { store_id:'store1' }), deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.linked, true);
    assert.equal(res.body.purchases.length, 1);
    assert.equal(res.body.purchases[0].items.length, 1);
    assert.equal(res.body.purchases[0].items[0].title, 'Booster Pack');
  }
}

await run();
console.log('Customer web-account functional checks passed');
