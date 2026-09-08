import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const storefront = fs.readFileSync('storefront.html', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-09-08-storefront-notify-requests.sql', 'utf8');

// Store idea: let a customer self-report "notify me" directly from the
// public storefront instead of it only being possible via staff manually
// typing into the existing Want List (dashboard-only, KV-backed). The Want
// List KV blob is replaced wholesale on every save (client reads the full
// array, mutates it, POSTs the whole thing back) -- safe for one
// authenticated staff device, unsafe for anonymous public writes (a race
// or a bad POST could clobber the whole list). This gets its own table
// instead, written only by the Worker's service-role key.

// ── Migration: a real table, RLS'd for staff read/update, no public insert policy ──
assert.match(migration, /create table if not exists public\.storefront_notify_requests/, 'migration must create the table');
assert.match(migration, /store_id uuid not null references public\.stores\(id\) on delete cascade/, 'must be scoped to a store and cascade-delete with it, matching every other per-store table');
assert.match(migration, /status text not null default 'new' check \(status in \('new','converted','dismissed'\)\)/, 'must track review status so staff can work through a queue');
assert.match(migration, /alter table public\.storefront_notify_requests enable row level security/, 'RLS must be enabled');
assert.match(migration, /storefront_notify_requests_select_member.*for select using \(public\.current_store_role\(store_id\) in \('owner','admin','manager','employee'\)\)/s, 'staff of any role must be able to read their store\'s requests');
assert.match(migration, /storefront_notify_requests_update_employee.*for update using \(public\.current_store_role\(store_id\) in \('owner','admin','manager','employee'\)\)/s, 'staff must be able to update (convert/dismiss) requests');
assert.doesNotMatch(migration, /for insert/, 'must have NO insert policy -- anonymous customers never get a direct table grant, only the Worker\'s service-role key can insert');

// ── Worker: public POST route, service-role insert, validated input ──
const routeStart = worker.indexOf("if (url.pathname === '/public/storefront/notify' && request.method === 'POST')");
assert.ok(routeStart !== -1, 'missing POST /public/storefront/notify route');
const routeEnd = worker.indexOf("if (url.pathname === '/public/storefront/checkout'", routeStart);
const routeBody = worker.slice(routeStart, routeEnd);
assert.match(routeBody, /await enforceUsageLimit\(env, `storefront-notify:\$\{storeId\}:\$\{ip\}`, 5, 300\)/, 'must be rate-limited per store+IP, same defensive pattern as storefront checkout');
assert.match(routeBody, /settings\?\.\[0\]\?\.receipt_settings\?\.storefrontEnabled !== true\) return json\(\{ ok:false, error:'Storefront is not published' \}, 404\)/, 'must refuse to accept requests for a store whose storefront is not published');
assert.match(routeBody, /if \(!itemText\) return json\(\{ ok:false, error:'Tell us what you are looking for' \}, 400\)/, 'must require non-empty item text');
assert.match(routeBody, /if \(!\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/\.test\(contactEmail\)\) return json/, 'must validate the email looks like an email before accepting it');
assert.match(routeBody, /supabaseAdminFetch\(env, 'storefront_notify_requests', \{ method:'POST'/, 'must insert via the service-role key (supabaseAdminFetch), never a client-supplied key');

// ── Storefront UI: entry points + modal + submit wired to the new route ──
assert.match(storefront, /<dialog id="notify-modal">/, 'storefront must have a notify-me dialog');
assert.match(storefront, /class="notify-link" onclick="event\.preventDefault\(\);openNotifyModal\(''\)">/, 'a persistent, always-visible entry point must exist, not just the empty-search fallback');
assert.match(storefront, /openNotifyModal\(document\.getElementById\('q'\)\.value\)/, 'an empty search result must offer to capture what the customer was searching for, pre-filled');
assert.match(storefront, /function submitNotifyRequest\(\)\{/, 'missing submitNotifyRequest');
const submitStart = storefront.indexOf('async function submitNotifyRequest(){');
const submitEnd = storefront.indexOf('\n}', submitStart) + 2;
const submitFn = storefront.slice(submitStart, submitEnd);
assert.match(submitFn, /fetch\(`\$\{WORKER\}\/public\/storefront\/notify`/, 'must POST to the new public route');
assert.match(submitFn, /storeId:currentStoreId,itemText,contactEmail/, 'must send storeId, itemText, and contactEmail');
assert.match(storefront, /if\(!itemText\)\{ errEl\.textContent='Tell us what you are looking for\.'; errEl\.classList\.add\('on'\); return; \}/, 'client-side must also require item text before hitting the network, not just rely on the server\'s validation');

// ── Dashboard admin panel: review queue in the Want List tab ──
assert.match(dashboard, /<div class="panel" id="sf-notify-panel"/, 'Want List tab must have a storefront-requests review panel');
assert.match(dashboard, /function loadStorefrontNotifyRequests\(\)\{/, 'missing loadStorefrontNotifyRequests');
const loadStart = dashboard.indexOf('async function loadStorefrontNotifyRequests(){');
const loadEnd = dashboard.indexOf('\n}', loadStart) + 2;
const loadFn = dashboard.slice(loadStart, loadEnd);
assert.match(loadFn, /\.from\('storefront_notify_requests'\)/, 'must read from the real table via the authenticated Supabase client');
assert.match(loadFn, /\.eq\('store_id', storeId\)/, 'must scope to the active store');
assert.match(loadFn, /\.eq\('status', 'new'\)/, 'must only show unreviewed requests, not a growing list of already-handled ones');
assert.match(dashboard, /function convertNotifyRequestToWant\(id\)\{/, 'missing convertNotifyRequestToWant');
const convertStart = dashboard.indexOf('function convertNotifyRequestToWant(id){');
const convertEnd = dashboard.indexOf('\n}', convertStart) + 2;
const convertFn = dashboard.slice(convertStart, convertEnd);
assert.match(convertFn, /document\.getElementById\('wl-item'\)\.value = r\.item_text;/, 'converting must pre-fill the EXISTING Add Want form, not write to storefront_notify_requests or Want List storage directly -- keeps the two systems decoupled');
assert.match(dashboard, /function dismissNotifyRequest\(id\)\{/, 'missing dismissNotifyRequest');
assert.match(dashboard, /loadStorefrontNotifyRequests\(\);/, 'must actually be loaded when the Want List tab opens, not just definable but never called');

console.log('Storefront notify-me requests contract checks passed');
