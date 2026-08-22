// Customer-facing "My Account" backend: links a themanapocket.com login
// (Supabase Auth user) to the in-store customers record via a phone SMS
// code, then serves the balances/history that link unlocks. Mirrors the
// module/deps-injection shape of scripts/foc-preorders.mjs so it plugs
// into cloudflare-worker-full.js's router the same way.

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function inFilter(values) {
  return `in.(${values.map(value => encodeURIComponent(String(value))).join(',')})`;
}

// Workers runtime has no Node crypto -- Web Crypto's subtle.digest is the
// portable equivalent, same reasoning as every other from-scratch hash in
// this codebase that has to run inside the Worker rather than locally.
async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function secureSixDigitCode() {
  const values = new Uint32Array(1);
  const range = 900000;
  const ceiling = Math.floor(0x100000000 / range) * range;
  do crypto.getRandomValues(values); while (values[0] >= ceiling);
  return String(100000 + (values[0] % range));
}

export async function findLinkedCustomer(db, storeId, userId) {
  const { data } = await db(`customers?store_id=eq.${encodeURIComponent(storeId)}&linked_user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return data?.[0] || null;
}

async function startPhoneVerify(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env); if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const storeId = text(limited.data?.storeId, 80);
  const phoneRaw = text(limited.data?.phone, 32);
  const digits = deps.normalizePhoneDigits(phoneRaw);
  if (!storeId || digits.length < 10) return deps.json({ ok:false, error:'Enter a valid phone number.' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data:recent } = await db(`phone_verifications?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&verified_at=is.null&order=created_at.desc&limit=1`);
  const last = recent?.[0];
  if (last && Date.now() - new Date(last.created_at).getTime() < 60000) {
    return deps.json({ ok:false, error:'Wait a minute before requesting another code.' }, 429);
  }
  const code = secureSixDigitCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
  await db('phone_verifications', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ store_id:storeId, user_id:auth.user.id, phone:phoneRaw, code_hash:codeHash, expires_at:expiresAt }) });
  try {
    await deps.sendSms(env, phoneRaw, `Your Mana Pocket verification code is ${code}. It expires in 10 minutes.`);
  } catch (error) {
    return deps.json({ ok:false, error:'Could not send the verification text: ' + error.message }, 502);
  }
  return deps.json({ ok:true, message:'Code sent.' });
}

async function confirmPhoneVerify(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env); if (auth.error) return auth.error;
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const storeId = text(limited.data?.storeId, 80);
  const phoneRaw = text(limited.data?.phone, 32);
  const code = text(limited.data?.code, 12);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data:rows } = await db(`phone_verifications?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&phone=eq.${encodeURIComponent(phoneRaw)}&verified_at=is.null&order=created_at.desc&limit=1`);
  const row = rows?.[0];
  if (!row) return deps.json({ ok:false, error:'Request a new code first.' }, 404);
  if (new Date(row.expires_at).getTime() < Date.now()) return deps.json({ ok:false, error:'That code expired. Request a new one.' }, 410);
  if (Number(row.attempts || 0) >= 5) return deps.json({ ok:false, error:'Too many attempts. Request a new code.' }, 429);
  const hash = await sha256Hex(code);
  if (hash !== row.code_hash) {
    await db(`phone_verifications?id=eq.${row.id}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ attempts:Number(row.attempts || 0) + 1 }) });
    return deps.json({ ok:false, error:'That code was not correct.' }, 400);
  }
  await db(`phone_verifications?id=eq.${row.id}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ verified_at:new Date().toISOString() }) });

  const existingLink = await findLinkedCustomer(db, storeId, auth.user.id);
  if (existingLink) {
    await db(`customers?id=eq.${existingLink.id}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ phone:phoneRaw }) });
  } else {
    const matchedId = await deps.lookupCustomerIdByPhone(env, storeId, phoneRaw);
    if (matchedId) {
      const { data:matchRows } = await db(`customers?id=eq.${encodeURIComponent(matchedId)}&select=linked_user_id,email`);
      const match = matchRows?.[0];
      if (match?.linked_user_id && match.linked_user_id !== auth.user.id) {
        return deps.json({ ok:false, error:'That phone number is already linked to a different account. Contact the store if this is a mistake.' }, 409);
      }
      await db(`customers?id=eq.${encodeURIComponent(matchedId)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ linked_user_id:auth.user.id, email:match?.email || auth.user.email || null }) });
    } else {
      await db('customers', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ store_id:storeId, name:auth.user.user_metadata?.full_name || 'Customer', phone:phoneRaw, email:auth.user.email || null, linked_user_id:auth.user.id }) });
    }
  }
  return await accountSummary(request, env, deps, url, auth, storeId);
}

// storeIdOverride carries the store ID through when this is reused from
// confirmPhoneVerify -- that request is a POST with the store ID in the
// JSON body, not a query string, so url.searchParams would be empty and
// the customers lookup below would filter on store_id=eq.'' (invalid
// uuid syntax) instead of skipping the customer lookup.
async function accountSummary(request, env, deps, url, authOverride, storeIdOverride) {
  const auth = authOverride || await deps.requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const storeId = storeIdOverride || text(url.searchParams.get('store_id'), 80);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const customer = await findLinkedCustomer(db, storeId, auth.user.id);
  let giftCards = [];
  if (customer) {
    const { data } = await db(`gift_cards?store_id=eq.${encodeURIComponent(storeId)}&customer_id=eq.${encodeURIComponent(customer.id)}&status=eq.active&select=code,balance,initial_value`);
    giftCards = data || [];
  }
  return deps.json({
    ok:true,
    linked:!!customer,
    email:auth.user.email || null,
    customer: customer ? {
      name:customer.name, phone:customer.phone, email:customer.email,
      loyaltyPointsBalance:Number(customer.loyalty_points_balance || 0),
      tradeCreditBalance:Number(customer.trade_credit_balance || 0),
    } : null,
    giftCards,
  });
}

// storefront_orders has no digits-only phone column to index on, so a
// phone match is a client-side filter over a capped fetch -- the same
// known, accepted limitation as lookupCustomerIdByPhone in the main
// Worker file (fine for one shop's order volume).
async function accountOrders(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env); if (auth.error) return auth.error;
  const storeId = text(url.searchParams.get('store_id'), 80);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const customer = await findLinkedCustomer(db, storeId, auth.user.id);
  const phoneDigits = customer ? deps.normalizePhoneDigits(customer.phone) : '';
  const email = String(auth.user.email || '').toLowerCase();
  const { data:orders } = await db(`storefront_orders?store_id=eq.${encodeURIComponent(storeId)}&order=created_at.desc&limit=500`);
  const matched = (orders || []).filter(order =>
    (email && String(order.customer_email || '').toLowerCase() === email) ||
    (phoneDigits && deps.normalizePhoneDigits(order.customer_phone) === phoneDigits)
  );
  const saleIds = matched.map(order => order.sale_id).filter(Boolean);
  // storefront_orders itself has no total column -- the real sale total
  // lives on the pos_sales row it points at (sale_id), same as its items.
  let lines = [], sales = [];
  if (saleIds.length) {
    ([{ data:lines }, { data:sales }] = await Promise.all([
      db(`pos_sale_lines?sale_id=${inFilter(saleIds)}&select=sale_id,title,category,quantity,unit_price,image_url`),
      db(`pos_sales?id=${inFilter(saleIds)}&select=id,total,status`),
    ]));
  }
  // A checkout interrupted mid-payment leaves pos_sales.status='pending'
  // with no visible sign of it here before this -- the account page had no
  // status field at all, so a stuck order looked identical to a normal
  // completed one. paymentStatus/canResumePayment give the frontend what it
  // needs to show that state and offer /public/storefront/resume.
  const withItems = matched.map(order => {
    const sale = sales?.find(s => s.id === order.sale_id);
    return {
      ...order,
      total:sale?.total ?? null,
      paymentStatus:sale?.status || null,
      canResumePayment:sale?.status === 'pending',
      items:(lines || []).filter(line => line.sale_id === order.sale_id),
    };
  });
  return deps.json({ ok:true, orders:withItems });
}

async function accountInStorePurchases(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env); if (auth.error) return auth.error;
  const storeId = text(url.searchParams.get('store_id'), 80);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const customer = await findLinkedCustomer(db, storeId, auth.user.id);
  if (!customer) return deps.json({ ok:true, linked:false, purchases:[] });
  const { data:sales } = await db(`pos_sales?store_id=eq.${encodeURIComponent(storeId)}&customer_id=eq.${encodeURIComponent(customer.id)}&status=eq.completed&order=created_at.desc&limit=200&select=id,total,created_at,completed_at`);
  const ids = (sales || []).map(sale => sale.id);
  let lines = [];
  if (ids.length) { ({ data:lines } = await db(`pos_sale_lines?sale_id=${inFilter(ids)}&select=sale_id,title,category,quantity,unit_price,image_url`)); }
  const grouped = (sales || []).map(sale => ({ ...sale, items:(lines || []).filter(line => line.sale_id === sale.id) }));
  return deps.json({ ok:true, linked:true, purchases:grouped });
}

// consignor_people/consignment_items/the want-list KV blob all store contact
// as one freeform "phone or email" string (staff type whatever the customer
// gave them at intake) rather than a structured column, so matching it to a
// signed-in web account has to try both interpretations of that one field.
function contactMatches(contact, email, phoneDigits, normalizePhoneDigits) {
  const value = String(contact || '');
  return (!!email && value.toLowerCase() === email) || (!!phoneDigits && normalizePhoneDigits(value) === phoneDigits);
}

async function accountConsignments(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env); if (auth.error) return auth.error;
  const storeId = text(url.searchParams.get('store_id'), 80);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const customer = await findLinkedCustomer(db, storeId, auth.user.id);
  const email = String(auth.user.email || '').toLowerCase();
  const phoneDigits = customer ? deps.normalizePhoneDigits(customer.phone) : '';
  const { data:people } = await db(`consignor_people?store_id=eq.${encodeURIComponent(storeId)}&select=id,name,contact,store_split_percent`);
  const consignor = (people || []).find(person => contactMatches(person.contact, email, phoneDigits, deps.normalizePhoneDigits));
  if (!consignor) return deps.json({ ok:true, linked:false, consignor:null, items:[] });
  const { data:items } = await db(`consignment_items?store_id=eq.${encodeURIComponent(storeId)}&consignor_id=eq.${encodeURIComponent(consignor.id)}&order=added_at.desc&limit=300&select=id,item_name,inventory_sku,list_price,status,sale_price,paid_out,added_at,sold_at,paid_out_at`);
  return deps.json({ ok:true, linked:true, consignor:{ name:consignor.name, storeSplitPercent:Number(consignor.store_split_percent || 0) }, items:items || [] });
}

async function accountWishlist(request, env, deps, url) {
  const auth = await deps.requireAuthenticatedUser(request, env); if (auth.error) return auth.error;
  const storeId = text(url.searchParams.get('store_id'), 80);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const customer = await findLinkedCustomer(db, storeId, auth.user.id);
  const email = String(auth.user.email || '').toLowerCase();
  const phoneDigits = customer ? deps.normalizePhoneDigits(customer.phone) : '';
  const raw = await deps.kvGet(env, `lba:${text(storeId, 80).replace(/[^a-zA-Z0-9:_-]/g, '-')}:wantlist`);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch (_) { list = []; }
  const items = (Array.isArray(list) ? list : []).filter(entry => contactMatches(entry.contact, email, phoneDigits, deps.normalizePhoneDigits));
  return deps.json({ ok:true, items });
}

export async function handleAccountRequest(request, env, url, deps) {
  const path = url.pathname;
  if (path === '/public/account/phone/start-verify' && request.method === 'POST') return await startPhoneVerify(request, env, deps, url);
  if (path === '/public/account/phone/confirm-verify' && request.method === 'POST') return await confirmPhoneVerify(request, env, deps, url);
  if (path === '/public/account/summary' && request.method === 'GET') return await accountSummary(request, env, deps, url);
  if (path === '/public/account/orders' && request.method === 'GET') return await accountOrders(request, env, deps, url);
  if (path === '/public/account/in-store' && request.method === 'GET') return await accountInStorePurchases(request, env, deps, url);
  if (path === '/public/account/consignments' && request.method === 'GET') return await accountConsignments(request, env, deps, url);
  if (path === '/public/account/wishlist' && request.method === 'GET') return await accountWishlist(request, env, deps, url);
  return deps.json({ ok:false, error:'Not found' }, 404);
}
