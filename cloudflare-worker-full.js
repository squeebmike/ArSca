/**
 * LBA Proxy Worker - Cloudflare Worker
 * Worker URL: https://still-resonance-4f87.swarnerauto.workers.dev
 *
 * Secrets / bindings expected:
 *   ANTHROPIC_API_KEY
 *   CARDSIGHTAI_API_KEY
 *   WEBFLOW_TOKEN
 *   PSA_TOKEN
 *   STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE
 *   STRIPE_PUBLISHABLE_KEY_TEST / STRIPE_PUBLISHABLE_KEY_LIVE
 *   STRIPE_WEBHOOK_SECRET_TEST / STRIPE_WEBHOOK_SECRET_LIVE
 *   EBAY_USER_TOKEN
 *   EBAY_APP_ID
 *   METRON_USER / METRON_PASS
 *   SOLDCOMPS_API_KEY
 *   LBA_KV
 *   MTG_CATALOG_R2 (R2 must be enabled for the Cloudflare account)
 */
// Production release marker: 2026.07.28.06-comic-load-controls

// Same parser that built the live 740-set/426,540-card Topps catalog (see
// scripts/import-topps-checklists.js -> scripts/topps/merge-and-publish.mjs).
// It has zero Node dependencies (pure-JS SHA-1), so it bundles straight into
// the Worker -- reused here instead of duplicating checklist-parsing logic.
import { buildChecklistIndex, parseChecklistText, sha1Hex, slugify } from './scripts/topps-checklist-parser.js';

// Per-isolate rate limiter for PriceCharting API (no KV needed)
let _pcLastCall = 0;

const WEBFLOW_BASE = 'https://api.webflow.com/v2';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const CARDSIGHTAI_BASE = 'https://api.cardsight.ai';
const SITE_ID = '65b15ee0228d06647ca7e4ce';
const WF_PRODUCTS = '65eb45a28ff6bf3fe4f17b14';
const WF_STATUS_SOLD = 'e6b42f14fcb99aa2168a5f5672226f68';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
].join(' ');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, accept, Authorization, x-store-id, X-Store-Id',
  'Access-Control-Max-Age': '86400',
};

const METRON_BASE = 'https://metron.cloud/api';

function metronText(value, max = 4000) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function metronName(value) {
  if (typeof value === 'string') return value;
  return String(value?.name || value?.issue_name || value?.title || '');
}

function metronImage(value) {
  if (typeof value === 'string') return value;
  return String(value?.original || value?.large || value?.medium || value?.small || value?.url || '');
}

function normalizeMetronListIssue(issue = {}) {
  const series = issue.series || {};
  return {
    id:String(issue.id || ''),
    issueName:String(issue.issue_name || ''),
    seriesId:String(series.id || ''),
    seriesName:metronName(series),
    seriesVolume:series.volume ?? null,
    seriesYearBegan:series.year_began ?? null,
    seriesType:metronName(series.series_type),
    publisher:metronName(issue.publisher || series.publisher),
    number:String(issue.number || ''),
    coverDate:issue.cover_date || null,
    storeDate:issue.store_date || null,
    imageUrl:metronImage(issue.image),
    coverHash:String(issue.cover_hash || ''),
    modified:issue.modified || null,
    resourceUrl:issue.resource_url || (issue.id ? `https://metron.cloud/issue/${issue.id}/` : ''),
  };
}

function normalizeMetronSeries(series = {}) {
  return {
    id:String(series.id || ''),
    // Metron's list serializer calls this field `series`; detail records use `name`.
    name:metronName(series.series || series),
    volume:series.volume ?? null,
    yearBegan:series.year_began ?? null,
    yearEnd:series.year_end ?? null,
    publisher:metronName(series.publisher),
    imprint:metronName(series.imprint),
    seriesType:metronName(series.series_type),
    status:String(series.status || series.status_name || ''),
    issueCount:Number(series.issue_count || series.issues_count || 0) || null,
    // The series-list endpoint has no cover field. Issue covers are loaded only after
    // a run is chosen so an unrelated metadata-provider image cannot impersonate it.
    imageUrl:'',
    modified:series.modified || null,
    resourceUrl:series.resource_url || (series.id ? `https://metron.cloud/series/${series.id}/` : ''),
  };
}

function normalizeMetronDetail(issue = {}) {
  const base = normalizeMetronListIssue(issue);
  const variants = (Array.isArray(issue.variants) ? issue.variants : []).map((variant, index) => ({
    id:String(variant?.id || `${base.id}:variant:${index}`),
    metronIssueId:String(variant?.issue?.id || variant?.issue_id || ''),
    name:String(variant?.name || variant?.issue_name || `Variant ${index + 1}`),
    number:String(variant?.number || variant?.issue?.number || base.number || ''),
    sku:String(variant?.sku || ''),
    upc:String(variant?.upc || ''),
    imageUrl:metronImage(variant?.image),
    coverPrice:Number(variant?.price || 0) || null,
    coverPriceCurrency:String(variant?.price_currency || 'USD'),
  }));
  const credits = (Array.isArray(issue.credits) ? issue.credits : []).map(credit => ({
    creator:metronName(credit?.creator),
    roles:(Array.isArray(credit?.roles) ? credit.roles : Array.isArray(credit?.role) ? credit.role : [credit?.roles || credit?.role]).map(metronName).filter(Boolean),
  })).filter(credit => credit.creator);
  const creditNames = matcher => [...new Set(credits.filter(credit => credit.roles.some(role => matcher.test(role))).map(credit => credit.creator))];
  return {
    ...base,
    publisher:metronName(issue.publisher),
    imprint:metronName(issue.imprint),
    altNumber:String(issue.alt_number || ''),
    collectionTitle:String(issue.collection_title || ''),
    storyTitles:(Array.isArray(issue.story_titles) ? issue.story_titles : []).map(metronName).filter(Boolean),
    coverPrice:Number(issue.price || 0) || null,
    coverPriceCurrency:String(issue.price_currency || 'USD'),
    rating:metronName(issue.rating),
    sku:String(issue.sku || ''),
    isbn:String(issue.isbn || ''),
    upc:String(issue.upc || ''),
    pageCount:Number(issue.page_count || 0) || null,
    description:metronText(issue.desc || issue.description),
    arcs:(Array.isArray(issue.arcs) ? issue.arcs : []).map(metronName).filter(Boolean),
    genres:(Array.isArray(issue.genres) ? issue.genres : []).map(metronName).filter(Boolean),
    credits,
    writers:creditNames(/writer|script/i),
    artists:creditNames(/artist|pencil|inker|color|colour|letter/i),
    coverArtists:creditNames(/cover/i),
    characters:(Array.isArray(issue.characters) ? issue.characters : []).map(metronName).filter(Boolean),
    teams:(Array.isArray(issue.teams) ? issue.teams : []).map(metronName).filter(Boolean),
    universes:(Array.isArray(issue.universes) ? issue.universes : []).map(metronName).filter(Boolean),
    variants,
    reprints:(Array.isArray(issue.reprints) ? issue.reprints : []).map(reprint => ({ id:String(reprint?.id || ''), name:metronName(reprint), number:String(reprint?.number || '') })).filter(reprint => reprint.id || reprint.name),
    comicVineId:String(issue.cv_id || ''),
    gcdId:String(issue.gcd_id || ''),
    metronUrl:base.id ? `https://metron.cloud/issue/${base.id}/` : '',
  };
}

function metronIssueBaseNumber(value) {
  const clean = String(value || '').trim();
  return (clean.match(/^\d+(?:\.\d+)?/) || [clean])[0].toLowerCase();
}

function metronSiblingCovers(currentIssue, issueList = []) {
  const target = metronIssueBaseNumber(currentIssue.number);
  const siblings = (Array.isArray(issueList) ? issueList : []).map(normalizeMetronListIssue).filter(issue => {
    if (!issue.id || !issue.imageUrl) return false;
    return !target || metronIssueBaseNumber(issue.number) === target;
  });
  const current = normalizeMetronListIssue(currentIssue);
  if (current.id && current.imageUrl && !siblings.some(issue => issue.id === current.id)) siblings.unshift(current);
  const nested = (currentIssue.variants || []).filter(variant => variant.imageUrl).map(variant => ({
    id:variant.metronIssueId || variant.id,
    metronIssueId:variant.metronIssueId || '',
    issueName:variant.name,
    seriesId:current.seriesId,
    seriesName:current.seriesName,
    seriesYearBegan:current.seriesYearBegan,
    publisher:current.publisher,
    number:variant.number || current.number,
    imageUrl:variant.imageUrl,
    sku:variant.sku,
    upc:variant.upc,
    coverPrice:variant.coverPrice,
    coverPriceCurrency:variant.coverPriceCurrency,
    nestedVariant:true,
  }));
  const combined = [...siblings, ...nested];
  return combined.filter((cover, index) => combined.findIndex(other => String(other.id) === String(cover.id) && other.imageUrl === cover.imageUrl) === index);
}

async function metronFetch(env, path, params = {}, ttlSeconds = 86400) {
  const user = String(env.METRON_USER || '');
  const pass = String(env.METRON_PASS || '');
  if (!user || !pass) {
    const error = new Error('METRON_USER and METRON_PASS are not configured');
    error.status = 501;
    throw error;
  }
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) qs.set(key, String(value).trim());
  });
  const cleanPath = '/' + String(path || '').replace(/^\/+/, '');
  const cacheKey = `metron:${cleanPath}?${qs.toString()}`;
  if (env.LBA_KV) {
    const cached = await env.LBA_KV.get(cacheKey, 'json').catch(() => null);
    if (cached) return { data:cached, cacheStatus:'hit' };
  }
  const response = await fetch(`${METRON_BASE}${cleanPath}${qs.size ? '?' + qs.toString() : ''}`, {
    headers:{
      'Accept':'application/json',
      'Authorization':'Basic ' + btoa(`${user}:${pass}`),
      'User-Agent':'WalkOff-Comics/1.0',
    },
    signal:AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Metron HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = response.headers.get('Retry-After') || '';
    throw error;
  }
  if (env.LBA_KV) await env.LBA_KV.put(cacheKey, JSON.stringify(data), { expirationTtl:ttlSeconds });
  return { data, cacheStatus:'miss' };
}

async function metronExactIssueRecords(env, issue = {}) {
  const seriesId = String(issue.seriesId || '');
  const number = metronIssueBaseNumber(issue.number);
  if (!seriesId || !number) return [];
  const first = await metronFetch(env, '/issue/', { series_id:seriesId, number, page:1 }, 60 * 60 * 24 * 7);
  const payload = first.data || {};
  const rows = Array.isArray(payload) ? [...payload] : [...(payload.results || [])];
  const total = Number(Array.isArray(payload) ? rows.length : payload.count || rows.length) || rows.length;
  const pageSize = Math.max(1, rows.length || 20);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount > 1) {
    const remainingPages = Array.from({ length:pageCount - 1 }, (_, index) => index + 2);
    for (const page of remainingPages) {
      let result = null;
      for (let attempt = 1; attempt <= 3 && !result; attempt++) {
        try {
          result = await metronFetch(env, '/issue/', { series_id:seriesId, number, page }, 60 * 60 * 24 * 7);
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }
      if (result) rows.push(...(Array.isArray(result.data) ? result.data : (result.data?.results || [])));
    }
  }
  return rows.filter((row, index, all) => row?.id && all.findIndex(other => String(other?.id || '') === String(row.id)) === index);
}

// Store policy: market-tracked prices ring up as whole dollars, rounded UP
// (e.g. $7.01 market -> $8, never down). A deliberate override or floor is
// respected exactly as entered -- this only rounds the raw market figure.
function roundUpToDollar(value) {
  const n = Number(value || 0);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, ...extraHeaders, 'Content-Type': 'application/json' },
  });
}

function supabaseAdminConfig(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '');
  if (!base || !key) throw new Error('Supabase admin service is not configured');
  return { base, key };
}

async function supabaseAdminFetch(env, path, options = {}) {
  const { base, key } = supabaseAdminConfig(env);
  const headers = new Headers(options.headers || {});
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase ${response.status}`);
  return { data, response };
}

async function requirePlatformAdmin(request, env) {
  const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: json({ ok:false, error:'Authentication required' }, 401) };
  const { base, key } = supabaseAdminConfig(env);
  const userResponse = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey:key, Authorization:`Bearer ${token}` },
  });
  if (!userResponse.ok) return { error:json({ ok:false, error:'Session expired or invalid' }, 401) };
  const user = await userResponse.json();
  const query = `platform_admins?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=user_id,role&limit=1`;
  const { data } = await supabaseAdminFetch(env, query);
  const admin = Array.isArray(data) ? data[0] : null;
  if (!admin) return { error:json({ ok:false, error:'Platform administrator access required' }, 403) };
  return { user, admin };
}

async function requireStoreUser(request, env, storeId, allowedRoles = ['owner','admin','manager','employee','scanner_only']) {
  const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error:json({ ok:false, error:'Authentication required' }, 401) };
  if (!storeId) return { error:json({ ok:false, error:'storeId is required' }, 400) };
  const { base, key } = supabaseAdminConfig(env);
  const userResponse = await fetch(`${base}/auth/v1/user`, { headers:{ apikey:key, Authorization:`Bearer ${token}` } });
  if (!userResponse.ok) return { error:json({ ok:false, error:'Session expired or invalid' }, 401) };
  const user = await userResponse.json();
  const { data } = await supabaseAdminFetch(env, `store_members?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=role&limit=1`);
  const role = data?.[0]?.role;
  if (!role || !allowedRoles.includes(role)) return { error:json({ ok:false, error:'You do not have permission for this store' }, 403) };
  return { user, role, token };
}

function requestStoreId(request, url, body = null) {
  const candidate = request.headers.get('X-Store-Id')
    || request.headers.get('x-store-id')
    || url?.searchParams?.get('store')
    || url?.searchParams?.get('store_id')
    || body?.storeId
    || body?.store_id
    || body?.show?.storeId
    || body?.transaction?.storeId
    || '';
  const storeId = String(candidate).trim();
  return /^[0-9a-z_-]{2,80}$/i.test(storeId) ? storeId : '';
}

async function readJsonWithLimit(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) return { error:json({ ok:false, error:'Request body is too large' }, 413) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error:json({ ok:false, error:'Request body is too large' }, 413) };
  try { return { data:raw ? JSON.parse(raw) : {} }; }
  catch (_) { return { error:json({ ok:false, error:'Invalid JSON body' }, 400) }; }
}

async function enforceUsageLimit(env, key, limit, windowSeconds) {
  if (!env.LBA_KV) return null;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const rateKey = `rate:${key}:${bucket}`;
  const count = Number(await env.LBA_KV.get(rateKey) || 0);
  if (count >= limit) return json({ ok:false, error:'Too many requests; try again shortly' }, 429, { 'Retry-After':String(windowSeconds) });
  await env.LBA_KV.put(rateKey, String(count + 1), { expirationTtl:windowSeconds * 2 });
  return null;
}

async function secureSecretEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(provided || ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected || ''))),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

function stripeMode(env, requested) {
  const configured = String(env.STRIPE_PLATFORM_MODE || 'test').toLowerCase() === 'live' ? 'live' : 'test';
  const wanted = String(requested || configured).toLowerCase();
  return wanted === 'live' ? 'live' : 'test';
}

function stripeConfig(env, requestedMode) {
  const mode = stripeMode(env, requestedMode);
  // Fall back to the unsuffixed vars for stores running a single Stripe
  // account with no separate test/live keys configured (matches the
  // fallback already used by the webhook secret lookup and /health check).
  const secretKey = (mode === 'live' ? env.STRIPE_SECRET_KEY_LIVE : env.STRIPE_SECRET_KEY_TEST) || env.STRIPE_SECRET_KEY;
  const publishableKey = (mode === 'live' ? env.STRIPE_PUBLISHABLE_KEY_LIVE : env.STRIPE_PUBLISHABLE_KEY_TEST) || env.STRIPE_PUBLISHABLE_KEY;
  const webhookSecret = (mode === 'live' ? env.STRIPE_WEBHOOK_SECRET_LIVE : env.STRIPE_WEBHOOK_SECRET_TEST) || env.STRIPE_WEBHOOK_SECRET;
  return { mode, secretKey:String(secretKey || ''), publishableKey:String(publishableKey || ''), webhookSecret:String(webhookSecret || '') };
}

async function stripeApi(env, mode, path, { method='GET', params, account, idempotencyKey } = {}) {
  const cfg = stripeConfig(env, mode);
  if (!cfg.secretKey) throw new Error(`Stripe ${cfg.mode} secret key is not configured`);
  const headers = new Headers({ Authorization:`Bearer ${cfg.secretKey}` });
  if (account) headers.set('Stripe-Account', account);
  if (idempotencyKey) headers.set('Idempotency-Key', String(idempotencyKey).slice(0, 255));
  let body;
  if (params) { headers.set('Content-Type', 'application/x-www-form-urlencoded'); body = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString(); }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data?.error?.message || `Stripe request failed (${response.status})`); error.status=response.status; error.code=data?.error?.code; throw error; }
  return data;
}

function safeStripeAccount(account, mode) {
  const due = account?.requirements || {};
  const feePayer = account?.controller?.fees?.payer || (account?.type === 'standard' ? 'account' : '');
  return {
    stripeConnectedAccountId:account?.id || '', accountType:account?.type || '', feePayer,
    feePayerVerified:feePayer === 'account', chargesEnabled:!!account?.charges_enabled,
    payoutsEnabled:!!account?.payouts_enabled, detailsSubmitted:!!account?.details_submitted,
    requirementsCurrentlyDue:due.currently_due || [], requirementsEventuallyDue:due.eventually_due || [],
    requirementsPastDue:due.past_due || [], disabledReason:due.disabled_reason || '', mode,
    onboardingStatus:account?.charges_enabled && account?.payouts_enabled ? 'ready' : account?.details_submitted ? 'restricted' : 'incomplete',
    lastRefreshedAt:new Date().toISOString(),
  };
}

async function saveStripeAccount(env, storeId, status) {
  const row = { store_id:storeId, mode:status.mode, connected_account_id:status.stripeConnectedAccountId,
    account_type:status.accountType || null, fee_payer:status.feePayer || null, fee_payer_verified:!!status.feePayerVerified,
    details_submitted:status.detailsSubmitted, charges_enabled:status.chargesEnabled, payouts_enabled:status.payoutsEnabled,
    onboarding_status:status.onboardingStatus, requirements_currently_due:status.requirementsCurrentlyDue,
    requirements_eventually_due:status.requirementsEventuallyDue, requirements_past_due:status.requirementsPastDue,
    disabled_reason:status.disabledReason || '', last_refreshed_at:status.lastRefreshedAt, updated_at:new Date().toISOString() };
  await supabaseAdminFetch(env, 'store_stripe_accounts?on_conflict=store_id,mode', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify(row) });
}

async function getStripeAccountRow(env, storeId, mode) {
  const { data } = await supabaseAdminFetch(env, `store_stripe_accounts?store_id=eq.${encodeURIComponent(storeId)}&mode=eq.${mode}&select=*&limit=1`);
  return data?.[0] || null;
}

function stripeApplicationFee(env, amount) {
  if (String(env.ARSCA_PLATFORM_FEE_ENABLED || '').toLowerCase() !== 'true') return 0;
  const bps = Math.max(0, Number(env.ARSCA_PLATFORM_FEE_PERCENT_BPS || 0));
  const fixed = Math.max(0, Number(env.ARSCA_PLATFORM_FEE_FIXED_CENTS || 0));
  return Math.max(0, Math.min(Math.max(0, amount - 1), Math.round(amount * bps / 10000) + Math.round(fixed)));
}

function constantTimeEqualHex(a, b) {
  const x=String(a||''), y=String(b||''); if(x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;
}

async function verifyStripeWebhook(body, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const pairs=String(signatureHeader).split(',').map(part=>part.split('='));
  const timestamp=pairs.find(([k])=>k==='t')?.[1];
  const signatures=pairs.filter(([k])=>k==='v1').map(([,v])=>v);
  if(!timestamp||!signatures.length||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));
  const expected=[...new Uint8Array(signed)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return signatures.some(sig=>constantTimeEqualHex(sig,expected));
}

// Marks a storefront order's inventory lines sold once its sale is paid.
// Idempotent: no-ops if the sale is already completed, so a redelivered
// Stripe webhook event can't double-decrement stock.
async function fulfillStorefrontOrderInventory(env, saleId, storeId) {
  const { data: sales } = await supabaseAdminFetch(env, `pos_sales?id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,status&limit=1`);
  const sale = sales?.[0];
  if (!sale || sale.status === 'completed') return;
  await supabaseAdminFetch(env, `pos_sales?id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ status:'completed', payment_status:'paid', completed_at:new Date().toISOString() }) });
  const { data: orders } = await supabaseAdminFetch(env, `storefront_orders?sale_id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,fulfillment_method&limit=1`);
  const order = orders?.[0];
  if (!order) return; // regular POS sale, not a storefront order — nothing more to do
  const { data: lines } = await supabaseAdminFetch(env, `pos_sale_lines?sale_id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=item_id,quantity`);
  const nextStatus = order.fulfillment_method === 'shipping' ? 'sold_pending_shipment' : 'sold_pending_pickup';
  for (const line of lines || []) {
    if (!/^[0-9a-f-]{36}$/i.test(String(line.item_id || ''))) continue; // skip synthetic shipping-fee line
    const { data: items } = await supabaseAdminFetch(env, `inventory_items?id=eq.${encodeURIComponent(line.item_id)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,data,status&limit=1`);
    const item = items?.[0];
    if (!item) continue;
    const data = { ...(item.data || {}) };
    const remaining = Math.max(0, Number(data.quantity ?? data.qty ?? 1) - Number(line.quantity || 1));
    const depleted = remaining <= 0;
    const soldAt = new Date().toISOString();
    Object.assign(data, {
      quantity: remaining, qty: remaining, 'inventory-count': remaining,
      status: depleted ? nextStatus : 'in_stock', lifecycle: depleted ? nextStatus : 'in_stock',
      'sold-out': depleted, soldAt: depleted ? soldAt : (data.soldAt || ''),
      channel: depleted ? (order.fulfillment_method === 'shipping' ? 'storefront_shipping' : 'storefront_pickup') : (data.channel || ''),
    });
    await supabaseAdminFetch(env, `inventory_items?id=eq.${encodeURIComponent(line.item_id)}&store_id=eq.${encodeURIComponent(storeId)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ data, status: depleted ? nextStatus : 'in_stock' }) });
  }
}

async function syncStripeWebhookPayment(env, event, mode) {
  const object=event.data?.object||{};const account=event.account||'';
  let intentId='';let patch={updated_at:new Date().toISOString()};
  if(event.type.startsWith('payment_intent.')){intentId=object.id;patch.status=event.type==='payment_intent.succeeded'?'succeeded':event.type==='payment_intent.payment_failed'?'failed':event.type==='payment_intent.canceled'?'canceled':object.status;}
  if(event.type==='charge.succeeded'||event.type==='charge.refunded'||event.type==='charge.dispute.created'||event.type==='charge.dispute.closed'){intentId=object.payment_intent||'';patch.stripe_charge_id=object.id;const card=object.payment_method_details?.card||{};patch.card_brand=card.brand||null;patch.card_last4=card.last4||null;if(event.type==='charge.refunded'){patch.status=object.refunded?'refunded':'partially_refunded';patch.refunded_amount_cents=Number(object.amount_refunded||0);}if(event.type==='charge.dispute.created')patch.status='disputed';if(event.type==='charge.dispute.closed')patch.status=object.dispute?.status==='won'?'succeeded':'disputed';}
  if(intentId){
    const acctFilter=account?`stripe_connected_account_id=eq.${encodeURIComponent(account)}`:`stripe_connected_account_id=is.null`;
    const filter=`pos_payments?stripe_mode=eq.${mode}&${acctFilter}&stripe_payment_intent_id=eq.${encodeURIComponent(intentId)}`;
    const {data:paymentRows}=await supabaseAdminFetch(env,filter,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
    const payment=paymentRows?.[0];
    if(payment?.sale_id&&payment?.store_id&&patch.status==='succeeded'){
      await fulfillStorefrontOrderInventory(env,payment.sale_id,payment.store_id).catch(e=>console.error('Storefront order fulfillment failed:',e.message));
    }
  }
  if(event.type.startsWith('refund.')){await supabaseAdminFetch(env,`pos_refunds?stripe_refund_id=eq.${encodeURIComponent(object.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:object.status||event.type.replace('refund.',''),failure_reason:object.failure_reason||'',updated_at:new Date().toISOString()})});}
  if(event.type==='account.updated'){const storeId=object.metadata?.arsca_store_id;if(storeId){const status=safeStripeAccount(object,mode);await saveStripeAccount(env,storeId,status);}}
}

async function handleStripeWebhookSecure(request, env) {
  const body=await request.text();let event;try{event=JSON.parse(body);}catch{return new Response('Bad JSON',{status:400});}
  const mode=event.livemode?'live':'test';const secret=(mode==='live'?env.STRIPE_WEBHOOK_SECRET_LIVE:env.STRIPE_WEBHOOK_SECRET_TEST)||env.STRIPE_WEBHOOK_SECRET;
  try{if(!await verifyStripeWebhook(body,request.headers.get('stripe-signature')||'',secret))return new Response('Invalid Stripe signature',{status:401});}catch{return new Response('Invalid Stripe signature',{status:401});}
  let webhookStoredInSupabase=true;
  try{const {data:seen}=await supabaseAdminFetch(env,`stripe_webhook_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id,status&limit=1`);if(seen?.[0]?.status==='processed')return new Response('ok',{status:200});if(!seen?.length)await supabaseAdminFetch(env,'stripe_webhook_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({event_id:event.id,mode,event_type:event.type,connected_account_id:event.account||null,status:'processing'})});else await supabaseAdminFetch(env,`stripe_webhook_events?event_id=eq.${encodeURIComponent(event.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'processing',error:null})});await syncStripeWebhookPayment(env,event,mode);}catch(e){webhookStoredInSupabase=false;console.error('Stripe webhook foundation sync unavailable:',e.message);if(event.account)return new Response('Webhook persistence unavailable',{status:503});const kvKey=`stripe_webhook_processed:${event.id}`;if(env.LBA_KV&&await env.LBA_KV.get(kvKey))return new Response('ok',{status:200});}
  // Preserve the existing SaaS subscription state machine for platform events.
  if(!event.account&&env.LBA_KV){
    const object=event.data?.object||{};const custKey=id=>`sub:cust:${id}`;const subKey=id=>`sub:store:${id}`;const storeFromCustomer=async id=>{try{const raw=await env.LBA_KV.get(custKey(id));return raw?JSON.parse(raw).store_id:null;}catch{return null;}};const put=async(id,patch)=>{const raw=await env.LBA_KV.get(subKey(id));const current=raw?JSON.parse(raw):{};await env.LBA_KV.put(subKey(id),JSON.stringify({...current,...patch,updatedAt:Date.now()}),{expirationTtl:400*24*3600});};
    if(event.type==='checkout.session.completed'&&(object.metadata?.source==='walkoff-subscription'||object.mode==='subscription')){const storeId=object.metadata?.store_id||await storeFromCustomer(object.customer);if(storeId){await put(storeId,{status:'active',stripe_customer_id:object.customer,stripe_subscription_id:object.subscription});if(object.customer)await env.LBA_KV.put(custKey(object.customer),JSON.stringify({store_id:storeId}),{expirationTtl:400*24*3600});}}
    if(event.type==='customer.subscription.created'||event.type==='customer.subscription.updated'){const storeId=await storeFromCustomer(object.customer);if(storeId)await put(storeId,{status:object.status,stripe_customer_id:object.customer,stripe_subscription_id:object.id,current_period_end:object.current_period_end?object.current_period_end*1000:null,cancel_at_period_end:!!object.cancel_at_period_end});}
    if(event.type==='customer.subscription.deleted'){const storeId=await storeFromCustomer(object.customer);if(storeId)await put(storeId,{status:'canceled'});}
    if(event.type==='invoice.payment_succeeded'||event.type==='invoice.payment_failed'){const storeId=await storeFromCustomer(object.customer);if(storeId)await put(storeId,{status:event.type.endsWith('failed')?'past_due':'active',current_period_end:object.lines?.data?.[0]?.period?.end?object.lines.data[0].period.end*1000:undefined});}
    if(event.type==='checkout.session.completed'&&object.metadata?.source!=='walkoff-subscription'&&object.mode!=='subscription'&&object.id)await env.LBA_KV.put(`stripe_checkout:${object.id}`,JSON.stringify({status:'paid',amount:object.amount_total,created:Date.now()}),{expirationTtl:86400});
  }
  if(webhookStoredInSupabase)await supabaseAdminFetch(env,`stripe_webhook_events?event_id=eq.${encodeURIComponent(event.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'processed',processed_at:new Date().toISOString(),error:null})}).catch(()=>{});
  else if(env.LBA_KV)await env.LBA_KV.put(`stripe_webhook_processed:${event.id}`,'1',{expirationTtl:30*24*3600});
  return new Response('ok',{status:200});
}

async function restockRefundItems(env,{storeId,saleId,refundId,lineItemIds,userId}){
  const selected=Array.isArray(lineItemIds)&&lineItemIds.length?`&id=in.(${lineItemIds.map(id=>encodeURIComponent(id)).join(',')})`:'';
  const {data:lines}=await supabaseAdminFetch(env,`pos_sale_lines?store_id=eq.${encodeURIComponent(storeId)}&sale_id=eq.${encodeURIComponent(saleId)}&select=id,item_id,quantity${selected}`);
  let count=0;
  for(const line of lines||[]){if(!/^[0-9a-f-]{36}$/i.test(String(line.item_id||'')))continue;const movement={store_id:storeId,inventory_item_id:line.item_id,sale_id:saleId,refund_id:refundId,sale_line_id:line.id,movement_type:'refund_restock',quantity:Number(line.quantity||1),created_by:userId};const {data:inserted}=await supabaseAdminFetch(env,'inventory_movements?on_conflict=refund_id,sale_line_id,movement_type',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(movement)});if(!inserted?.length)continue;const {data:items}=await supabaseAdminFetch(env,`inventory_items?id=eq.${line.item_id}&store_id=eq.${encodeURIComponent(storeId)}&select=id,data,status&limit=1`);const item=items?.[0];if(!item)continue;const data={...(item.data||{})};data.quantity=Number(data.quantity??data.qty??0)+Number(line.quantity||1);data.qty=data.quantity;data.status='in_stock';await supabaseAdminFetch(env,`inventory_items?id=eq.${line.item_id}&store_id=eq.${encodeURIComponent(storeId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({data,status:'in_stock'})});count++;}
  return count;
}

// Restocks every eligible line item of a voided sale. Unlike refunds, a void
// has no refund_id to key an idempotency-safe unique constraint off of, so
// callers must guarantee this only runs once per sale (handleVoidPosSale does
// that with a status-gated conditional update before calling this).
async function restockVoidedSaleLines(env,{storeId,saleId,lines,userId}){
  let count=0;
  for(const line of lines||[]){
    if(!/^[0-9a-f-]{36}$/i.test(String(line.item_id||'')))continue;
    const movement={store_id:storeId,inventory_item_id:line.item_id,sale_id:saleId,sale_line_id:line.id,movement_type:'void_restock',quantity:Number(line.quantity||1),created_by:userId};
    await supabaseAdminFetch(env,'inventory_movements',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(movement)});
    const {data:items}=await supabaseAdminFetch(env,`inventory_items?id=eq.${line.item_id}&store_id=eq.${encodeURIComponent(storeId)}&select=id,data,status&limit=1`);
    const item=items?.[0];if(!item)continue;
    const data={...(item.data||{})};
    data.quantity=Number(data.quantity??data.qty??0)+Number(line.quantity||1);
    data.qty=data.quantity;
    data.status='in_stock';
    data.lifecycle='in_stock';
    data['sold-out']=false;
    await supabaseAdminFetch(env,`inventory_items?id=eq.${line.item_id}&store_id=eq.${encodeURIComponent(storeId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({data,status:'in_stock'})});
    count++;
  }
  return count;
}

// Mirrors dashboard.html's normalizeTenderType() classification order — "cash
// app" must be checked before plain "cash" or Cash App sales would wrongly
// count as physical cash and get reversed against the cash drawer.
function isPhysicalCashTender(method){
  const raw=String(method||'').toLowerCase();
  if(raw.includes('cash app')||raw.includes('cashapp'))return false;
  return raw.includes('cash');
}

async function handleStripeFoundation(request, env, url) {
  const path = url.pathname;
  if(path==='/stripe/webhook'&&request.method==='POST')return handleStripeWebhookSecure(request,env);
  if (path === '/stripe/config-status' && request.method === 'GET') {
    const cfg = stripeConfig(env, url.searchParams.get('mode'));
    return json({ ok:true, mode:cfg.mode, publishableKeyPresent:!!cfg.publishableKey, secretKeyPresent:!!cfg.secretKey, webhookSecretPresent:!!cfg.webhookSecret, connectEnabled:!!cfg.secretKey });
  }
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const storeId = body.storeId;
  const ownerOnly = path.startsWith('/stripe/connect/') || path === '/stripe/refunds/create';
  const auth = await requireStoreUser(request, env, storeId, ownerOnly ? ['owner','admin'] : ['owner','admin','manager','employee']);
  if (auth.error) return auth.error;
  const mode = stripeMode(env, body.mode);

  if (path === '/stripe/connect/account') {
    let row = await getStripeAccountRow(env, storeId, mode);
    let account;
    if (row?.connected_account_id) account = await stripeApi(env, mode, `accounts/${encodeURIComponent(row.connected_account_id)}`);
    else {
      const { data:stores } = await supabaseAdminFetch(env, `stores?id=eq.${encodeURIComponent(storeId)}&select=id,name,display_name,currency&limit=1`);
      const store = stores?.[0]; if (!store) return json({ ok:false, error:'Store not found' }, 404);
      const params = new URLSearchParams({ country:String(body.country || 'US').toUpperCase(), 'controller[fees][payer]':'account', 'controller[stripe_dashboard][type]':'full', 'capabilities[card_payments][requested]':'true', 'capabilities[transfers][requested]':'true', 'metadata[arsca_store_id]':storeId, 'business_profile[name]':store.display_name || store.name || 'ArSca Store' });
      account = await stripeApi(env, mode, 'accounts', { method:'POST', params, idempotencyKey:`arsca-connect-${mode}-${storeId}` });
    }
    const status = safeStripeAccount(account, mode); await saveStripeAccount(env, storeId, status); return json({ ok:true, ...status });
  }
  if (path === '/stripe/connect/status') {
    const row = await getStripeAccountRow(env, storeId, mode); if (!row) return json({ ok:true, mode, onboardingStatus:'not_started', chargesEnabled:false, payoutsEnabled:false, feePayerVerified:false });
    const account = await stripeApi(env, mode, `accounts/${encodeURIComponent(row.connected_account_id)}`); const status=safeStripeAccount(account,mode);await saveStripeAccount(env,storeId,status);return json({ok:true,...status});
  }
  if (path === '/stripe/connect/onboarding-link') {
    const row=await getStripeAccountRow(env,storeId,mode);if(!row)return json({ok:false,error:'Create the connected account first'},409);
    const origin=String(body.returnUrl || request.headers.get('Origin') || url.origin).replace(/\/$/,'');
    const link=await stripeApi(env,mode,'account_links',{method:'POST',params:new URLSearchParams({account:row.connected_account_id,refresh_url:`${origin}/dashboard.html?stripe=refresh`,return_url:`${origin}/dashboard.html?stripe=return`,type:'account_onboarding'})});return json({ok:true,url:link.url,expiresAt:link.expires_at});
  }
  if (path === '/stripe/connect/dashboard-link') {
    const row=await getStripeAccountRow(env,storeId,mode);if(!row)return json({ok:false,error:'No connected account'},404);
    if(row.account_type==='express'){const link=await stripeApi(env,mode,`accounts/${encodeURIComponent(row.connected_account_id)}/login_links`,{method:'POST',params:new URLSearchParams()});return json({ok:true,url:link.url});}
    return json({ok:true,url:mode==='live'?'https://dashboard.stripe.com/':'https://dashboard.stripe.com/test/',message:'Standard accounts sign in to their own Stripe Dashboard.'});
  }
  if (path === '/stripe/payments/create-intent') {
    if(env.LBA_KV){const raw=await env.LBA_KV.get(`sub:store:${storeId}`).catch(()=>null);const rec=raw?JSON.parse(raw):null;if(rec?.plan_code&&rec.plan_code==='research')return json({ok:false,error:'The Register plan or higher is required to take payments'},403);}
    const saleId=String(body.saleId||'');if(!saleId)return json({ok:false,error:'saleId is required'},400);
    const {data:sales}=await supabaseAdminFetch(env,`pos_sales?id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);const sale=sales?.[0];if(!sale)return json({ok:false,error:'Sale not found for this store'},404);
    const amount=Math.round(Number(sale.total||0)*100);if(amount<50)return json({ok:false,error:'Sale total must be at least $0.50'},400);if(body.amountCents!=null&&Math.round(Number(body.amountCents))!==amount)return json({ok:false,error:'Checkout amount changed; refresh the sale before charging'},409);
    const row=await getStripeAccountRow(env,storeId,mode);if(!row?.connected_account_id)return json({ok:false,error:'Stripe setup required for this store'},409);
    if(!row.charges_enabled)return json({ok:false,error:'Stripe onboarding is incomplete or charges are disabled'},409);
    if(mode==='live'&&!row.fee_payer_verified)return json({ok:false,error:'Live card charging is blocked until Stripe confirms this connected account pays processing fees'},409);
    const fee=stripeApplicationFee(env,amount);const params=new URLSearchParams({amount:String(amount),currency:String(body.currency||'usd').toLowerCase(),'automatic_payment_methods[enabled]':'true','metadata[arsca_sale_id]':saleId,'metadata[arsca_store_id]':storeId,'metadata[arsca_register_id]':String(body.metadata?.arscaRegisterId||''),'metadata[arsca_user_id]':auth.user.id});if(fee)params.set('application_fee_amount',String(fee));
    const pi=await stripeApi(env,mode,'payment_intents',{method:'POST',params,account:row.connected_account_id,idempotencyKey:`arsca-pay-${mode}-${saleId}-${Math.max(1,Number(body.attemptNumber||1))}`});
    const paymentId=body.paymentId||crypto.randomUUID();await supabaseAdminFetch(env,'pos_payments?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:paymentId,sale_id:saleId,store_id:storeId,method:'Stripe Card',amount:amount/100,status:pi.status,provider:'stripe',stripe_mode:mode,stripe_connected_account_id:row.connected_account_id,stripe_payment_intent_id:pi.id,currency:pi.currency,amount_cents:amount,application_fee_amount_cents:fee,processing_fee_paid_by:'connected_account',confirmed_by:auth.user.id,created_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    return json({ok:true,clientSecret:pi.client_secret,paymentIntentId:pi.id,paymentId,stripeAccount:row.connected_account_id,amountCents:amount,currency:pi.currency,applicationFeeAmount:fee,mode,publishableKey:stripeConfig(env,mode).publishableKey});
  }
  if (path === '/stripe/payments/status') {
    const row=await getStripeAccountRow(env,storeId,mode);if(!row)return json({ok:false,error:'Stripe setup required'},409);const pi=await stripeApi(env,mode,`payment_intents/${encodeURIComponent(body.paymentIntentId||'')}`,{account:row.connected_account_id});const charge=pi.latest_charge?await stripeApi(env,mode,`charges/${encodeURIComponent(pi.latest_charge)}`,{account:row.connected_account_id}):null;const card=charge?.payment_method_details?.card||{};
    const {data:paymentRows}=await supabaseAdminFetch(env,`pos_payments?store_id=eq.${encodeURIComponent(storeId)}&stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&select=id,sale_id,amount_cents&limit=1`);const payment=paymentRows?.[0];
    await supabaseAdminFetch(env,`pos_payments?store_id=eq.${encodeURIComponent(storeId)}&stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:pi.status,stripe_charge_id:charge?.id||null,card_brand:card.brand||null,card_last4:card.last4||null,confirmed_at:pi.status==='succeeded'?new Date().toISOString():null,updated_at:new Date().toISOString()})});
    if(pi.status==='succeeded'&&payment?.sale_id)await supabaseAdminFetch(env,`pos_sales?id=eq.${payment.sale_id}&store_id=eq.${encodeURIComponent(storeId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'completed',payment_status:'paid',refundable_remaining_cents:Number(payment.amount_cents||pi.amount_received||pi.amount),completed_at:new Date().toISOString()})});
    return json({ok:true,status:pi.status,paymentIntentId:pi.id,chargeId:charge?.id||'',brand:card.brand||'',last4:card.last4||'',amountCents:pi.amount_received||pi.amount,mode});
  }
  if (path === '/stripe/refunds/create') {
    const {data:payments}=await supabaseAdminFetch(env,`pos_payments?id=eq.${encodeURIComponent(body.paymentId||'')}&sale_id=eq.${encodeURIComponent(body.saleId||'')}&store_id=eq.${encodeURIComponent(storeId)}&provider=eq.stripe&select=*&limit=1`);const payment=payments?.[0];if(!payment)return json({ok:false,error:'Stripe payment not found'},404);if(!['succeeded','partially_refunded'].includes(payment.status))return json({ok:false,error:'Only successful Stripe payments can be refunded'},409);
    const amount=Math.round(Number(body.amountCents||0));const remaining=Number(payment.amount_cents||Math.round(Number(payment.amount)*100))-Number(payment.refunded_amount_cents||0);if(amount<=0||amount>remaining)return json({ok:false,error:`Refund must be between 1 and ${remaining} cents`},400);
    const actionId=String(body.actionId||crypto.randomUUID());const idem=`arsca-refund-${payment.id}-${actionId}`;const params=new URLSearchParams({payment_intent:payment.stripe_payment_intent_id,amount:String(amount),'metadata[arsca_sale_id]':payment.sale_id,'metadata[arsca_store_id]':storeId});if(['duplicate','fraudulent','requested_by_customer'].includes(body.reason))params.set('reason',body.reason);if(body.refundApplicationFee!==false&&Number(payment.application_fee_amount_cents||0)>0)params.set('refund_application_fee','true');
    const refund=await stripeApi(env,payment.stripe_mode,'refunds',{method:'POST',params,account:payment.stripe_connected_account_id,idempotencyKey:idem});const refundId=crypto.randomUUID();await supabaseAdminFetch(env,'pos_refunds',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id:refundId,store_id:storeId,sale_id:payment.sale_id,payment_id:payment.id,stripe_refund_id:refund.id,stripe_payment_intent_id:payment.stripe_payment_intent_id,stripe_charge_id:payment.stripe_charge_id,stripe_connected_account_id:payment.stripe_connected_account_id,stripe_mode:payment.stripe_mode,amount_cents:amount,currency:payment.currency||'usd',reason:body.reason||'requested_by_customer',internal_note:String(body.internalNote||'').slice(0,1000),status:refund.status||'pending',refund_application_fee:body.refundApplicationFee!==false,restock_mode:body.restockMode||'no_restock',line_item_ids:Array.isArray(body.lineItemIds)?body.lineItemIds:[],created_by:auth.user.id,idempotency_key:idem,stripe_reference:refund.id})});
    let restocked=0;if(body.restockMode==='restock'&&refund.status==='succeeded'){restocked=await restockRefundItems(env,{storeId,saleId:payment.sale_id,refundId,lineItemIds:body.lineItemIds,userId:auth.user.id});await supabaseAdminFetch(env,`pos_refunds?id=eq.${refundId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({restock_completed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});}
    const refunded=Number(payment.refunded_amount_cents||0)+amount;const nextStatus=refunded>=Number(payment.amount_cents)?'refunded':'partially_refunded';await supabaseAdminFetch(env,`pos_payments?id=eq.${payment.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:nextStatus,refunded_amount_cents:refunded,updated_at:new Date().toISOString()})});await supabaseAdminFetch(env,`pos_sales?id=eq.${payment.sale_id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({payment_status:nextStatus,refund_total_cents:refunded,refundable_remaining_cents:Math.max(0,Number(payment.amount_cents)-refunded),inventory_restock_status:body.restockMode==='restock'?'pending':'not_requested'})});
    return json({ok:true,refundId:refund.id,status:refund.status,amountCents:amount,saleRefundStatus:nextStatus,refundedApplicationFee:body.refundApplicationFee!==false,restockedItems:restocked});
  }
  return json({ok:false,error:'Stripe route not found'},404);
}

function adminPage(url) {
  return Math.max(0, Math.min(10000, Number(url.searchParams.get('offset') || 0)));
}

function adminLimit(url, fallback = 50) {
  return Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || fallback)));
}

function cleanAdminText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

const sRankKey = storeId => `entitlement:s_rank:store:${storeId}`;

async function getSRankEntitlement(env, storeId) {
  if (!env.LBA_KV || !storeId) return null;
  try {
    const raw = await env.LBA_KV.get(sRankKey(storeId));
    const record = raw ? JSON.parse(raw) : null;
    return record?.active === true ? record : null;
  } catch (_) {
    return null;
  }
}

async function storeHasSubscriptionAccess(env, storeId, subscription = undefined) {
  if (await getSRankEntitlement(env, storeId)) return true;
  let rec = subscription;
  if (rec === undefined && env.LBA_KV && storeId) {
    const raw = await env.LBA_KV.get(`sub:store:${storeId}`).catch(() => null);
    rec = raw ? JSON.parse(raw) : null;
  }
  const status = rec?.status || 'none';
  const endMs = status === 'trialing' ? rec?.trial_end : rec?.current_period_end;
  return (status === 'active' || status === 'trialing') && (!endMs || endMs > Date.now());
}

async function writePlatformAudit(env, actor, action, storeId, entityType, entityId, beforeData, afterData, reason) {
  const row = {
    actor_user_id:actor.id, action, target_store_id:storeId || null,
    entity_type:entityType, entity_id:String(entityId || ''),
    before_data:beforeData || {}, after_data:afterData || {}, reason:cleanAdminText(reason, 1000),
  };
  await supabaseAdminFetch(env, 'platform_admin_audit_log', {
    method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(row),
  });
}

async function handlePlatformAdmin(request, env, url) {
  const auth = await requirePlatformAdmin(request, env);
  if (auth.error) return auth.error;
  const path = url.pathname;

  if (path === '/admin/session' && request.method === 'GET') {
    return json({ ok:true, user:{ id:auth.user.id, email:auth.user.email }, role:auth.admin.role });
  }

  if (path === '/admin/stores' && request.method === 'GET') {
    const q = cleanAdminText(url.searchParams.get('q'), 80).toLowerCase();
    const limit = adminLimit(url, 100);
    const filter = q ? `&or=(name.ilike.*${encodeURIComponent(q)}*,display_name.ilike.*${encodeURIComponent(q)}*)` : '';
    const { data:stores, response } = await supabaseAdminFetch(env,
      `stores?select=id,name,display_name,status,timezone,currency,owner_user_id,created_at&order=created_at.desc&limit=${limit}&offset=${adminPage(url)}${filter}`,
      { headers:{ Prefer:'count=exact' } });
    const enriched = await Promise.all((stores || []).map(async store => {
      const id = encodeURIComponent(store.id);
      const [inventory, members, sales, activity] = await Promise.all([
        supabaseAdminFetch(env, `inventory_items?store_id=eq.${id}&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
        supabaseAdminFetch(env, `store_members?store_id=eq.${id}&active=eq.true&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
        supabaseAdminFetch(env, `pos_sales?store_id=eq.${id}&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
        supabaseAdminFetch(env, `pos_audit_log?store_id=eq.${id}&select=created_at,event_type&order=created_at.desc&limit=1`),
      ]);
      const count = result => Number(String(result.response.headers.get('content-range') || '').split('/')[1] || 0);
      return { ...store, inventoryCount:count(inventory), memberCount:count(members), saleCount:count(sales), lastActivity:activity.data?.[0] || null };
    }));
    return json({ ok:true, stores:enriched, total:Number(String(response.headers.get('content-range') || '').split('/')[1] || enriched.length) });
  }

  const storeMatch = path.match(/^\/admin\/stores\/([0-9a-f-]+)$/i);
  if (storeMatch && request.method === 'GET') {
    const id = encodeURIComponent(storeMatch[1]);
    const { data } = await supabaseAdminFetch(env, `stores?id=eq.${id}&select=*&limit=1`);
    if (!data?.[0]) return json({ ok:false, error:'Store not found' }, 404);
    return json({ ok:true, store:data[0] });
  }
  if (storeMatch && request.method === 'PATCH') {
    const body = await request.json();
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Edit reason is required' }, 400);
    const id = encodeURIComponent(storeMatch[1]);
    const { data:beforeRows } = await supabaseAdminFetch(env, `stores?id=eq.${id}&select=*&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json({ ok:false, error:'Store not found' }, 404);
    const allowed = {};
    if (body.display_name != null) allowed.display_name = cleanAdminText(body.display_name, 120);
    if (body.timezone != null) allowed.timezone = cleanAdminText(body.timezone, 80);
    if (body.currency != null) allowed.currency = cleanAdminText(body.currency, 8).toUpperCase();
    if (body.status != null && ['active','disabled'].includes(body.status)) allowed.status = body.status;
    const { data:afterRows } = await supabaseAdminFetch(env, `stores?id=eq.${id}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify(allowed) });
    await writePlatformAudit(env, auth.user, 'store.update', before.id, 'store', before.id, before, afterRows?.[0], reason);
    return json({ ok:true, store:afterRows?.[0] });
  }
  if (storeMatch && request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Delete reason is required' }, 400);
    const id = encodeURIComponent(storeMatch[1]);
    const { data:beforeRows } = await supabaseAdminFetch(env, `stores?id=eq.${id}&select=*&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json({ ok:false, error:'Store not found' }, 404);

    const expectedName = before.display_name || before.name || '';
    const confirmName = cleanAdminText(body.confirmName, 120);
    if (!confirmName || confirmName !== expectedName) {
      return json({ ok:false, error:`Type the store name exactly ("${expectedName}") to confirm permanent deletion` }, 400);
    }

    const countOf = r => Number(String(r.response.headers.get('content-range') || '').split('/')[1] || 0);
    const [invCount, saleCount, paymentCount, memberCount] = await Promise.all([
      supabaseAdminFetch(env, `inventory_items?store_id=eq.${id}&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
      supabaseAdminFetch(env, `pos_sales?store_id=eq.${id}&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
      supabaseAdminFetch(env, `pos_payments?store_id=eq.${id}&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
      supabaseAdminFetch(env, `store_members?store_id=eq.${id}&select=id&limit=1`, { headers:{ Prefer:'count=exact' } }),
    ]);
    const counts = { inventory:countOf(invCount), sales:countOf(saleCount), payments:countOf(paymentCount), members:countOf(memberCount) };
    const hasFinancialHistory = counts.sales > 0 || counts.payments > 0;
    if (hasFinancialHistory && body.force !== true) {
      return json({ ok:false, error:'This store has sales/payment history. Confirm again with force to permanently delete it and every related record.', counts }, 409);
    }

    // Audit the full snapshot and cascade counts before the row (and everything
    // referencing it via ON DELETE CASCADE) is gone for good.
    await writePlatformAudit(env, auth.user, 'store.delete', before.id, 'store', before.id, { ...before, cascadeCounts:counts }, {}, reason);
    await supabaseAdminFetch(env, `stores?id=eq.${id}`, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
    return json({ ok:true, deletedCounts:counts });
  }

  const sRankMatch = path.match(/^\/admin\/stores\/([0-9a-f-]+)\/s-rank$/i);
  if (sRankMatch && request.method === 'GET') {
    const entitlement = await getSRankEntitlement(env, sRankMatch[1]);
    return json({ ok:true, active:Boolean(entitlement), entitlement });
  }
  if (sRankMatch && request.method === 'POST') {
    if (!env.LBA_KV) return json({ ok:false, error:'KV not configured' }, 500);
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Grant reason is required' }, 400);
    const storeId = sRankMatch[1];
    const before = await getSRankEntitlement(env, storeId);
    const entitlement = { active:true, tier:'s_rank', grantedAt:new Date().toISOString(), grantedBy:auth.user.id, reason };
    await env.LBA_KV.put(sRankKey(storeId), JSON.stringify(entitlement));
    await writePlatformAudit(env, auth.user, 'entitlement.s_rank.grant', storeId, 'store_entitlement', storeId, before || {}, entitlement, reason);
    return json({ ok:true, active:true, entitlement });
  }
  if (sRankMatch && request.method === 'DELETE') {
    if (!env.LBA_KV) return json({ ok:false, error:'KV not configured' }, 500);
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Revocation reason is required' }, 400);
    const storeId = sRankMatch[1];
    const before = await getSRankEntitlement(env, storeId);
    const revoked = { ...(before || {}), active:false, revokedAt:new Date().toISOString(), revokedBy:auth.user.id, revokeReason:reason };
    await env.LBA_KV.put(sRankKey(storeId), JSON.stringify(revoked));
    await writePlatformAudit(env, auth.user, 'entitlement.s_rank.revoke', storeId, 'store_entitlement', storeId, before || {}, revoked, reason);
    return json({ ok:true, active:false });
  }

  const storeResource = path.match(/^\/admin\/stores\/([0-9a-f-]+)\/(inventory|sales|members)$/i);
  if (storeResource && request.method === 'GET') {
    const [, storeId, type] = storeResource;
    const id = encodeURIComponent(storeId);
    const limit = adminLimit(url);
    const offset = adminPage(url);
    if (type === 'inventory') {
      const status = cleanAdminText(url.searchParams.get('status'), 40);
      const statusFilter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
      const { data, response } = await supabaseAdminFetch(env, `inventory_items?store_id=eq.${id}${statusFilter}&select=id,store_id,data,status,created_at,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`, { headers:{ Prefer:'count=exact' } });
      return json({ ok:true, items:data || [], total:Number(String(response.headers.get('content-range') || '').split('/')[1] || 0) });
    }
    if (type === 'sales') {
      const { data, response } = await supabaseAdminFetch(env, `pos_sales?store_id=eq.${id}&select=id,subtotal,discount_total,tax_total,total,status,created_at,completed_at,created_by&order=created_at.desc&limit=${limit}&offset=${offset}`, { headers:{ Prefer:'count=exact' } });
      return json({ ok:true, sales:data || [], total:Number(String(response.headers.get('content-range') || '').split('/')[1] || 0) });
    }
    const { data, response } = await supabaseAdminFetch(env, `store_members?store_id=eq.${id}&select=id,store_id,user_id,role,active,created_at&order=created_at.asc&limit=${limit}&offset=${offset}`, { headers:{ Prefer:'count=exact' } });
    const memberRows = data || [];
    const userIds = [...new Set(memberRows.map(m => m.user_id).filter(Boolean))];
    let profileByUserId = {};
    if (userIds.length) {
      const orFilter = userIds.map(uid => `id.eq.${uid}`).join(',');
      const { data:profiles } = await supabaseAdminFetch(env, `profiles?or=(${orFilter})&select=id,email,display_name`);
      profileByUserId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    }
    const members = memberRows.map(m => ({ ...m, email:profileByUserId[m.user_id]?.email || null, display_name:profileByUserId[m.user_id]?.display_name || null }));
    return json({ ok:true, members, total:Number(String(response.headers.get('content-range') || '').split('/')[1] || 0) });
  }

  const inventoryMatch = path.match(/^\/admin\/inventory\/([0-9a-f-]+)$/i);
  if (inventoryMatch && request.method === 'PATCH') {
    const body = await request.json();
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Edit reason is required' }, 400);
    const id = encodeURIComponent(inventoryMatch[1]);
    const { data:beforeRows } = await supabaseAdminFetch(env, `inventory_items?id=eq.${id}&select=*&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json({ ok:false, error:'Inventory item not found' }, 404);
    if (body.expected_updated_at && body.expected_updated_at !== before.updated_at) return json({ ok:false, error:'Item changed since it was opened. Refresh and try again.' }, 409);
    const allowedData = { ...(before.data || {}) };
    for (const key of ['name','title','set','setName','category','condition','finish','quantity','qty','cost','market','listPrice','price','location','notes','image','imageUrl']) {
      if (body.data && Object.prototype.hasOwnProperty.call(body.data, key)) allowedData[key] = typeof body.data[key] === 'string' ? cleanAdminText(body.data[key], key === 'notes' ? 2000 : 500) : body.data[key];
    }
    const update = { data:allowedData };
    if (body.status != null) update.status = cleanAdminText(body.status, 40);
    const { data:afterRows } = await supabaseAdminFetch(env, `inventory_items?id=eq.${id}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify(update) });
    await writePlatformAudit(env, auth.user, 'inventory.update', before.store_id, 'inventory_item', before.id, before, afterRows?.[0], reason);
    return json({ ok:true, item:afterRows?.[0] });
  }
  if (inventoryMatch && request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Delete reason is required' }, 400);
    const id = encodeURIComponent(inventoryMatch[1]);
    const { data:beforeRows } = await supabaseAdminFetch(env, `inventory_items?id=eq.${id}&select=*&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json({ ok:false, error:'Inventory item not found' }, 404);
    await supabaseAdminFetch(env, `inventory_items?id=eq.${id}`, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
    await writePlatformAudit(env, auth.user, 'inventory.delete', before.store_id, 'inventory_item', before.id, before, {}, reason);
    return json({ ok:true });
  }

  if (path === '/admin/store-members' && request.method === 'POST') {
    const body = await request.json();
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Reason is required' }, 400);
    const storeId = cleanAdminText(body.store_id, 60);
    const email = cleanAdminText(body.email, 200).toLowerCase();
    const role = ['owner','admin','manager','employee','scanner_only'].includes(body.role) ? body.role : 'employee';
    if (!storeId || !email) return json({ ok:false, error:'store_id and email are required' }, 400);

    const { data:storeRows } = await supabaseAdminFetch(env, `stores?id=eq.${encodeURIComponent(storeId)}&select=id&limit=1`);
    if (!storeRows?.[0]) return json({ ok:false, error:'Store not found' }, 404);

    // GET /auth/v1/admin/users does not support filtering by exact email — it
    // returns an unfiltered page of users, so matching users[0] against the
    // typed email is unsafe (it can silently grab an unrelated account).
    // public.profiles is kept in sync with auth.users via the on_auth_user_created
    // trigger and is safe to filter with a normal PostgREST eq. query.
    const { data:profileRows } = await supabaseAdminFetch(env, `profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    const foundUserId = profileRows?.[0]?.id || null;

    if (foundUserId) {
      const { data:existingRows } = await supabaseAdminFetch(env, `store_members?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(foundUserId)}&select=id&limit=1`);
      let afterRows;
      if (existingRows?.[0]) {
        ({ data:afterRows } = await supabaseAdminFetch(env, `store_members?id=eq.${encodeURIComponent(existingRows[0].id)}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ role, active:true }) }));
      } else {
        ({ data:afterRows } = await supabaseAdminFetch(env, 'store_members', { method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ store_id:storeId, user_id:foundUserId, role, active:true }) }));
      }
      await writePlatformAudit(env, auth.user, 'store_member.add', storeId, 'store_member', afterRows?.[0]?.id || foundUserId, {}, { ...afterRows?.[0], email }, reason);
      return json({ ok:true, status:'added', member:afterRows?.[0] });
    }

    const { data:inviteRows } = await supabaseAdminFetch(env, 'store_invites?on_conflict=store_id,email', {
      method:'POST',
      headers:{ Prefer:'return=representation,resolution=merge-duplicates' },
      body:JSON.stringify({ store_id:storeId, email, role, invited_by:auth.user.id, accepted_by:null, accepted_at:null }),
    });
    await writePlatformAudit(env, auth.user, 'store_member.invite', storeId, 'store_invite', inviteRows?.[0]?.id || email, {}, inviteRows?.[0] || { email, role }, reason);
    return json({ ok:true, status:'invited', invite:inviteRows?.[0] });
  }

  const memberMatch = path.match(/^\/admin\/store-members\/([0-9a-f-]+)$/i);
  if (memberMatch && request.method === 'PATCH') {
    const body = await request.json();
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Edit reason is required' }, 400);
    const id = encodeURIComponent(memberMatch[1]);
    const { data:beforeRows } = await supabaseAdminFetch(env, `store_members?id=eq.${id}&select=*&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json({ ok:false, error:'Store member not found' }, 404);
    const update = {};
    if (body.role != null && ['owner','admin','manager','employee','scanner_only'].includes(body.role)) update.role = body.role;
    if (body.active != null) update.active = Boolean(body.active);
    const { data:afterRows } = await supabaseAdminFetch(env, `store_members?id=eq.${id}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify(update) });
    await writePlatformAudit(env, auth.user, 'store_member.update', before.store_id, 'store_member', before.id, before, afterRows?.[0], reason);
    return json({ ok:true, member:afterRows?.[0] });
  }
  if (memberMatch && request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Delete reason is required' }, 400);
    const id = encodeURIComponent(memberMatch[1]);
    const { data:beforeRows } = await supabaseAdminFetch(env, `store_members?id=eq.${id}&select=*&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json({ ok:false, error:'Store member not found' }, 404);
    await supabaseAdminFetch(env, `store_members?id=eq.${id}`, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
    await writePlatformAudit(env, auth.user, 'store_member.remove', before.store_id, 'store_member', before.id, before, {}, reason);
    return json({ ok:true });
  }

  const resetPasswordMatch = path.match(/^\/admin\/store-members\/([0-9a-f-]+)\/reset-password$/i);
  if (resetPasswordMatch && request.method === 'POST') {
    // The actual Supabase Auth recovery email is triggered client-side via
    // sb.auth.resetPasswordForEmail(), which is a public GoTrue endpoint that
    // does not touch platform_admin_audit_log (RLS blocks authenticated
    // writes there). This route only records that a platform admin triggered
    // a reset, after the client-side call already succeeded.
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Reason is required' }, 400);
    const id = encodeURIComponent(resetPasswordMatch[1]);
    const { data:memberRows } = await supabaseAdminFetch(env, `store_members?id=eq.${id}&select=id,store_id,user_id&limit=1`);
    const member = memberRows?.[0];
    if (!member) return json({ ok:false, error:'Store member not found' }, 404);
    const email = cleanAdminText(body.email, 200);
    await writePlatformAudit(env, auth.user, 'store_member.reset_password', member.store_id, 'store_member', member.id, {}, { email }, reason);
    return json({ ok:true });
  }

  const setPasswordMatch = path.match(/^\/admin\/store-members\/([0-9a-f-]+)\/set-password$/i);
  if (setPasswordMatch && request.method === 'POST') {
    // Directly sets a user's password via the GoTrue admin API. This bypasses
    // the recovery-email flow entirely (no email is sent, so it also bypasses
    // that endpoint's rate limit), for cases like a locked-out account or an
    // exhausted email quota. The password value itself must never be written
    // to platform_admin_audit_log or logged anywhere.
    const body = await request.json().catch(() => ({}));
    const reason = cleanAdminText(body.reason, 1000);
    if (!reason) return json({ ok:false, error:'Reason is required' }, 400);
    const password = String(body.password || '');
    if (password.length < 8) return json({ ok:false, error:'Password must be at least 8 characters' }, 400);
    const id = encodeURIComponent(setPasswordMatch[1]);
    const { data:memberRows } = await supabaseAdminFetch(env, `store_members?id=eq.${id}&select=id,store_id,user_id&limit=1`);
    const member = memberRows?.[0];
    if (!member) return json({ ok:false, error:'Store member not found' }, 404);
    const { base, key } = supabaseAdminConfig(env);
    const resp = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(member.user_id)}`, {
      method:'PUT',
      headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => null);
      return json({ ok:false, error: errData?.msg || errData?.message || `Password update failed (${resp.status})` }, 502);
    }
    await writePlatformAudit(env, auth.user, 'store_member.set_password', member.store_id, 'store_member', member.id, {}, { passwordManuallySet:true }, reason);
    return json({ ok:true });
  }

  if (path === '/admin/audit' && request.method === 'GET') {
    const store = cleanAdminText(url.searchParams.get('storeId'), 40);
    const filter = store ? `&target_store_id=eq.${encodeURIComponent(store)}` : '';
    const { data } = await supabaseAdminFetch(env, `platform_admin_audit_log?select=*&order=created_at.desc&limit=${adminLimit(url, 100)}&offset=${adminPage(url)}${filter}`);
    return json({ ok:true, entries:data || [] });
  }
  return json({ ok:false, error:'Admin route not found' }, 404);
}

const MTG_CATALOG_FILE_TYPES = new Set(['cards', 'marketprices', 'prices', 'links', 'sets']);
// Shared PriceCharting business-download catalogs. Pokemon intentionally stays on
// PokemonPriceTracker exports and MTG keeps its Scryfall + PriceCharting pipeline.
const PRICECHARTING_OFFLINE_CATEGORIES = new Set([
  'video_games', 'yugioh', 'one_piece',
]);

function r2ObjectResponse(object, request, cacheControl) {
  if (!object) return json({ ok: false, error: 'MTG catalog object not found' }, 404);
  const headers = new Headers(CORS);
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag || `"${object.etag}"`);
  headers.set('Cache-Control', cacheControl);
  headers.set('Vary', 'If-None-Match');
  if (!('body' in object)) return new Response(null, { status: request.headers.has('If-None-Match') ? 304 : 412, headers });
  return new Response(object.body, { status: 200, headers });
}

// ── Topps catalog auto-update: dashboard-triggered scrape -> parse -> merge ──
// -> publish, entirely inside the Worker (no GitHub Actions / local Python).
// Mirrors scripts/topps/merge-and-publish.mjs + build-offline-bundle.mjs so the
// R2 layout/manifest shape stays identical to what the CI pipeline already publishes.

async function gunzipJsonlFromR2(object) {
  if (!object) return [];
  const ds = new DecompressionStream('gzip');
  const decompressed = object.body.pipeThrough(ds);
  const text = await new Response(decompressed).text();
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

async function gzipJsonl(rows) {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const encoder = new TextEncoder();
  const writeDone = (async () => {
    for (const row of rows) {
      await writer.write(encoder.encode(JSON.stringify(row) + '\n'));
    }
    await writer.close();
  })();
  const chunks = [];
  const reader = cs.readable.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writeDone;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function toppsCardDedupeKey(card = {}) {
  return [card.setId, card.section, card.cardNumber, card.subject || card.player].map(v => String(v || '').toLowerCase().trim()).join('|');
}

// The live cards file has ~426,000+ records -- gunzipJsonlFromR2's "decompress
// the whole thing into one string, split, parse into one array" approach blew
// the Worker's memory limit once the real catalog got merged against (a real
// production failure: "Memory limit exceeded before EOF"). This streams the
// existing cards one line at a time instead of materializing all of them.
async function* streamJsonlFromR2(object) {
  if (!object) return;
  const ds = new DecompressionStream('gzip');
  const reader = object.body.pipeThrough(ds).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer);
}

// Companion to streamJsonlFromR2 -- writes rows into a gzip stream one at a
// time instead of building a full array + one giant JSON string before
// compressing, so re-publishing the merged cards file never needs the whole
// (very large) card list resident in memory simultaneously.
function createGzipJsonlWriter() {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const encoder = new TextEncoder();
  const chunks = [];
  let total = 0;
  const readerDone = (async () => {
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  })();
  return {
    async write(row) { await writer.write(encoder.encode(JSON.stringify(row) + '\n')); },
    async finish() {
      await writer.close();
      await readerDone;
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
      return out;
    },
  };
}

function mergeToppsSetsWithCounts(existingSets, newSets, cardCountBySet) {
  const bySetId = new Map(existingSets.map(s => [s.id, s]));
  for (const set of newSets) bySetId.set(set.id, { ...bySetId.get(set.id), ...set });
  for (const set of bySetId.values()) set.cardCount = cardCountBySet.get(set.id) || set.cardCount || 0;
  return [...bySetId.values()];
}

function compactToppsCard(row = {}, generatedAt) {
  return { id: row.id, setId: row.setId, sourceId: row.sourceId, year: row.year, brand: row.brand, product: row.product, sport: row.sport, setName: row.setName, releaseName: row.releaseName, cardNumber: row.cardNumber, player: row.player, subject: row.subject, team: row.team, notes: row.notes, section: row.section, flags: row.flags || {}, parseConfidence: Number(row.parseConfidence || 0), searchText: row.searchText || '', updatedAt: row.updatedAt || generatedAt };
}

function compactToppsSet(row = {}, generatedAt) {
  return { id: row.id, year: row.year, brand: row.brand, product: row.product, sport: row.sport, setName: row.setName, releaseName: row.releaseName, cardCount: Number(row.cardCount || 0), updatedAt: row.updatedAt || generatedAt };
}

function pokemonQuotaHeaders(headers) {
  const out = {};
  for (const [from, to] of [
    ['X-RateLimit-Remaining', 'X-PokemonPriceTracker-RateLimit-Remaining'],
    ['X-RateLimit-Daily-Remaining', 'X-PokemonPriceTracker-Daily-Remaining'],
    ['X-RateLimit-Reset', 'X-PokemonPriceTracker-RateLimit-Reset'],
    ['X-API-Calls-Consumed', 'X-PokemonPriceTracker-Calls-Consumed'],
    ['X-API-Calls-Breakdown', 'X-PokemonPriceTracker-Calls-Breakdown'],
  ]) {
    const value = headers.get(from);
    if (value != null) out[to] = value;
  }
  return out;
}

function errorMessageFromApi(data, fallback = 'API error') {
  return data?.msg
    || data?.message
    || data?.error?.message
    || data?.errors?.[0]?.longMessage
    || data?.errors?.[0]?.message
    || fallback;
}

function normalizeWebflowItemId(item) {
  return item?.shopId || item?.wfId || item?.webflowId || null;
}

function safeStoreKey(s) {
  return String(s || 'main').replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80);
}

function cartKeyFromUrl(url) {
  const store = safeStoreKey(url.searchParams.get('store') || 'main');
  const register = safeStoreKey(url.searchParams.get('register') || 'front');
  return `pos_cart:${store}:${register}`;
}

function legacyCartKey(url) {
  const hasScopedKey = url.searchParams.has('store') || url.searchParams.has('register');
  return hasScopedKey ? cartKeyFromUrl(url) : 'pos_cart';
}

async function getStoredSecret(env, key) {
  if (env[key]) return env[key];
  try {
    const val = env.LBA_KV ? await env.LBA_KV.get('secret:' + key) : null;
    return val || '';
  } catch (_) {
    return '';
  }
}

async function putStoredSecret(env, key, value) {
  if (!env.LBA_KV || !value) return false;
  await env.LBA_KV.put('secret:' + key, value);
  return true;
}

async function ebayTokenRequest(env, params) {
  const clientId = await getStoredSecret(env, 'EBAY_CLIENT_ID');
  const clientSecret = await getStoredSecret(env, 'EBAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required');
  const res = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) throw new Error(errorMessageFromApi(data, 'eBay OAuth ' + res.status));
  return data;
}

async function getEbayUserAccessToken(env) {
  const refreshToken = await getStoredSecret(env, 'EBAY_REFRESH_TOKEN');
  if (!refreshToken) return '';

  const cached = env.LBA_KV ? await env.LBA_KV.get('secret:EBAY_ACCESS_TOKEN') : null;
  const exp = env.LBA_KV ? Number(await env.LBA_KV.get('secret:EBAY_ACCESS_EXPIRES') || 0) : 0;
  if (cached && exp > Date.now() + 120000) return cached;

  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const data = await ebayTokenRequest(env, params);
  const accessToken = data.access_token;
  if (accessToken && env.LBA_KV) {
    await env.LBA_KV.put('secret:EBAY_ACCESS_TOKEN', accessToken, { expirationTtl: Math.max(300, Number(data.expires_in || 7200)) });
    await env.LBA_KV.put('secret:EBAY_ACCESS_EXPIRES', String(Date.now() + Number(data.expires_in || 7200) * 1000));
  }
  return accessToken || '';
}

function leftRotate(x, c) {
  return (x << c) | (x >>> (32 - c));
}

function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const originalLength = bytes.length;
  const withOne = originalLength + 1;
  const paddedLength = (((withOne + 8 + 63) >> 6) << 6);
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[originalLength] = 0x80;
  const bitLength = originalLength * 8;
  for (let i = 0; i < 8; i++) {
    buffer[paddedLength - 8 + i] = Math.floor(bitLength / (2 ** (8 * i))) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

  for (let chunk = 0; chunk < buffer.length; chunk += 64) {
    const m = new Array(16);
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      m[i] = (buffer[j] | (buffer[j + 1] << 8) | (buffer[j + 2] << 16) | (buffer[j + 3] << 24)) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      b = (b + leftRotate((a + f + k[i] + m[g]) >>> 0, s[i])) >>> 0;
      a = tmp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(n =>
    [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
      .map(b => b.toString(16).padStart(2, '0')).join('')
  ).join('');
}

async function readApiJson(res) {
  const text = await res.text();
  try {
    return { text, data: JSON.parse(text) };
  } catch (_) {
    return { text, data: { raw: text } };
  }
}

function compMoneyValue(v) {
  if (typeof v === 'number') return v > 0 ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,]/g, '').trim());
    return n > 0 ? n : 0;
  }
  if (!v || typeof v !== 'object') return 0;
  for (const key of ['total', 'price', 'value', 'amount', 'soldPrice', 'sold_price', 'salePrice', 'currentPrice']) {
    const n = compMoneyValue(v[key]);
    if (n) return n;
  }
  return 0;
}

function normalizeSoldComp(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const price = compMoneyValue(raw.price || raw.soldPrice || raw.sold_price || raw.salePrice || raw.amount || raw.currentPrice || raw.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__']);
  const shipping = compMoneyValue(raw.shipping || raw.shippingPrice || raw.shippingCost || raw.shipping_cost || raw.shippingInfo?.[0]?.shippingServiceCost?.[0]?.['__value__']);
  const total = compMoneyValue(raw.total || raw.totalPrice || raw.total_price) || price + shipping;
  if (!price && !total) return null;
  const soldAt = raw.soldAt || raw.sold_at || raw.endedAt || raw.endTime || raw.end_time || raw.date || raw.timestamp || raw.listingEndedAt || raw.listingInfo?.[0]?.endTime?.[0] || null;
  return {
    title: String(raw.title || raw.name || raw.itemTitle || raw.item_title || 'Sold comp').trim(),
    price: Math.round(price * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    total: Math.round((total || price) * 100) / 100,
    soldAt,
    currency: raw.soldCurrency || raw.currency || 'USD',
    condition: raw.condition || raw.conditionDisplayName || raw.condition_name || null,
    url: raw.url || raw.itemUrl || raw.item_url || raw.viewItemURL?.[0] || raw.webUrl || null,
    imageUrl: raw.imageUrl || raw.image_url || raw.thumbnail || raw.galleryURL?.[0] || raw.image?.imageUrl || null,
    source,
  };
}

function soldCompStats(comps) {
  const values = comps.map(c => Number(c.total || c.price || 0)).filter(v => v > 0).sort((a, b) => a - b);
  if (!values.length) return { count: 0, avg: 0, median: 0, min: 0, max: 0, trendPct: 0, trendLabel: 'no data' };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const dated = comps
    .map(c => ({ ...c, time: c.soldAt ? Date.parse(c.soldAt) : 0 }))
    .filter(c => c.time && Number(c.total || c.price || 0) > 0)
    .sort((a, b) => a.time - b.time);
  let trendPct = 0;
  if (dated.length >= 6) {
    const slice = Math.max(3, Math.floor(dated.length / 3));
    const oldAvg = dated.slice(0, slice).reduce((a, c) => a + Number(c.total || c.price || 0), 0) / slice;
    const newAvg = dated.slice(-slice).reduce((a, c) => a + Number(c.total || c.price || 0), 0) / slice;
    trendPct = oldAvg > 0 ? ((newAvg - oldAvg) / oldAvg) * 100 : 0;
  }
  return {
    count: values.length,
    avg: Math.round(avg * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: Math.round(values[0] * 100) / 100,
    max: Math.round(values[values.length - 1] * 100) / 100,
    trendPct: Math.round(trendPct * 10) / 10,
    trendLabel: Math.abs(trendPct) < 4 ? 'flat' : (trendPct > 0 ? 'up' : 'down'),
  };
}

function soldCompBuckets(comps) {
  const byDay = new Map();
  for (const c of comps) {
    const t = c.soldAt ? Date.parse(c.soldAt) : 0;
    const val = Number(c.total || c.price || 0);
    if (!t || !val) continue;
    const key = new Date(t).toISOString().slice(0, 10);
    const row = byDay.get(key) || { date: key, count: 0, sum: 0, avg: 0 };
    row.count += 1;
    row.sum += val;
    byDay.set(key, row);
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({ date: r.date, count: r.count, avg: Math.round((r.sum / r.count) * 100) / 100 }));
}

function compTokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w#/. -]+/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length > 1 && !['the', 'and', 'for', 'with', 'card', 'cards', 'tcg'].includes(t));
}

function compQualityScore(comp, query, mode = '') {
  const title = String(comp.title || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  const isSealedQuery = /\b(sealed|pack|box|booster|case|tin|etb|elite trainer|bundle|blaster|mega|hobby)\b/i.test(q) || mode === 'sealed';
  const bad = /\b(lot|bundle|pick|choose|custom|proxy|orica|reprint|replica|facsimile|digital|box|booster|pack|packs|break|case|empty|wrapper|label|stand|display)\b/i;
  let score = 0;
  if (bad.test(title) && !isSealedQuery) return -999;
  if (!isSealedQuery && /\b(unopened|factory sealed|wax|hobby box|blaster box|booster box|booster pack|mega box|etb)\b/i.test(title)) return -999;
  const queryYear = q.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  if (queryYear && !title.includes(queryYear)) return -999;
  const wanted = compTokens(q)
    .filter(t => !['raw', 'sold', 'psa', 'bgs', 'cgc', 'sgc', 'ungraded'].includes(t));
  for (const t of wanted) if (title.includes(t)) score += 8;
  if (wanted.length && wanted.every(t => title.includes(t))) score += 18;
  const wantsGrade = (q.match(/\b(psa|bgs|cgc|sgc)\s*(10|9\.5|9|8|8\.5|7|6|5|4|3|2|1|a)\b/i) || [])[0];
  if (wantsGrade) {
    const normalizedTitle = title.replace(/\s+/g, ' ');
    const normalizedGrade = wantsGrade.toLowerCase().replace(/\s+/, ' ');
    if (normalizedTitle.includes(normalizedGrade)) score += 32;
    else score -= 18;
    const wantedCompany = (wantsGrade.match(/\b(psa|bgs|cgc|sgc)\b/i) || [])[1]?.toLowerCase();
    const wantedGrade = (wantsGrade.match(/\b(10|9\.5|9|8|8\.5|7|6|5|4|3|2|1|a)\b/i) || [])[1];
    const actualGrade = normalizedTitle.match(new RegExp('\\b' + wantedCompany + '\\s*(10|9\\.5|9|8\\.5|8|7|6|5|4|3|2|1|a)\\b', 'i'))?.[1];
    if (wantedCompany && wantedGrade && actualGrade && actualGrade !== wantedGrade) score -= 70;
    if (wantedCompany && wantedGrade && !actualGrade) return -999;
  }
  if (mode === 'raw') {
    if (/\b(psa|bgs|cgc|sgc)\b/i.test(title)) score -= 35;
    else score += 10;
  }
  if (mode === 'graded' && /\b(psa|bgs|cgc|sgc)\b/i.test(title)) score += 12;
  return score;
}

function filterSoldComps(comps, query, mode = '') {
  const scored = comps
    .map(c => ({ ...c, qualityScore: compQualityScore(c, query, mode) }))
    .filter(c => c.qualityScore > 0);
  const deduped = [];
  const seen = new Set();
  for (const c of scored) {
    const key = [
      String(c.url || '').split('?')[0],
      String(c.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 120),
      Number(c.total || c.price || 0).toFixed(2),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  const values = deduped.map(c => Number(c.total || c.price || 0)).filter(v => v > 0).sort((a, b) => a - b);
  if (values.length >= 5) {
    const q1 = values[Math.floor(values.length * 0.25)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const iqr = Math.max(1, q3 - q1);
    const low = Math.max(0, q1 - iqr * 1.75);
    const high = q3 + iqr * 1.75;
    return deduped.filter(c => Number(c.total || c.price || 0) >= low && Number(c.total || c.price || 0) <= high);
  }
  return deduped;
}

async function fetchEbaySoldComps(env, query, limit = 40) {
  const appId = env.EBAY_APP_ID || await getStoredSecret(env, 'EBAY_CLIENT_ID');
  if (!appId) return { source: 'none', comps: [], warning: 'EBAY_APP_ID not set' };
  const findRes = await fetch(
    `https://svcs.ebay.com/services/search/FindingService/v1` +
    `?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0` +
    `&SECURITY-APPNAME=${appId}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD` +
    `&GLOBAL-ID=EBAY-US` +
    `&keywords=${encodeURIComponent(query)}` +
    `&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true` +
    `&sortOrder=EndTimeSoonest&paginationInput.entriesPerPage=${Math.min(100, Math.max(10, limit))}`
  );
  const { data } = await readApiJson(findRes);
  if (!findRes.ok) return { source: 'ebay_sold', comps: [], warning: 'Finding API ' + findRes.status };
  const root = data.findCompletedItemsResponse?.[0] || {};
  const ack = root.ack?.[0] || '';
  const errMsg = root.errorMessage?.[0]?.error?.[0]?.message?.[0] || '';
  if (ack && !['Success', 'Warning'].includes(ack)) return { source: 'ebay_sold', comps: [], warning: errMsg || ack };
  const items = root.searchResult?.[0]?.item || [];
  return {
    source: 'ebay_sold',
    comps: items.map(i => normalizeSoldComp(i, 'ebay_sold')).filter(Boolean),
    warning: errMsg || null,
  };
}

async function fetchSoldCompsProvider(env, query, limit = 40) {
  if (!env.SOLDCOMPS_API_KEY) return { source: 'none', comps: [], warning: 'SOLDCOMPS_API_KEY not set' };
  const base = (env.SOLDCOMPS_BASE || 'https://api.sold-comps.com').replace(/\/+$/, '');
  const maxResults = Math.min(240, Math.max(10, limit));
  const keyword = encodeURIComponent(query);
  const qs = `q=${keyword}&query=${keyword}&keyword=${keyword}&limit=${maxResults}&count=${maxResults}`;
  const urls = [
    `${base}/v1/scrape?keyword=${keyword}&count=${maxResults}`,
    `${base}/v1/scrape?keyword=${keyword}&limit=${maxResults}`,
    `${base}/v1/search?${qs}`,
    `${base}/search?${qs}`,
    `${base}/api/search?${qs}`,
    `${base}/v1/sales?${qs}`,
  ];
  let lastWarning = '';
  for (const apiUrl of urls) {
    try {
      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': 'Bearer ' + env.SOLDCOMPS_API_KEY,
          'x-api-key': env.SOLDCOMPS_API_KEY,
          'X-API-Key': env.SOLDCOMPS_API_KEY,
          'api-key': env.SOLDCOMPS_API_KEY,
          'Accept': 'application/json',
        },
      });
      const { data, text } = await readApiJson(res);
      if (!res.ok) {
        lastWarning = 'SoldComps ' + res.status + ': ' + errorMessageFromApi(data, text.slice(0, 80));
        continue;
      }
      const rows = Array.isArray(data) ? data
        : (data.results || data.items || data.sales || data.comps || data.data || []);
      const comps = (Array.isArray(rows) ? rows : []).map(r => normalizeSoldComp(r, 'soldcomps')).filter(Boolean);
      if (comps.length) return { source: 'soldcomps', comps, warning: null };
      lastWarning = 'SoldComps returned no comps';
    } catch (e) {
      lastWarning = e.message;
    }
  }
  return { source: 'soldcomps', comps: [], warning: lastWarning || 'SoldComps unavailable' };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
    const url = new URL(request.url);

    if (url.pathname === '/admin/session' || url.pathname.startsWith('/admin/')) {
      return await handlePlatformAdmin(request, env, url);
    }

    if (url.pathname === '/stripe/config-status' || url.pathname === '/stripe/webhook' || url.pathname.startsWith('/stripe/connect/') || url.pathname.startsWith('/stripe/payments/') || url.pathname === '/stripe/refunds/create') {
      return await handleStripeFoundation(request, env, url);
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        ts: Date.now(),
        webflow: !!env.WEBFLOW_TOKEN,
        anthropic: !!env.ANTHROPIC_API_KEY,
        cardsight: !!env.CARDSIGHTAI_API_KEY,
        psa: !!env.PSA_TOKEN,
        stripe: !!(env.STRIPE_SECRET_KEY_TEST || env.STRIPE_SECRET_KEY_LIVE || env.STRIPE_SECRET_KEY),
        ebay: !!env.EBAY_USER_TOKEN,
        ebayClient: !!(env.EBAY_CLIENT_ID || (env.LBA_KV && await env.LBA_KV.get('secret:EBAY_CLIENT_ID'))),
        ebayRefresh: !!(env.EBAY_REFRESH_TOKEN || (env.LBA_KV && await env.LBA_KV.get('secret:EBAY_REFRESH_TOKEN'))),
        comicvine: !!env.COMICVINE_API_KEY,
        metron: !!(env.METRON_USER && env.METRON_PASS),
        justtcg: !!env.JUSTTCG_API_KEY,
        pricecharting: !!(env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY),
        tcgapi: !!env.TCGAPI_KEY,
        pokemontcg: !!env.POKEMONTCG_API_KEY,
        pokemonprice: !!(env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY),
        soldcomps: !!env.SOLDCOMPS_API_KEY,
        kv: !!env.LBA_KV,
        mtgCatalogR2: !!env.MTG_CATALOG_R2,
        supabaseAdmin: !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY)),
      });
    }

    if (url.pathname === '/store/invites' && request.method === 'GET') {
      const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
      const auth = await requireStoreUser(request, env, storeId, ['owner','admin']);
      if (auth.error) return auth.error;
      const { data, response } = await supabaseAdminFetch(env,
        `store_invites?store_id=eq.${encodeURIComponent(storeId)}&select=id,email,role,expires_at,accepted_at,created_at,email_status,email_sent_at,email_error&order=created_at.desc`);
      if (!response.ok) return json({ ok:false, error:'Invites unavailable' }, 502);
      return json({ ok:true, invites:data || [] });
    }

    if (url.pathname === '/store/storefront-orders' && request.method === 'GET') {
      const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const { data:orders, response } = await supabaseAdminFetch(env,
        `storefront_orders?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=created_at.desc&limit=200`);
      if (!response.ok) return json({ ok:false, error:'Orders unavailable' }, 502);
      const saleIds = [...new Set((orders || []).map(o => o.sale_id))];
      let sales = [], lines = [];
      if (saleIds.length) {
        const idList = saleIds.map(id => encodeURIComponent(id)).join(',');
        ({ data:sales } = await supabaseAdminFetch(env, `pos_sales?id=in.(${idList})&store_id=eq.${encodeURIComponent(storeId)}&select=id,total,status,payment_status,completed_at`));
        ({ data:lines } = await supabaseAdminFetch(env, `pos_sale_lines?sale_id=in.(${idList})&store_id=eq.${encodeURIComponent(storeId)}&select=sale_id,item_id,title,category,quantity,unit_price,image_url`));
      }
      const salesById = Object.fromEntries((sales || []).map(s => [s.id, s]));
      const linesBySale = {};
      (lines || []).forEach(l => { (linesBySale[l.sale_id] ||= []).push(l); });
      // A storefront_orders row is created as soon as the checkout form is
      // submitted, before the customer ever confirms payment with Stripe —
      // only surface it here once the sale actually completed, so an
      // abandoned/incomplete checkout doesn't show up as a real order.
      const result = (orders || [])
        .map(o => ({ ...o, sale: salesById[o.sale_id] || null, items: linesBySale[o.sale_id] || [] }))
        .filter(o => o.sale?.status === 'completed');
      return json({ ok:true, orders:result });
    }

    if (url.pathname === '/store/storefront-orders/fulfill' && request.method === 'POST') {
      const parsed = await readJsonWithLimit(request, 8 * 1024);
      if (parsed.error) return parsed.error;
      const body = parsed.data || {};
      const storeId = requestStoreId(request, url, body);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const orderId = String(body.orderId || '');
      if (!orderId) return json({ ok:false, error:'orderId is required' }, 400);
      const { data:orders } = await supabaseAdminFetch(env, `storefront_orders?id=eq.${encodeURIComponent(orderId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,sale_id,fulfillment_status&limit=1`);
      const order = orders?.[0];
      if (!order) return json({ ok:false, error:'Order not found' }, 404);
      if (order.fulfillment_status === 'fulfilled') return json({ ok:true, alreadyFulfilled:true });
      const { data:saleRows } = await supabaseAdminFetch(env, `pos_sales?id=eq.${encodeURIComponent(order.sale_id)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,status&limit=1`);
      if (saleRows?.[0]?.status !== 'completed') return json({ ok:false, error:'This order has not been paid yet' }, 409);
      await supabaseAdminFetch(env, `storefront_orders?id=eq.${encodeURIComponent(orderId)}&store_id=eq.${encodeURIComponent(storeId)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ fulfillment_status:'fulfilled', fulfilled_at:new Date().toISOString(), fulfilled_by:auth.user.id }) });
      const { data:lines } = await supabaseAdminFetch(env, `pos_sale_lines?sale_id=eq.${encodeURIComponent(order.sale_id)}&store_id=eq.${encodeURIComponent(storeId)}&select=item_id`);
      for (const line of lines || []) {
        if (!/^[0-9a-f-]{36}$/i.test(String(line.item_id || ''))) continue;
        const { data:items } = await supabaseAdminFetch(env, `inventory_items?id=eq.${encodeURIComponent(line.item_id)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,data,status&limit=1`);
        const item = items?.[0];
        if (!item || !['sold_pending_pickup', 'sold_pending_shipment'].includes(String(item.status || ''))) continue;
        const data = { ...(item.data || {}), status:'sold', lifecycle:'sold' };
        await supabaseAdminFetch(env, `inventory_items?id=eq.${encodeURIComponent(line.item_id)}&store_id=eq.${encodeURIComponent(storeId)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ data, status:'sold' }) });
      }
      return json({ ok:true });
    }

    if (url.pathname === '/store/invites/send' && request.method === 'POST') {
      const parsed = await readJsonWithLimit(request, 16 * 1024);
      if (parsed.error) return parsed.error;
      const body = parsed.data || {};
      const storeId = requestStoreId(request, url, body);
      const email = String(body.email || '').trim().toLowerCase();
      const role = String(body.role || 'employee').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok:false, error:'Valid email required' }, 400);
      if (!['scanner_only','employee','manager','admin'].includes(role)) return json({ ok:false, error:'Invalid store role' }, 400);
      const auth = await requireStoreUser(request, env, storeId, ['owner','admin']);
      if (auth.error) return auth.error;
      const rateError = await enforceUsageLimit(env, `store-invite:${storeId}`, 20, 3600);
      if (rateError) return rateError;
      const { data:invites } = await supabaseAdminFetch(env, `store_invites?store_id=eq.${encodeURIComponent(storeId)}&email=eq.${encodeURIComponent(email)}&accepted_at=is.null&select=id,email,role&limit=1`);
      const invite = invites?.[0];
      if (!invite || invite.role !== role) return json({ ok:false, error:'Save the matching store invite before sending email' }, 409);
      const { base, key } = supabaseAdminConfig(env);
      const redirectTo = String(env.APP_URL || 'https://squeebmike.github.io/ArSca/dashboard.html');
      let inviteResponse = await fetch(`${base}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method:'POST', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ email, data:{ store_id:storeId, store_role:role, store_invite_id:invite.id } }),
      });
      let raw = await inviteResponse.text();
      let result = null;
      try { result = raw ? JSON.parse(raw) : null; } catch (_) {}
      if (!inviteResponse.ok && inviteResponse.status === 422 && /already|registered|exists/i.test(String(result?.msg || result?.message || result?.error_description || ''))) {
        inviteResponse = await fetch(`${base}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
          method:'POST', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
          body:JSON.stringify({ email, create_user:false, data:{ store_id:storeId, store_role:role, store_invite_id:invite.id } }),
        });
        raw = await inviteResponse.text();
        result = null;
        try { result = raw ? JSON.parse(raw) : null; } catch (_) {}
      }
      const errorText = String(result?.msg || result?.message || result?.error_description || result?.error || `Email service returned ${inviteResponse.status}`).slice(0, 500);
      const statusPatch = inviteResponse.ok ? { email_status:'sent', email_sent_at:new Date().toISOString(), email_error:null } : { email_status:'failed', email_error:errorText };
      await supabaseAdminFetch(env, `store_invites?id=eq.${encodeURIComponent(invite.id)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(statusPatch) }).catch(() => {});
      if (!inviteResponse.ok) return json({ ok:false, inviteSaved:true, emailSent:false, error:errorText }, 502);
      return json({ ok:true, inviteSaved:true, emailSent:true, inviteId:invite.id });
    }

    // Public, read-only storefront. A store must explicitly publish it.
    if (url.pathname === '/public/storefront' && request.method === 'GET') {
      const storeId = String(url.searchParams.get('store_id') || '').trim();
      if (!/^[0-9a-z_-]{2,80}$/i.test(storeId)) return json({ ok:false, error:'Valid store_id required' }, 400);
      if (!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY))) return json({ ok:false, error:'Storefront service unavailable' }, 503);
      const { data:settings } = await supabaseAdminFetch(env, `store_settings?store_id=eq.${encodeURIComponent(storeId)}&select=receipt_settings,theme,modules&limit=1`);
      const cfg = settings?.[0]?.receipt_settings || {};
      if (cfg.storefrontEnabled !== true) return json({ ok:false, error:'Storefront is not published' }, 404);
      const { data:stores } = await supabaseAdminFetch(env, `stores?id=eq.${encodeURIComponent(storeId)}&select=id,name,display_name&limit=1`);
      const { data:rows, response } = await supabaseAdminFetch(env, `inventory_items?store_id=eq.${encodeURIComponent(storeId)}&select=id,data,status,created_at,updated_at&order=updated_at.desc&limit=1000`);
      if (!response?.ok) return json({ ok:false, error:'Inventory unavailable' }, 502);
      const cleanText = (v,n=240) => String(v == null ? '' : v).trim().slice(0,n);
      const cleanUrl = v => { const s=cleanText(v,1000); return /^https?:\/\//i.test(s)||/^data:image\//i.test(s)?s:''; };
      const cleanList = (v,n=12) => (Array.isArray(v) ? v : []).map(x => cleanText(x,80)).filter(Boolean).slice(0,n);
      // Same book-detail fields the dashboard's own item editor already shows
      // (Metron-sourced), trimmed for public payload size -- only attached for
      // comic rows, and only when the item actually has a saved comic record.
      const comicDetailFor = d => {
        const m = d.comicMetadata;
        if (!m || !/comic/i.test(String(d.category || ''))) return null;
        const credits = (Array.isArray(m.credits) ? m.credits : []).slice(0,20).map(c => ({ creator:cleanText(c?.creator,80), roles:cleanList(c?.roles,6) })).filter(c => c.creator);
        return {
          seriesName:cleanText(m.seriesName || m.series || '',160), number:cleanText(m.number || m.issueNumber || '',20),
          selectedCover:cleanText(m.selectedCover?.issueName || m.selectedCover?.name || d.variant || '',120),
          publisher:cleanText(m.publisher,120), seriesYearBegan:cleanText(m.seriesYearBegan,12),
          coverDate:cleanText(m.coverDate,20), storeDate:cleanText(m.storeDate,20),
          coverPrice:Number(m.coverPrice || 0) || 0, coverPriceCurrency:cleanText(m.coverPriceCurrency || 'USD',10),
          rating:cleanText(m.rating,60), upc:cleanText(m.upc,40), sku:cleanText(m.sku,40),
          description:cleanText(m.description,2000),
          writers:cleanList(m.writers), artists:cleanList(m.artists), coverArtists:cleanList(m.coverArtists),
          characters:cleanList(m.characters,30), teams:cleanList(m.teams,20), credits,
        };
      };
      const linkedWfIds = new Set((rows || []).map(row => row.data?.wfId || row.data?.webflowId).filter(Boolean).map(String));
      let items = (rows || []).map(row => { const d=row.data || {}; const rawQty=d.quantity ?? d.qty ?? 1; const quantity=Number.isFinite(Number(rawQty))?Number(rawQty):1; const inventoryStatus=cleanText(d.lifecycle || d.status || row.status || 'in_stock',40).toLowerCase();
        // Price rule: market price, unless there's a floor (minPrice) or a
        // manually-entered override (priceOverride) from the dashboard's edit
        // screen -- whichever of those is higher than market wins.
        const rowMarket = Number(d.market || d.marketPrice || d.rawMarketPrice || 0) || 0;
        const rowBase = Number(d.priceOverride || 0) || roundUpToDollar(rowMarket);
        return {
        id:cleanText(row.id,80), name:cleanText(d.name || d.title || 'Item'), category:cleanText(d.category || d.type || 'Other',80),
        set:cleanText(d.set || d.series || '',120), year:cleanText(d.year || '',12), variant:cleanText(d.variant || d.finish || '',120), condition:cleanText(d.condition || d.grade || '',80),
        // photoDataUrl/thumbnail are where the dashboard's own upload flow
        // (camera/file photo, R2-hosted or legacy base64) actually saves a
        // user-taken photo -- checked first, same precedence the dashboard's
        // own inventoryImageUrl() uses, so a self-taken photo with no
        // catalog-sourced image still shows up on the public storefront.
        price:Math.max(rowBase, Number(d.minPrice || 0) || 0), market:rowMarket, image:cleanUrl(d.photoDataUrl || d.thumbnail || d.image || d.img || d.imageUrl || d.image_url || d.photo),
        isSealed:!!d.is_sealed, gradingCompany:cleanText(d.grading_company || d.grader || '',40),
        comic:comicDetailFor(d),
        quantity, inventoryStatus, soldAt:d.soldAt || d.sold_at || '', archivedAt:d.archivedAt || '', addedAt:row.created_at || '', updatedAt:row.updated_at || ''
      }; }).filter(i => i.name && i.quantity > 0 && !i.soldAt && !i.archivedAt && !['sold','archived','returned','deleted','sold_pending_pickup','sold_pending_shipment','hold','lost_damaged'].includes(i.inventoryStatus));
      const inventorySource = cleanText(settings?.[0]?.modules?.inventorySource || '',40).toLowerCase();
      if ((inventorySource === 'webflow' || inventorySource === 'hybrid') && env.WEBFLOW_TOKEN) {
        const webflowItems=[];
        for(let offset=0;offset<1000;offset+=100){
          const wfRes=await fetch(`${WEBFLOW_BASE}/collections/${WF_PRODUCTS}/items?limit=100&offset=${offset}`,{headers:{Authorization:'Bearer '+env.WEBFLOW_TOKEN,accept:'application/json'}});
          if(!wfRes.ok)break;
          const wfData=await wfRes.json(),batch=Array.isArray(wfData.items)?wfData.items:[];
          webflowItems.push(...batch);
          if(batch.length<100)break;
        }
        const mappedWebflow=webflowItems.filter(row=>!linkedWfIds.has(String(row.id))).map(row=>{const d=row.fieldData||{};const quantity=Number(d['inventory-count']??1);const isSold=d['sold-out']===true||String(d.status||'').toLowerCase().includes('sold');return {
          id:cleanText(row.id,80),name:cleanText(d.name||'Item'),category:cleanText(d['card-category']||d.category||d['custom-category']||d['item-type']||'Other',80),set:cleanText(d['set-name']||'',120),year:cleanText(d.year||'',12),variant:cleanText(d.variant||'',120),condition:cleanText(d.condition||'',80),price:Number(d['list-price']||d['sale-price']||d['retail-price']||d.msrp||0)||0,image:cleanUrl(d['image-url']||d.photoDataUrl||d.thumbnail?.url),quantity,inventoryStatus:isSold?'sold':'in_stock',soldAt:d['date-sold']||'',archivedAt:'',addedAt:d['date-added']||row.createdOn||'',updatedAt:row.lastUpdated||row.updatedOn||''
        };}).filter(i=>i.name&&i.quantity>0&&i.inventoryStatus==='in_stock'&&!i.soldAt);
        items=[...items,...mappedWebflow];
      }
      const store = stores?.[0] || {};
      return json({ ok:true, store:{ id:storeId, name:cleanText(cfg.storeName || cfg.shortName || store.display_name || store.name || 'Store',120), location:cleanText(cfg.location,160), website:cleanUrl(cfg.website), email:cleanText(cfg.email,200), phone:cleanText(cfg.phone,80), logo:cleanUrl(cfg.logo), message:cleanText(cfg.storefrontMessage,500), theme:settings?.[0]?.theme || {} }, items, updatedAt:new Date().toISOString() }, 200, { 'Cache-Control':'public, max-age=60, stale-while-revalidate=300' });
    }

    // POST /public/storefront/checkout — public (unauthenticated) checkout.
    // Creates a pos_sales/pos_sale_lines/pos_payments/storefront_orders record
    // and a Stripe PaymentIntent under the store's own connected account.
    // Prices and shipping fee are always computed server-side from current
    // inventory data — never trusted from the request body.
    if (url.pathname === '/public/storefront/checkout' && request.method === 'POST') {
      if (!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY))) return json({ ok:false, error:'Storefront service unavailable' }, 503);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const limited = await readJsonWithLimit(request, 32 * 1024);
      if (limited.error) return limited.error;
      const body = limited.data || {};
      const storeId = String(body.storeId || '').trim();
      if (!/^[0-9a-z_-]{2,80}$/i.test(storeId)) return json({ ok:false, error:'Valid storeId required' }, 400);
      const rateError = await enforceUsageLimit(env, `storefront-checkout:${storeId}:${ip}`, 8, 60);
      if (rateError) return rateError;

      const { data:settings } = await supabaseAdminFetch(env, `store_settings?store_id=eq.${encodeURIComponent(storeId)}&select=receipt_settings&limit=1`);
      if (settings?.[0]?.receipt_settings?.storefrontEnabled !== true) return json({ ok:false, error:'Storefront is not published' }, 404);

      const fulfillment = body.fulfillment || {};
      const method = String(fulfillment.method || '');
      if (!['pickup_fedway', 'pickup_kitsap', 'shipping'].includes(method)) return json({ ok:false, error:'A valid fulfillment method is required' }, 400);
      const customerName = String(fulfillment.name || '').trim().slice(0, 160);
      const customerPhone = String(fulfillment.phone || '').trim().slice(0, 40);
      if (!customerName || !customerPhone) return json({ ok:false, error:'Name and phone number are required' }, 400);
      const customerEmail = String(fulfillment.email || '').trim().slice(0, 200);
      let shippingAddress = null;
      if (method === 'shipping') {
        const addr = fulfillment.shippingAddress || {};
        shippingAddress = {
          line1: String(addr.line1 || '').trim().slice(0, 200),
          line2: String(addr.line2 || '').trim().slice(0, 200),
          city: String(addr.city || '').trim().slice(0, 120),
          state: String(addr.state || '').trim().slice(0, 40),
          zip: String(addr.zip || '').trim().slice(0, 20),
        };
        if (!shippingAddress.line1 || !shippingAddress.city || !shippingAddress.state || !shippingAddress.zip) return json({ ok:false, error:'A complete shipping address is required' }, 400);
      }

      const requestedItems = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
      if (!requestedItems.length) return json({ ok:false, error:'Your cart is empty' }, 400);
      const cleanUrlLoose = v => { const s = String(v == null ? '' : v).trim().slice(0, 1000); return /^https?:\/\//i.test(s) || /^data:image\//i.test(s) ? s : ''; };

      const lineItems = [];
      let subtotalCents = 0;
      let totalQuantity = 0;
      let allRawSingles = true;
      for (const req of requestedItems) {
        const itemId = String(req.itemId || '').trim();
        const qty = Math.max(1, Math.min(10, Number(req.quantity || 1)));
        if (!/^[0-9a-f-]{36}$/i.test(itemId)) return json({ ok:false, error:'Invalid item in cart' }, 400);
        const { data:rows } = await supabaseAdminFetch(env, `inventory_items?id=eq.${encodeURIComponent(itemId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,data,status&limit=1`);
        const row = rows?.[0];
        if (!row) return json({ ok:false, error:'An item in your cart is no longer available' }, 404);
        const d = row.data || {};
        const availableQty = Number(d.quantity ?? d.qty ?? 1) || 0;
        const invStatus = String(d.lifecycle || d.status || row.status || 'in_stock').toLowerCase();
        if (invStatus !== 'in_stock' || availableQty < qty || d.soldAt || d.archivedAt) return json({ ok:false, error:`"${d.name || 'An item'}" in your cart just sold out` }, 409);
        const checkoutBase = Number(d.priceOverride || 0) || roundUpToDollar(Number(d.market || d.marketPrice || d.rawMarketPrice || d.price || 0) || 0);
        const unitPrice = Math.max(checkoutBase, Number(d.minPrice || 0) || 0);
        if (unitPrice <= 0) return json({ ok:false, error:`"${d.name || 'An item'}" doesn't have a price set yet` }, 409);
        const category = String(d.category || d.type || '').toLowerCase();
        const isSealed = !!d.is_sealed || category.includes('sealed') || category === 'comic';
        const isGraded = !!(d.grading_company || d.grader);
        if (isSealed || isGraded) allRawSingles = false;
        totalQuantity += qty;
        subtotalCents += Math.round(unitPrice * 100) * qty;
        lineItems.push({ itemId, quantity: qty, unitPrice, title: d.name || d.title || 'Item', category: d.category || d.type || 'Other', condition: d.condition || d.grade || '', imageUrl: cleanUrlLoose(d.image || d.img || d.imageUrl || d.image_url || d.photo) });
      }
      if (subtotalCents < 50) return json({ ok:false, error:'Order subtotal is too small to check out' }, 400);

      const shippingFeeCents = method !== 'shipping' ? 0 : (totalQuantity <= 3 && allRawSingles ? 300 : 700);
      const totalCents = subtotalCents + shippingFeeCents;

      // No Stripe Connect yet -- this charges directly to the platform's own
      // Stripe account (env.STRIPE_SECRET_KEY_LIVE/TEST), same as any other
      // direct integration. Revisit once storefronts move to Connect.
      const mode = stripeMode(env);
      const cfg = stripeConfig(env, mode);
      if (!cfg.secretKey) return json({ ok:false, error:'Online payments are not configured yet' }, 503);

      const confirmationNumber = 'ORD-' + crypto.randomUUID().split('-')[0].toUpperCase();
      const saleId = crypto.randomUUID();
      await supabaseAdminFetch(env, 'pos_sales', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ id:saleId, store_id:storeId, subtotal:subtotalCents/100, discount_total:0, tax_total:0, total:totalCents/100, status:'pending' }) });

      const saleLines = lineItems.map(li => ({ id:crypto.randomUUID(), sale_id:saleId, store_id:storeId, item_id:li.itemId, title:li.title, category:li.category, quantity:li.quantity, unit_price:li.unitPrice, original_price:li.unitPrice, adjusted_price:li.unitPrice, discount_amount:0, cost_basis:0, profit:0, condition:li.condition, image_url:li.imageUrl }));
      if (shippingFeeCents > 0) saleLines.push({ id:crypto.randomUUID(), sale_id:saleId, store_id:storeId, item_id:null, title:'Shipping', category:'Shipping', quantity:1, unit_price:shippingFeeCents/100, original_price:shippingFeeCents/100, adjusted_price:shippingFeeCents/100, discount_amount:0, cost_basis:0, profit:0 });
      await supabaseAdminFetch(env, 'pos_sale_lines', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(saleLines) });

      let pi;
      try {
        const params = new URLSearchParams({ amount:String(totalCents), currency:'usd', 'automatic_payment_methods[enabled]':'true', 'metadata[arsca_sale_id]':saleId, 'metadata[arsca_store_id]':storeId, 'metadata[source]':'storefront_order', 'metadata[confirmation_number]':confirmationNumber });
        pi = await stripeApi(env, mode, 'payment_intents', { method:'POST', params, idempotencyKey:`arsca-storefront-${mode}-${saleId}` });
        await supabaseAdminFetch(env, 'pos_payments', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ id:crypto.randomUUID(), sale_id:saleId, store_id:storeId, method:'Stripe Card', amount:totalCents/100, status:pi.status, provider:'stripe', stripe_mode:mode, stripe_payment_intent_id:pi.id, currency:pi.currency, amount_cents:totalCents, processing_fee_paid_by:'platform_account' }) });
      } catch (e) {
        return json({ ok:false, error:'Payment setup failed: ' + e.message }, 502);
      }

      await supabaseAdminFetch(env, 'storefront_orders', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ id:crypto.randomUUID(), store_id:storeId, sale_id:saleId, confirmation_number:confirmationNumber, customer_name:customerName, customer_phone:customerPhone, customer_email:customerEmail || null, fulfillment_method:method, shipping_address:shippingAddress, shipping_fee_cents:shippingFeeCents, fulfillment_status:'pending' }) });

      return json({ ok:true, clientSecret:pi.client_secret, publishableKey:stripeConfig(env, mode).publishableKey, confirmationNumber, amountCents:totalCents, shippingFeeCents, mode });
    }

    if (url.pathname === '/catalog/mtg/manifest') {
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'MTG_CATALOG_R2 binding is not configured' }, 503);
      const object = await env.MTG_CATALOG_R2.get('mtg/manifest.json', { onlyIf:request.headers });
      return r2ObjectResponse(object, request, 'public, max-age=300, stale-if-error=86400');
    }

    if (url.pathname === '/catalog/mtg/download') {
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'MTG_CATALOG_R2 binding is not configured' }, 503);
      const type = String(url.searchParams.get('file') || '').toLowerCase();
      if (!MTG_CATALOG_FILE_TYPES.has(type)) return json({ ok: false, error: 'file must be cards, marketPrices, prices, links, or sets' }, 400);
      const manifestObject = await env.MTG_CATALOG_R2.get('mtg/manifest.json');
      if (!manifestObject) return json({ ok: false, error: 'MTG manifest not found' }, 404);
      const manifest = await manifestObject.json().catch(() => null);
      const descriptorKey = type === 'marketprices' ? 'marketPrices' : type;
      const descriptor = manifest?.status === 'ready' ? manifest.files?.[descriptorKey] : null;
      const key = String(descriptor?.path || '');
      if (!key.startsWith('mtg/') || !key.endsWith('.jsonl.gz')) return json({ ok: false, error: `MTG ${type} file is not ready` }, 503);
      const object = await env.MTG_CATALOG_R2.get(key, { onlyIf:request.headers });
      if (!object) return json({ ok: false, error: `MTG ${type} catalog object not found` }, 404);
      const response = r2ObjectResponse(object, request, 'public, max-age=31536000, immutable');
      response.headers.set('Content-Type', 'application/gzip');
      response.headers.set('X-MTG-Catalog-Version', String(manifest.version || ''));
      response.headers.set('X-Content-SHA256', String(descriptor.sha256 || ''));
      return response;
    }

    if (url.pathname === '/catalog/topps/manifest') {
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Offline catalog R2 binding is not configured' }, 503);
      const object = await env.MTG_CATALOG_R2.get('topps/manifest.json', { onlyIf: request.headers });
      return r2ObjectResponse(object, request, 'public, max-age=300, stale-if-error=86400');
    }

    if (url.pathname === '/catalog/topps/download') {
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Offline catalog R2 binding is not configured' }, 503);
      const type = String(url.searchParams.get('file') || '').toLowerCase();
      if (!new Set(['sets', 'cards']).has(type)) return json({ ok: false, error: 'file must be sets or cards' }, 400);
      const manifestObject = await env.MTG_CATALOG_R2.get('topps/manifest.json');
      if (!manifestObject) return json({ ok: false, error: 'Topps manifest not found' }, 404);
      const manifest = await manifestObject.json().catch(() => null);
      const descriptor = manifest?.status === 'ready' ? manifest.files?.[type] : null;
      const key = String(descriptor?.path || '');
      if (!key.startsWith('topps/') || !key.endsWith('.jsonl.gz')) return json({ ok: false, error: `Topps ${type} file is not ready` }, 503);
      const object = await env.MTG_CATALOG_R2.get(key, { onlyIf: request.headers });
      if (!object) return json({ ok: false, error: `Topps ${type} object not found` }, 404);
      const response = r2ObjectResponse(object, request, 'public, max-age=31536000, immutable');
      response.headers.set('Content-Type', 'application/gzip');
      response.headers.set('X-Topps-Catalog-Version', String(manifest.version || ''));
      response.headers.set('X-Content-SHA256', String(descriptor.sha256 || ''));
      return response;
    }

    // Shared by both /scan (server-scraped list) and /filter-candidates
    // (client-supplied list) -- diffs a list of {name,url,sport,year,brand}
    // entries against what's already live in R2 using a best-effort candidate
    // id. The real id is only known once a PDF is actually parsed (the
    // product name comes from the PDF text), so this is a heuristic filter
    // only -- a false "new" just means a harmless re-merge no-op later.
    async function diffToppsCandidates(env, entries) {
      let existingSets = [];
      const manifestObject = await env.MTG_CATALOG_R2.get('topps/manifest.json');
      const manifest = manifestObject ? await manifestObject.json().catch(() => null) : null;
      if (manifest?.status === 'ready' && manifest.files?.sets?.path) {
        const setsObject = await env.MTG_CATALOG_R2.get(manifest.files.sets.path);
        existingSets = await gunzipJsonlFromR2(setsObject);
      }
      const knownSetIds = new Set(existingSets.filter(s => Number(s.cardCount || 0) > 0).map(s => s.id));
      return entries
        .map(entry => ({
          name: entry.name,
          url: entry.url,
          sport: entry.sport || '',
          year: entry.year || '',
          brand: entry.brand || '',
          candidateSetId: slugify([entry.year, String(entry.name || '').replace(/checklist/ig, ''), entry.sport].filter(Boolean).join(' ')),
        }))
        .filter(c => !knownSetIds.has(c.candidateSetId));
    }

    // GET /catalog/topps/update/scan -- owner/admin only. Scrapes topps.com's
    // own checklist page and diffs against what's already live in R2, so the
    // dashboard can show "12 new sets found" before doing any PDF work.
    // NOTE: topps.com's storefront has bot protection that 403s Worker-origin
    // requests to the *page itself* (confirmed in production) -- if this
    // keeps failing, use /catalog/topps/update/filter-candidates instead with
    // a link list pulled from a real browser session (see that route).
    if (url.pathname === '/catalog/topps/update/scan') {
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Offline catalog R2 binding is not configured' }, 503);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId, ['owner', 'admin']);
      if (auth.error) return auth.error;

      const scrapeResult = await fetchToppsChecklistCatalogDetailed();
      if (!scrapeResult.ok) return json({ ok: false, error: scrapeResult.error, status: scrapeResult.status }, 502);
      const candidates = await diffToppsCandidates(env, scrapeResult.sets);
      return json({ ok: true, totalOnSite: scrapeResult.sets.length, alreadyImported: scrapeResult.sets.length - candidates.length, candidates });
    }

    // POST /catalog/topps/update/filter-candidates -- owner/admin only.
    // topps.com's storefront blocks the Worker's own fetch to the checklist
    // page (bot protection, confirmed via /scan), but the actual PDF files
    // live on Shopify's asset CDN, which process-one fetches directly and
    // has no such block. So instead of the Worker scraping the page itself,
    // this takes a {name,url} link list extracted from a real browser
    // session (topps.com never blocks the browser you're actually reading it
    // in) and runs the same known-set diff /scan does.
    if (url.pathname === '/catalog/topps/update/filter-candidates') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Offline catalog R2 binding is not configured' }, 503);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId, ['owner', 'admin']);
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => ({}));
      const entries = (Array.isArray(body.entries) ? body.entries : [])
        .map(e => ({ name: String(e?.name || '').trim(), url: String(e?.url || '').trim() }))
        .filter(e => e.name && /\.pdf(\?|$)/i.test(e.url));
      if (!entries.length) return json({ ok: false, error: 'entries (array of {name,url} pointing at .pdf files) is required' }, 400);

      const candidates = await diffToppsCandidates(env, entries);
      return json({ ok: true, totalSubmitted: entries.length, alreadyImported: entries.length - candidates.length, candidates });
    }

    // POST /catalog/topps/update/process-one -- owner/admin only. Fetches one
    // checklist PDF, extracts its text (extractPdfText, already proven via
    // /topps/import-pdf), and parses it with the SAME parser that built the
    // live catalog (scripts/topps-checklist-parser.js, imported above) instead
    // of the older/unproven parseToppsChecklistText. Returns the parsed
    // set/cards -- does not write anything yet.
    if (url.pathname === '/catalog/topps/update/process-one') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId, ['owner', 'admin']);
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => ({}));
      const pdfUrl = String(body.url || '');
      const name = String(body.name || '');
      if (!pdfUrl || !name) return json({ ok: false, error: 'url and name required' }, 400);

      const pdfRes = await fetch(pdfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.topps.com/',
          'Accept': 'application/pdf,*/*',
        },
      }).catch(() => null);
      if (!pdfRes || !pdfRes.ok) return json({ ok: false, error: `PDF fetch failed: ${pdfRes?.status || 'network error'}` }, 502);

      const ct = pdfRes.headers.get('content-type') || '';
      if (!ct.includes('pdf') && !pdfUrl.toLowerCase().includes('.pdf')) {
        const html = await pdfRes.text();
        const pdfLinkM = html.match(/href="([^"]*\.pdf[^"]*)"/i);
        if (pdfLinkM) return json({ ok: false, redirect: pdfLinkM[1].startsWith('http') ? pdfLinkM[1] : 'https://www.topps.com' + pdfLinkM[1], error: 'Redirected to PDF URL, retry with redirect URL' }, 200);
        return json({ ok: false, error: 'URL did not return a PDF' }, 422);
      }

      const arrayBuffer = await pdfRes.arrayBuffer();
      let text = '';
      try { text = await extractPdfText(arrayBuffer); }
      catch (e) { return json({ ok: false, error: 'PDF text extraction failed: ' + e.message }, 422); }
      if (!text || text.trim().length < 50) return json({ ok: false, error: 'Could not extract readable text from PDF', textLength: text.length }, 422);

      const sourceId = 'topps_pdf_' + sha1Hex(pdfUrl).slice(0, 16);
      const parsed = parseChecklistText({ text, fileName: name, sourceId });
      if (!parsed.cards.length) return json({ ok: false, error: 'Parser found 0 cards for this PDF', textSample: text.slice(0, 1000) }, 422);

      return json({
        ok: true,
        set: parsed.set,
        cards: parsed.cards,
        source: { sourceId, fileName: name, originalPath: pdfUrl, pdfUrl, pageCount: 0, importedAt: new Date().toISOString() },
      });
    }

    // POST /catalog/topps/update/publish -- owner/admin only. Merges the
    // accumulated sets/cards from one or more process-one calls into the live
    // R2 catalog and publishes a new version, mirroring
    // scripts/topps/merge-and-publish.mjs + build-offline-bundle.mjs exactly
    // (same R2 key layout, same manifest shape) so the existing
    // /catalog/topps/manifest + /catalog/topps/download routes need no changes.
    if (url.pathname === '/catalog/topps/update/publish') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Offline catalog R2 binding is not configured' }, 503);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId, ['owner', 'admin']);
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => ({}));
      const newSets = Array.isArray(body.sets) ? body.sets : [];
      const newCards = Array.isArray(body.cards) ? body.cards : [];
      if (!newSets.length && !newCards.length) return json({ ok: false, error: 'sets and cards are required' }, 400);

      const manifestObject = await env.MTG_CATALOG_R2.get('topps/manifest.json');
      const manifest = manifestObject ? await manifestObject.json().catch(() => null) : null;
      let existingSets = [];
      let cardsObject = null;
      if (manifest?.status === 'ready') {
        const setsObject = await env.MTG_CATALOG_R2.get(manifest.files?.sets?.path || 'topps/__missing__');
        existingSets = await gunzipJsonlFromR2(setsObject);
        cardsObject = await env.MTG_CATALOG_R2.get(manifest.files?.cards?.path || 'topps/__missing__');
      }

      // Dedupe the incoming batch against itself first (small -- tens to a
      // few thousand rows), same rule as before: last write wins per dedupe
      // key, and a dedupe-key collision with a different id drops the older id.
      const newCardDedupeMap = new Map();
      const newCardIdMap = new Map();
      for (const card of newCards) {
        const key = toppsCardDedupeKey(card);
        const priorByKey = newCardDedupeMap.get(key);
        if (priorByKey && priorByKey.id !== card.id) newCardIdMap.delete(priorByKey.id);
        newCardDedupeMap.set(key, card);
        newCardIdMap.set(card.id, card);
      }
      const finalNewCards = [...new Map([...newCardDedupeMap.values()].map(c => [c.id, c])).values()];

      const generatedAt = new Date().toISOString();
      const version = String(body.version || generatedAt.slice(0, 19).replace(/[:T]/g, '-'));

      // Stream the existing cards file through instead of loading it fully --
      // it has 400,000+ records and materializing it as one array blew the
      // Worker's memory limit in production ("Memory limit exceeded before
      // EOF"). Cards superseded by the incoming batch are dropped as they
      // stream past; everything else is written straight through.
      const cardWriter = createGzipJsonlWriter();
      const cardCountBySet = new Map();
      let existingCardCount = 0;
      let keptOldCount = 0;
      for await (const oldCard of streamJsonlFromR2(cardsObject)) {
        existingCardCount++;
        const key = toppsCardDedupeKey(oldCard);
        if (newCardDedupeMap.has(key) || newCardIdMap.has(oldCard.id)) continue;
        await cardWriter.write(compactToppsCard(oldCard, oldCard.updatedAt || generatedAt));
        cardCountBySet.set(oldCard.setId, (cardCountBySet.get(oldCard.setId) || 0) + 1);
        keptOldCount++;
      }
      for (const card of finalNewCards) {
        await cardWriter.write(compactToppsCard(card, generatedAt));
        cardCountBySet.set(card.setId, (cardCountBySet.get(card.setId) || 0) + 1);
      }
      const finalCardCount = keptOldCount + finalNewCards.length;

      const mergedSets = mergeToppsSetsWithCounts(existingSets, newSets, cardCountBySet);
      if (mergedSets.length === existingSets.length && finalNewCards.length === 0 && keptOldCount === existingCardCount) {
        return json({ ok: true, published: false, message: 'No new sets/cards -- nothing to publish.', setCount: mergedSets.length, cardCount: finalCardCount });
      }

      const cardsGz = await cardWriter.finish();
      const setsGz = await gzipJsonl(mergedSets.map(s => compactToppsSet(s, generatedAt)));
      const [cardsSha256, setsSha256] = await Promise.all([sha256Hex(cardsGz), sha256Hex(setsGz)]);

      const cardsKey = `topps/${version}/cards.jsonl.gz`;
      const setsKey = `topps/${version}/sets.jsonl.gz`;
      await env.MTG_CATALOG_R2.put(cardsKey, cardsGz, { httpMetadata: { contentType: 'application/gzip' } });
      await env.MTG_CATALOG_R2.put(setsKey, setsGz, { httpMetadata: { contentType: 'application/gzip' } });
      const newManifest = {
        category: 'topps',
        label: 'Topps Sports Checklists',
        version,
        generatedAt,
        schemaVersion: 1,
        sourceVersions: { topps: { importedAt: generatedAt } },
        files: {
          cards: { path: cardsKey, format: 'jsonl.gz', sha256: cardsSha256, recordCount: finalCardCount, bytes: cardsGz.length },
          sets: { path: setsKey, format: 'jsonl.gz', sha256: setsSha256, recordCount: mergedSets.length, bytes: setsGz.length },
        },
        status: 'ready',
      };
      await env.MTG_CATALOG_R2.put('topps/manifest.json', JSON.stringify(newManifest), { httpMetadata: { contentType: 'application/json' } });

      return json({
        ok: true,
        published: true,
        version,
        setCount: mergedSets.length,
        cardCount: finalCardCount,
        newSetCount: mergedSets.length - existingSets.length,
        newCardCount: finalCardCount - existingCardCount,
      });
    }

    const pricechartingCatalogMatch = url.pathname.match(/^\/catalog\/pricecharting\/([a-z0-9_]+)\/(manifest|download)$/);
    if (pricechartingCatalogMatch) {
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'MTG_CATALOG_R2 binding is not configured' }, 503);
      const category = pricechartingCatalogMatch[1];
      const action = pricechartingCatalogMatch[2];
      if (!PRICECHARTING_OFFLINE_CATEGORIES.has(category)) return json({ ok: false, error: 'Unsupported catalog category' }, 404);
      if (action === 'manifest') {
        const object = await env.MTG_CATALOG_R2.get(`${category}/manifest.json`, { onlyIf:request.headers });
        return r2ObjectResponse(object, request, 'public, max-age=300, stale-if-error=86400');
      }
      const manifestObject = await env.MTG_CATALOG_R2.get(`${category}/manifest.json`);
      if (!manifestObject) return json({ ok: false, error: `${category} manifest not found` }, 404);
      const manifest = await manifestObject.json().catch(() => null);
      const descriptor = manifest?.status === 'ready' ? manifest.files?.products : null;
      const key = String(descriptor?.path || '');
      if (!key.startsWith(`${category}/`) || !key.endsWith('.jsonl.gz')) return json({ ok: false, error: `${category} catalog is not ready` }, 503);
      const object = await env.MTG_CATALOG_R2.get(key, { onlyIf:request.headers });
      if (!object) return json({ ok: false, error: `${category} catalog object not found` }, 404);
      const response = r2ObjectResponse(object, request, 'public, max-age=31536000, immutable');
      response.headers.set('Content-Type', 'application/gzip');
      response.headers.set('X-PriceCharting-Catalog-Version', String(manifest.version || ''));
      response.headers.set('X-Content-SHA256', String(descriptor.sha256 || ''));
      return response;
    }

    if (url.pathname === '/cart') {
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const registerId = safeStoreKey(url.searchParams.get('register') || 'front');
      const key = `pos_cart:${safeStoreKey(storeId)}:${registerId}`;

      if (request.method === 'GET') {
        const cartData = env.LBA_KV
          ? await env.LBA_KV.get(key)
          : (globalThis[`_lbaCart_${key}`] || globalThis._lbaCart || null);

        return new Response(cartData || '{"items":[],"discount":0}', {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        const body = await request.text();
        JSON.parse(body || '{}');
        if (env.LBA_KV) {
          await env.LBA_KV.put(key, body, { expirationTtl: 86400 });
        } else {
          globalThis[`_lbaCart_${key}`] = body;
          if (key === 'pos_cart') globalThis._lbaCart = body;
        }
        return json({ ok: true, key });
      }

      return json({ error: 'GET or POST only' }, 405);
    }

    if (url.pathname.startsWith('/kv/')) {
      const key = url.pathname.slice(4).replace(/[^a-zA-Z0-9:_-]/g, '-');
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      if (!key) return json({ ok:false, error:'KV key is required' }, 400);
      const scopedKey = `lba:${safeStoreKey(storeId)}:${key}`;

      if (request.method === 'GET') {
        const val = env.LBA_KV
          ? await env.LBA_KV.get(scopedKey)
          : (globalThis['_' + scopedKey] || null);
        return json({ value: val });
      }

      if (request.method === 'POST') {
        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > 1024 * 1024) return json({ ok:false, error:'KV payload is too large' }, 413);
        if (env.LBA_KV) {
          const expirationTtl = key.startsWith('show_session') ? 60 * 60 * 24 * 180 : key.startsWith('comic_') ? 60 * 60 * 24 * 365 : 604800;
          await env.LBA_KV.put(scopedKey, body, { expirationTtl });
        } else {
          globalThis['_' + scopedKey] = body;
        }
        return json({ ok: true });
      }

      return json({ error: 'GET or POST only' }, 405);
    }

    if (url.pathname === '/offline/cache/manifest') {
      // PC CSV KV cache removed — Pokemon/MTG data is downloaded to device directly.
      return json({
        ok: true,
        source: 'walkoff-worker',
        generatedAt: new Date().toISOString(),
        priceCharting: {},
        note: 'PC CSV KV cache removed. Card data is stored on-device via IndexedDB.',
      });
    }

    if (url.pathname === '/anthropic/messages') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const limited = await readJsonWithLimit(request, 6 * 1024 * 1024);
      if (limited.error) return limited.error;
      const body = limited.data;
      const allowedModels = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6']);
      if (!allowedModels.has(String(body.model || ''))) return json({ ok:false, error:'Unsupported model' }, 400);
      body.max_tokens = Math.min(2000, Math.max(1, Number(body.max_tokens || 1000)));
      if (!Array.isArray(body.messages) || !body.messages.length) return json({ ok:false, error:'messages are required' }, 400);
      const rateError = await enforceUsageLimit(env, `anthropic:${storeId}:${auth.user.id}`, 60, 60);
      if (rateError) return rateError;
      const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/cardsight/identify') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.CARDSIGHTAI_API_KEY) return json({ error: 'CARDSIGHTAI_API_KEY not set' }, 500);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const limited = await readJsonWithLimit(request, 6 * 1024 * 1024);
      if (limited.error) return limited.error;
      const body = limited.data;
      const rawBase64 = String(body.image || '').includes(',') ? String(body.image).split(',').pop() : String(body.image || '');
      if (!rawBase64) return json({ ok:false, error:'image is required' }, 400);
      if (rawBase64.length > 8 * 1024 * 1024) return json({ ok:false, error:'Image is too large' }, 413);
      const segment = /^[a-z-]{1,40}$/.test(String(body.segment || '')) ? String(body.segment) : '';
      const rateError = await enforceUsageLimit(env, `cardsight:${storeId}:${auth.user.id}`, 60, 60);
      if (rateError) return rateError;

      let bytes;
      try {
        const binaryStr = atob(rawBase64);
        bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      } catch (_) {
        return json({ ok:false, error:'Invalid base64 image' }, 400);
      }

      const form = new FormData();
      form.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'scan.jpg');
      const path = segment ? `/v1/identify/card/${segment}` : '/v1/identify/card';
      const res = await fetch(`${CARDSIGHTAI_BASE}${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': env.CARDSIGHTAI_API_KEY },
        body: form,
      });

      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Pricing/images for a card CardSight already identified -- keyed by the
    // catalog card.id from /cardsight/identify, so this is an exact-match
    // lookup against the same catalog, not a fresh fuzzy text search.
    const cardsightPricingMatch = url.pathname.match(/^\/cardsight\/pricing\/([a-zA-Z0-9_-]{1,80})$/);
    if (cardsightPricingMatch) {
      if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
      if (!env.CARDSIGHTAI_API_KEY) return json({ error: 'CARDSIGHTAI_API_KEY not set' }, 500);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const rateError = await enforceUsageLimit(env, `cardsight-pricing:${storeId}:${auth.user.id}`, 60, 60);
      if (rateError) return rateError;

      const cardId = cardsightPricingMatch[1];
      const params = new URLSearchParams();
      for (const key of ['parallel_id', 'grade_id', 'period', 'listing_type', 'limit', 'as_of_date']) {
        const v = url.searchParams.get(key);
        if (v) params.set(key, v);
      }
      const qs = params.toString();
      const res = await fetch(`${CARDSIGHTAI_BASE}/v1/pricing/${encodeURIComponent(cardId)}${qs ? '?' + qs : ''}`, {
        method: 'POST',
        headers: { 'X-API-Key': env.CARDSIGHTAI_API_KEY },
      });

      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const cardsightImageMatch = url.pathname.match(/^\/cardsight\/images\/([a-zA-Z0-9_-]{1,80})$/);
    if (cardsightImageMatch) {
      if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
      if (!env.CARDSIGHTAI_API_KEY) return json({ error: 'CARDSIGHTAI_API_KEY not set' }, 500);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const rateError = await enforceUsageLimit(env, `cardsight-images:${storeId}:${auth.user.id}`, 60, 60);
      if (rateError) return rateError;

      const cardId = cardsightImageMatch[1];
      const params = new URLSearchParams({ default: 'true' });
      const res = await fetch(`${CARDSIGHTAI_BASE}/v1/images/card/${encodeURIComponent(cardId)}?${params.toString()}`, {
        method: 'GET',
        headers: { 'X-API-Key': env.CARDSIGHTAI_API_KEY },
      });
      if (!res.ok) {
        const errText = await res.text();
        return json({ ok: false, error: 'CardSight image ' + res.status + ': ' + errText.slice(0, 200) }, res.status);
      }
      const contentType = res.headers.get('Content-Type') || '';
      // CardSight's docs describe this endpoint as returning "binary or base64
      // JSON" -- handle whichever it actually sends rather than assuming one,
      // and build a real data: URI ourselves so the dashboard can drop the
      // result straight into an <img src> with no further parsing/guessing.
      if (contentType.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        const already = String(data.imageUrl || data.url || '');
        if (/^https?:\/\//i.test(already) || already.startsWith('data:')) {
          return json({ ok: true, imageUrl: already });
        }
        const rawBase64 = String(data.image || data.data || data.base64 || data.imageBase64 || '');
        const imgType = data.contentType || data.mimeType || 'image/jpeg';
        return json({ ok: true, imageUrl: rawBase64 ? `data:${imgType};base64,${rawBase64}` : '' });
      }
      const buf = await res.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      return json({ ok: true, imageUrl: `data:${contentType || 'image/jpeg'};base64,${base64}` });
    }

    if (url.pathname === '/upload-image') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);

      try {
        const storeId = requestStoreId(request, url);
        const auth = await requireStoreUser(request, env, storeId);
        if (auth.error) return auth.error;
        const limited = await readJsonWithLimit(request, 9 * 1024 * 1024);
        if (limited.error) return limited.error;
        const { base64, fileName, mimeType } = limited.data;
        if (!base64 || !fileName) return json({ error: 'base64 and fileName required' }, 400);

        const mime = mimeType || 'image/jpeg';
        if (!['image/jpeg','image/png','image/webp','image/gif'].includes(mime)) return json({ ok:false, error:'Unsupported image type' }, 415);
        const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').substring(0, 100);
        const rawBase64 = String(base64).includes(',') ? String(base64).split(',').pop() : String(base64);
        if (rawBase64.length > 8 * 1024 * 1024) return json({ ok:false, error:'Image is too large' }, 413);
        const rateError = await enforceUsageLimit(env, `upload:${storeId}:${auth.user.id}`, 30, 60);
        if (rateError) return rateError;

        const binaryStr = atob(rawBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const fileHash = md5Hex(bytes);

        const metaRes = await fetch(`${WEBFLOW_BASE}/sites/${SITE_ID}/assets`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
            'Content-Type': 'application/json',
            'accept': 'application/json',
          },
          body: JSON.stringify({ fileName: cleanName, fileHash }),
        });

        const { text: metaText, data: meta } = await readApiJson(metaRes);
        if (!metaRes.ok) {
          console.error('Webflow asset pre-sign failed:', metaRes.status, metaText.substring(0, 300));
          return json({
            error: 'Asset pre-sign failed: ' + metaRes.status,
            detail: errorMessageFromApi(meta, metaText.substring(0, 300)),
          }, metaRes.status);
        }

        const uploadDetails = meta.uploadDetails || {};
        const uploadUrl = uploadDetails.uploadUrl || meta.uploadUrl || meta.upload_url;
        const assetId = meta.id || meta.asset?.id;
        let finalUrl = meta.hostedUrl || meta.hosted_url || meta.asset?.hostedUrl || meta.asset?.hosted_url || null;

        if (!uploadUrl) {
          console.error('No uploadUrl. Meta:', JSON.stringify(meta).substring(0, 500));
          return json({ error: 'No uploadUrl in Webflow response', detail: meta }, 500);
        }

        const form = new FormData();
        for (const [k, v] of Object.entries(uploadDetails)) {
          if (k === 'uploadUrl' || v == null) continue;
          form.append(k, String(v));
        }
        form.append('Content-Type', mime);
        form.append('file', new Blob([bytes], { type: mime }), cleanName);

        const s3Res = await fetch(uploadUrl, { method: 'POST', body: form });
        if (!s3Res.ok) {
          const s3Err = await s3Res.text();
          console.error('S3 upload error:', s3Res.status, s3Err.substring(0, 300));
          return json({
            error: 'Upload failed: S3 POST ' + s3Res.status,
            detail: s3Err.substring(0, 300),
          }, 500);
        }

        if (!finalUrl && assetId) {
          try {
            const assetRes = await fetch(`${WEBFLOW_BASE}/assets/${assetId}`, {
              headers: {
                'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
                'accept': 'application/json',
              },
            });
            if (assetRes.ok) {
              const ad = await assetRes.json();
              finalUrl = ad.hostedUrl || ad.hosted_url || ad.asset?.hostedUrl || null;
            }
          } catch (ae) {
            console.warn('Asset refetch failed:', ae.message);
          }
        }

        return json({ ok: true, url: finalUrl, assetId, fileName: cleanName, fileHash });
      } catch (e) {
        console.error('Image upload error:', e);
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === '/pos/checkout') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);

      try {
        const limited = await readJsonWithLimit(request, 2 * 1024 * 1024);
        if (limited.error) return limited.error;
        const body = limited.data;
        const storeId = requestStoreId(request, url, body);
        const auth = await requireStoreUser(request, env, storeId);
        if (auth.error) return auth.error;
        const items = Array.isArray(body.items) ? body.items : [];
        const method = body.method || body.paymentMethod || 'Unknown';
        const soldAt = body.soldAt || new Date().toISOString();
        const requestedTxId = String(body.txId || body.transaction?.id || '').trim();
        const txId = /^[0-9a-z:_-]{6,120}$/i.test(requestedTxId) ? requestedTxId : crypto.randomUUID();
        const idempotencyKey = `pos_tx:${safeStoreKey(storeId)}:${txId}`;

        if (!items.length) return json({ error: 'No checkout items supplied' }, 400);
        if (items.length > 250) return json({ error:'Checkout item limit exceeded' }, 400);
        if (env.LBA_KV) {
          const existing = await env.LBA_KV.get(idempotencyKey);
          if (existing) {
            const previous = JSON.parse(existing);
            return json({ ...previous, idempotent:true });
          }
        }

        const results = [];

        for (const item of items) {
          const itemId = normalizeWebflowItemId(item);
          if (!itemId) {
            results.push({ ok: false, name: item.name || 'Unknown item', error: 'Missing Webflow item id' });
            continue;
          }

          const itemCost = Number(item.cost || 0);
          const salePrice = Number(item.price || 0);
          const collectionId = WF_PRODUCTS;

          const wfRes = await fetch(`${WEBFLOW_BASE}/collections/${collectionId}/items/${itemId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
              'Content-Type': 'application/json',
              'accept': 'application/json',
            },
            body: JSON.stringify({
              fieldData: {
                'sold-out': true,
                'inventory-count': 0,
                'status': WF_STATUS_SOLD,
                'sale-price': salePrice,
                'profit': salePrice - itemCost,
                'sale-channel': method,
                'date-sold': soldAt,
              },
            }),
          });

          const { text, data } = await readApiJson(wfRes);
          if (!wfRes.ok) {
            results.push({
              ok: false,
              id: itemId,
              name: item.name || 'Unknown item',
              status: wfRes.status,
              error: errorMessageFromApi(data, text.substring(0, 200)),
            });
          } else {
            results.push({ ok: true, id: itemId, name: item.name || 'Unknown item' });
          }
        }

        const failed = results.filter(r => !r.ok);
        const responsePayload = { ok:failed.length === 0, txId, soldAt, results, failed };

        if (env.LBA_KV) {
          await env.LBA_KV.put(idempotencyKey, JSON.stringify(responsePayload), { expirationTtl: 60 * 60 * 24 * 180 });
          if (!failed.length) {
            await env.LBA_KV.put(legacyCartKey(url), JSON.stringify({
              items: [],
              discount: 0,
              total: 0,
              clearedAt: soldAt,
              lastTxId: txId,
            }), { expirationTtl: 86400 });
          }
        } else if (!failed.length) {
          globalThis[`_lbaCart_${legacyCartKey(url)}`] = JSON.stringify({
            items: [],
            discount: 0,
            total: 0,
            clearedAt: soldAt,
            lastTxId: txId,
          });
        }

        return json(responsePayload, failed.length ? 207 : 200);
      } catch (e) {
        console.error('POS checkout error:', e);
        return json({ error: e.message }, 500);
      }
    }

    // Shared show Cash Bags can be counted or closed from any joined store
    // device. The Worker performs the scoped update so every authenticated
    // team member can operate a bag even when direct table update policies
    // are intentionally more restrictive.
    if (url.pathname === '/pos/drawers/update' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const storeId = requestStoreId(request, url, body);
        const auth = await requireStoreUser(request, env, storeId);
        if (auth.error) return auth.error;
        const drawerId = String(body.drawerId || body.id || '').trim();
        const action = String(body.action || '').toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(drawerId)) return json({ ok:false, error:'Valid drawerId is required' }, 400);
        if (!['count','close'].includes(action)) return json({ ok:false, error:'action must be count or close' }, 400);
        const { data:rows } = await supabaseAdminFetch(env, `pos_drawer_sessions?id=eq.${encodeURIComponent(drawerId)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
        const drawer = rows?.[0];
        if (!drawer) return json({ ok:false, error:'Cash Bag not found for this store' }, 404);
        if (drawer.status === 'closed' && action === 'close') return json({ ok:true, drawer, alreadyClosed:true });
        const expectedCash = Number(body.expectedCash);
        const countedCash = Number(body.countedCash);
        if (!Number.isFinite(expectedCash) || !Number.isFinite(countedCash) || countedCash < 0) return json({ ok:false, error:'Valid expected and counted cash totals are required' }, 400);
        const now = new Date().toISOString();
        const patch = { expected_cash:expectedCash, counted_cash:countedCash, over_short:countedCash-expectedCash };
        if (action === 'close') Object.assign(patch, { status:'closed', closed_at:now, closed_by:auth.user.id });
        const { data:updated } = await supabaseAdminFetch(env, `pos_drawer_sessions?id=eq.${encodeURIComponent(drawerId)}&store_id=eq.${encodeURIComponent(storeId)}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify(patch) });
        await supabaseAdminFetch(env, 'pos_audit_log', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ id:crypto.randomUUID(), store_id:storeId, event_type:action==='close'?'drawer_close':'drawer_count', entity_type:'pos_drawer_session', entity_id:drawerId, details:{ expectedCash, countedCash, overShort:countedCash-expectedCash }, created_by:auth.user.id, created_at:now }) }).catch(()=>{});
        return json({ ok:true, drawer:updated?.[0] || { ...drawer, ...patch } });
      } catch (e) {
        console.error('Shared Cash Bag update error:', e);
        return json({ ok:false, error:e.message }, 500);
      }
    }

    // Voids a completed sale of any tender type (cash, card, Venmo, PayPal,
    // Cash App): restocks its built-in inventory line items, reverses any
    // cash-drawer credit, and logs the reversal. Stripe card sales should
    // normally be reversed through /stripe/refunds/create instead (that also
    // refunds the card charge itself) — this route only ever restocks and
    // marks the sale voided, it never touches money that already moved
    // through a payment processor.
    if (url.pathname === '/pos/sales/void' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const storeId = String(body.storeId || '');
        const saleId = String(body.saleId || '');
        const reason = String(body.reason || '').trim();
        if (!saleId) return json({ ok:false, error:'saleId is required' }, 400);
        if (!reason) return json({ ok:false, error:'A reason is required to void a sale' }, 400);
        const auth = await requireStoreUser(request, env, storeId, ['owner','admin']);
        if (auth.error) return auth.error;

        const { data:sales } = await supabaseAdminFetch(env, `pos_sales?id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
        const sale = sales?.[0];
        if (!sale) return json({ ok:false, error:'Sale not found for this store' }, 404);
        if (sale.status === 'voided') return json({ ok:true, saleId, alreadyVoided:true, restockedItems:0, cashReversed:0 });

        // Conditional update keyed on the sale's current status closes the
        // race window against a second concurrent void attempt — if another
        // request already changed the status, this returns zero rows and we
        // bail out instead of double-restocking or double-reversing cash.
        const { data:voidedRows } = await supabaseAdminFetch(env,
          `pos_sales?id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&status=eq.${encodeURIComponent(sale.status)}`,
          { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ status:'voided' }) });
        if (!voidedRows?.length) return json({ ok:false, error:'Sale status changed before it could be voided; refresh and try again' }, 409);

        const { data:lines } = await supabaseAdminFetch(env, `pos_sale_lines?sale_id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,item_id,quantity`);
        const restockedItems = await restockVoidedSaleLines(env, { storeId, saleId, lines: lines || [], userId: auth.user.id });

        const { data:payments } = await supabaseAdminFetch(env, `pos_payments?sale_id=eq.${encodeURIComponent(saleId)}&store_id=eq.${encodeURIComponent(storeId)}&select=method,amount,status`);
        const cashAmount = (payments || [])
          .filter(p => isPhysicalCashTender(p.method) && p.status !== 'refunded')
          .reduce((sum,p) => sum + Number(p.amount || 0), 0);

        let cashReversed = 0;
        if (cashAmount > 0 && sale.drawer_session_id) {
          await supabaseAdminFetch(env, 'pos_drawer_movements', {
            method:'POST', headers:{ Prefer:'return=minimal' },
            body:JSON.stringify({ id:crypto.randomUUID(), drawer_session_id:sale.drawer_session_id, store_id:storeId, sale_id:saleId, movement_type:'sale_void', amount:-cashAmount, note:('Sale voided: ' + reason).slice(0,500), created_by:auth.user.id }),
          });
          const { data:drawerRows } = await supabaseAdminFetch(env, `pos_drawer_sessions?id=eq.${encodeURIComponent(sale.drawer_session_id)}&select=expected_cash&limit=1`);
          const currentExpected = Number(drawerRows?.[0]?.expected_cash || 0);
          await supabaseAdminFetch(env, `pos_drawer_sessions?id=eq.${encodeURIComponent(sale.drawer_session_id)}`, {
            method:'PATCH', headers:{ Prefer:'return=minimal' },
            body:JSON.stringify({ expected_cash: currentExpected - cashAmount }),
          });
          cashReversed = cashAmount;
        }

        await supabaseAdminFetch(env, 'pos_audit_log', {
          method:'POST', headers:{ Prefer:'return=minimal' },
          body:JSON.stringify({ id:crypto.randomUUID(), store_id:storeId, event_type:'sale_voided', entity_type:'pos_sale', entity_id:saleId, details:{ reason, total:sale.total, restockedItems, cashReversed }, created_by:auth.user.id, created_at:new Date().toISOString() }),
        });

        return json({ ok:true, saleId, restockedItems, cashReversed });
      } catch (e) {
        console.error('Sale void error:', e);
        return json({ ok:false, error: e.message }, 500);
      }
    }

    // ── SportsCardsPro: card image lookup ─────────────────────────────────────
    // GET /pricing/sportscardspro/image?id=SCPID  (preferred — numeric or path slug)
    // GET /pricing/sportscardspro/image?console=CONSOLE_NAME&name=PRODUCT_NAME  (fallback)
    // SCP and PC share the same numeric product IDs, so for numeric IDs we hit the
    // PriceCharting /api/product endpoint directly (most reliable). For path slugs
    // (e.g. baseball-cards-2025-bowman-chrome/jacob-wilson-refractor-1) we scrape the
    // SCP product page. Falls back to PC page scraping via derived slug if all else fails.
    if (url.pathname === '/pricing/sportscardspro/image') {
      const scpId       = url.searchParams.get('id') || '';
      const consoleName = url.searchParams.get('console') || '';
      const productName = url.searchParams.get('name') || '';
      if (!scpId && (!consoleName || !productName)) return json({ ok: false, error: 'id or (console and name) required' }, 400);

      // Numeric ID: SCP and PC share the same product database — call PC API directly for the image
      if (scpId && /^\d+$/.test(scpId)) {
        const pcToken = env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY;
        if (pcToken) {
          try {
            const pcRes = await fetch(`https://www.pricecharting.com/api/product?id=${encodeURIComponent(scpId)}&t=${encodeURIComponent(pcToken)}`, {
              headers: { 'Accept': 'application/json', 'User-Agent': 'Walk-Off Sports Cards Dealer App/2026' },
              cf: { cacheTtl: 7200 },
            });
            if (pcRes.ok) {
              const pcData = await pcRes.json().catch(() => null);
              const rawImg = pcData?.['image-url'] || pcData?.imageUrl || pcData?.image || '';
              if (rawImg) {
                const imageUrl = /^\/\//.test(rawImg) ? 'https:' + rawImg : /^\//.test(rawImg) ? 'https://www.pricecharting.com' + rawImg : rawImg;
                if (imageUrl) return json({ ok: true, imageUrl });
              }
            }
          } catch (_) {}
        }
      }

      const toSlug = s => String(s).toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Path slug (e.g. baseball-cards-2025-bowman-chrome/jacob-wilson-refractor-1): fetch SCP page directly.
      // Otherwise fall back to deriving the slug from console + product names on PC.
      const pageUrl = (scpId && scpId.includes('/'))
        ? `https://www.sportscardspro.com/game/${scpId}`
        : `https://www.pricecharting.com/game/${toSlug(consoleName)}/${toSlug(productName)}`;

      const pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cf: { cacheTtl: 7200, cacheEverything: true },
      });

      if (!pageRes.ok) return json({ ok: false, imageUrl: null, status: pageRes.status });

      const html = await pageRes.text();
      const m = html.match(/storage\.googleapis\.com\/images\.pricecharting\.com\/([^/"']+)\/(?:240|300|400|1600)\.jpg/);
      if (!m) return json({ ok: false, imageUrl: null });

      const imageUrl = `https://storage.googleapis.com/images.pricecharting.com/${m[1]}/240.jpg`;
      return json({ ok: true, imageUrl });
    }

    // ── SportsCardsPro: candidate list ───────────────────────────────────────
    // dashboard.html calls: GET /pricing/sportscardspro/products?q=QUERY
    // Requires SCP_ACCESS_TOKEN worker secret (set via: wrangler secret put SCP_ACCESS_TOKEN)
    if (url.pathname === '/pricing/sportscardspro/products') {
      const q = url.searchParams.get('q') || '';
      if (!q) return json({ ok: false, error: 'q required' }, 400);

      const scpToken = await getStoredSecret(env, 'SCP_ACCESS_TOKEN');
      if (!scpToken) return json({ ok: false, needsKey: true, source: 'sportscardspro', error: 'SCP_ACCESS_TOKEN not set in Worker secrets. Set it with: wrangler secret put SCP_ACCESS_TOKEN' }, 501);

      // SportsCardsPro/PriceCharting uses "t" as the token param (same as PC download URLs)
      const upstreamParams = new URLSearchParams({ q, t: scpToken });
      const upstream = 'https://www.sportscardspro.com/api/products?' + upstreamParams;

      const res = await fetch(upstream, {
        headers: {
          'User-Agent': 'Walk-Off Sports Cards Dealer App/2026',
          'Accept': 'application/json',
        },
        // Cloudflare edge cache — 5 min for searches
        cf: { cacheTtl: 300, cacheEverything: false },
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

      // Normalise to a consistent shape: always { ok, products: [] }
      const products = data.products || data.matches || data.data || data.results || (Array.isArray(data) ? data : []);
      return json({ ok: res.ok && !data.error, status: res.status, products, _raw: data.error ? data : undefined });
    }

    // ── SportsCardsPro: single-product hydration ──────────────────────────────
    // dashboard.html calls: GET /pricing/sportscardspro/product?id=ID
    if (url.pathname === '/pricing/sportscardspro/product') {
      const id = url.searchParams.get('id') || '';
      if (!id) return json({ ok: false, error: 'id required' }, 400);

      const scpToken = await getStoredSecret(env, 'SCP_ACCESS_TOKEN');
      if (!scpToken) return json({ ok: false, needsKey: true, source: 'sportscardspro', error: 'SCP_ACCESS_TOKEN not set in Worker secrets.' }, 501);

      const upstreamParams = new URLSearchParams({ id, t: scpToken });
      const upstream = 'https://www.sportscardspro.com/api/product?' + upstreamParams;

      const res = await fetch(upstream, {
        headers: {
          'User-Agent': 'Walk-Off Sports Cards Dealer App/2026',
          'Accept': 'application/json',
        },
        // Longer cache for exact-product data — 15 min
        cf: { cacheTtl: 900, cacheEverything: false },
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

      // Normalise: always return { ok, product: {...} }
      const product = data.product || data.data || (!data.error && data.id ? data : null);
      return json({ ok: res.ok && !data.error, status: res.status, product, _raw: data.error ? data : undefined });
    }

    if (url.pathname.startsWith('/proxy/')) {
      if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);
      const storeId = requestStoreId(request, url);
      const allowedRoles = ['GET','HEAD'].includes(request.method)
        ? ['owner','admin','manager','employee']
        : ['owner','admin'];
      const auth = await requireStoreUser(request, env, storeId, allowedRoles);
      if (auth.error) return auth.error;

      const wfPath = url.pathname.replace(/^\/proxy/, '');
      const wfUrl = WEBFLOW_BASE + wfPath + (url.search || '');

      let body;
      if (!['GET', 'HEAD'].includes(request.method)) body = await request.text();

      try {
        const wfRes = await fetch(wfUrl, {
          method: request.method,
          headers: {
            'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
            'Content-Type': 'application/json',
            'accept': 'application/json',
          },
          body,
        });

        const data = await wfRes.text();
        return new Response(data, {
          status: wfRes.status,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === '/ebay/status') {
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId, ['owner','admin']);
      if (auth.error) return auth.error;
      const hasClient = !!(await getStoredSecret(env, 'EBAY_CLIENT_ID')) && !!(await getStoredSecret(env, 'EBAY_CLIENT_SECRET'));
      const hasRefresh = !!(await getStoredSecret(env, 'EBAY_REFRESH_TOKEN'));
      const ruName = await getStoredSecret(env, 'EBAY_RU_NAME');
      return json({
        ok: true,
        clientConfigured: hasClient,
        refreshConfigured: hasRefresh,
        legacyUserToken: !!(await getStoredSecret(env, 'EBAY_USER_TOKEN')),
        ruNameConfigured: !!ruName,
        readyToList: hasClient && hasRefresh,
      });
    }

    if (url.pathname === '/ebay/auth-url') {
      const storeId = requestStoreId(request, url);
      const authz = await requireStoreUser(request, env, storeId, ['owner','admin']);
      if (authz.error) return authz.error;
      const clientId = await getStoredSecret(env, 'EBAY_CLIENT_ID');
      const ruName = await getStoredSecret(env, 'EBAY_RU_NAME');
      if (!clientId) return json({ error: 'EBAY_CLIENT_ID not configured' }, 500);
      if (!ruName) return json({ error: 'EBAY_RU_NAME not configured', hint: 'Set the RuName/redirect_uri value from eBay User Tokens page as EBAY_RU_NAME.' }, 500);
      if (!env.LBA_KV) return json({ error:'KV is required for secure eBay OAuth state' }, 503);
      const state = crypto.randomUUID();
      await env.LBA_KV.put('ebay_oauth_state:' + state, JSON.stringify({ storeId, userId:authz.user.id }), { expirationTtl: 900 });
      const auth = new URL(EBAY_AUTH_URL);
      auth.searchParams.set('client_id', clientId);
      auth.searchParams.set('redirect_uri', ruName);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', EBAY_SCOPES);
      auth.searchParams.set('state', state);
      return json({ ok: true, url: auth.toString(), state, scopes: EBAY_SCOPES.split(' ') });
    }

    if (url.pathname === '/ebay/oauth/callback') {
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const ruName = await getStoredSecret(env, 'EBAY_RU_NAME');
      if (!code) return json({ error: 'Missing eBay code' }, 400);
      if (!env.LBA_KV || !state) return json({ error:'Missing secure OAuth state' }, 400);
      const okState = await env.LBA_KV.get('ebay_oauth_state:' + state);
      if (!okState) return json({ error: 'Invalid or expired OAuth state' }, 400);
      await env.LBA_KV.delete('ebay_oauth_state:' + state);
      const data = await ebayTokenRequest(env, new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ruName,
      }));
      if (data.refresh_token) await putStoredSecret(env, 'EBAY_REFRESH_TOKEN', data.refresh_token);
      if (data.access_token && env.LBA_KV) {
        await env.LBA_KV.put('secret:EBAY_ACCESS_TOKEN', data.access_token, { expirationTtl: Math.max(300, Number(data.expires_in || 7200)) });
        await env.LBA_KV.put('secret:EBAY_ACCESS_EXPIRES', String(Date.now() + Number(data.expires_in || 7200) * 1000));
      }
      return new Response('<html><body style="font-family:system-ui;background:#0d0f14;color:#e4e4e8;padding:32px"><h2>eBay connected</h2><p>You can close this tab and return to Walk-Off.</p></body></html>', {
        headers: { ...CORS, 'Content-Type': 'text/html' },
      });
    }

    if (url.pathname === '/ebay/list') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId, ['owner','admin']);
      if (auth.error) return auth.error;
      let ebayToken = '';
      try { ebayToken = await getEbayUserAccessToken(env); }
      catch (tokenErr) { return json({ needsToken: true, error: tokenErr.message }, 401); }
      if (!ebayToken) return json({ needsToken: true, error: 'Connect eBay first: missing user access/refresh token' }, 401);

      try {
        const b = await request.json();
        const {
          title, description, price, shippingCost = '0.00',
          format = 'FIXED_PRICE', conditionId = '3000',
          conditionDescription = '', duration = 'GTC',
          quantity = 1, categoryId = '261328',
          imageUrl = null, imageUrls = [],
          sport = '', year = '', manufacturer = '',
          set = '', parallel = '', cardNumber = '',
          player = '', team = '', grade = '', grader = '',
          isRookie = false, serialNumber = '',
          upc = '', features = '', productType = '', configuration = '',
          league = '', season = '', customAspects = {},
        } = b;

        if (!title || !price) return json({ error: 'title and price required' }, 400);

        const locationKey = env.EBAY_LOCATION_KEY || 'walkoff-main';
        await fetch(`https://api.ebay.com/sell/inventory/v1/location/${locationKey}`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + ebayToken,
            'Content-Type': 'application/json',
            'Content-Language': 'en-US',
          },
          body: JSON.stringify({
            location: { address: { addressLine1: '26059 Miller Bay Rd NE', city: 'Kingston', stateOrProvince: 'WA', postalCode: '98346', country: 'US' } },
            name: 'Walk-Off Sports Cards',
            merchantLocationStatus: 'ENABLED',
            locationTypes: ['STORE'],
          }),
        }).catch(() => {});

        const sku = 'lba-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
        const aspects = {};
        if (sport) aspects['Sport'] = [sport];
        if (year) aspects['Year'] = [String(year)];
        if (manufacturer) aspects['Manufacturer'] = [manufacturer];
        if (set) aspects['Set'] = [set];
        if (parallel && parallel !== 'Base') aspects['Parallel/Variety'] = [parallel];
        if (cardNumber) aspects['Card Number'] = [String(cardNumber)];
        if (player) aspects['Player/Athlete'] = [player];
        if (team) aspects['Team'] = [team];
        if (isRookie) aspects['Rookie'] = ['Yes'];
        if (serialNumber) aspects['Serial Numbered'] = [serialNumber];
        if (grader) aspects['Professional Grader'] = [grader];
        if (grade) aspects['Grade'] = [String(grade)];
        if (upc) aspects['UPC'] = [String(upc)];
        if (league) aspects['League'] = [league];
        if (season) aspects['Season'] = [String(season)];
        if (productType) aspects['Type'] = [productType === 'sealed' ? 'Sports Trading Card Box' : productType];
        if (configuration) aspects['Configuration'] = [configuration];
        if (features) {
          const featureList = String(features).split(',').map(s => s.trim()).filter(Boolean);
          if (featureList.length) aspects['Features'] = featureList;
        }
        for (const [k, v] of Object.entries(customAspects || {})) {
          if (!k || v == null || v === '') continue;
          const values = Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean) : [String(v || '').trim()].filter(Boolean);
          if (values.length) aspects[k] = values;
        }
        aspects['Sport'] = aspects['Sport'] || ['Trading Cards'];
        for (const [k, v] of Object.entries({ ...aspects })) {
          if (!Array.isArray(v) || !v.length || v.some(x => x == null || String(x).trim() === '')) delete aspects[k];
        }

        const allImgUrls = [];
        if (imageUrl) allImgUrls.push(imageUrl);
        (imageUrls || []).forEach(u => { if (u && !allImgUrls.includes(u)) allImgUrls.push(u); });

        const itemBody = {
          product: {
            title: title.substring(0, 80),
            description: description || title,
            aspects,
            imageUrls: allImgUrls.slice(0, 12),
          },
          conditionId: String(conditionId),
          conditionDescription: conditionDescription || undefined,
          availability: { shipToLocationAvailability: { quantity: parseInt(quantity) || 1 } },
          packageWeightAndSize: {
            dimensions: { height: 0.1, length: 6.5, width: 4, unit: 'INCH' },
            weight: { value: 0.1, unit: 'POUND' },
          },
        };

        const itemRes = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`, {
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + ebayToken,
            'Content-Type': 'application/json',
            'Content-Language': 'en-US',
          },
          body: JSON.stringify(itemBody),
        });

        if (!itemRes.ok && itemRes.status !== 204) {
          const errTxt = await itemRes.text();
          let errData; try { errData = JSON.parse(errTxt); } catch (_) { errData = errTxt; }
          const msg = errData?.errors?.[0]?.longMessage || errData?.errors?.[0]?.message || errTxt.substring(0, 200);
          return json({ error: 'Item creation failed (' + itemRes.status + '): ' + msg, detail: errData }, itemRes.status);
        }

        const listingPolicies = {};
        if (env.EBAY_FULFILLMENT_POLICY_ID) listingPolicies.fulfillmentPolicyId = env.EBAY_FULFILLMENT_POLICY_ID;
        if (env.EBAY_PAYMENT_POLICY_ID) listingPolicies.paymentPolicyId = env.EBAY_PAYMENT_POLICY_ID;
        if (env.EBAY_RETURN_POLICY_ID) listingPolicies.returnPolicyId = env.EBAY_RETURN_POLICY_ID;

        const offerBody = {
          sku,
          marketplaceId: 'EBAY_US',
          format,
          availableQuantity: parseInt(quantity) || 1,
          categoryId: String(categoryId),
          listingDescription: description || title,
          listingPolicies,
          merchantLocationKey: locationKey,
          pricingSummary: { price: { value: parseFloat(price).toFixed(2), currency: 'USD' } },
          ...(parseFloat(shippingCost) > 0 ? {} : {}),
        };

        const offerRes = await fetch('https://api.ebay.com/sell/inventory/v1/offer', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + ebayToken,
            'Content-Type': 'application/json',
            'Content-Language': 'en-US',
          },
          body: JSON.stringify(offerBody),
        });

        const offerTxt = await offerRes.text();
        let offerData; try { offerData = JSON.parse(offerTxt); } catch (_) { offerData = { raw: offerTxt }; }
        if (!offerRes.ok) {
          const msg = offerData?.errors?.[0]?.longMessage || offerData?.errors?.[0]?.message || offerTxt.substring(0, 300);
          return json({ error: 'Offer failed (' + offerRes.status + '): ' + msg, detail: offerData }, offerRes.status);
        }

        const offerId = offerData.offerId;
        const pubRes = await fetch(`https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + ebayToken, 'Content-Type': 'application/json' },
        });

        const pubTxt = await pubRes.text();
        let pubData; try { pubData = JSON.parse(pubTxt); } catch (_) { pubData = { raw: pubTxt }; }
        if (!pubRes.ok) {
          const msg = pubData?.errors?.[0]?.longMessage || pubData?.errors?.[0]?.message || pubTxt.substring(0, 300);
          return json({ error: 'Publish failed (' + pubRes.status + '): ' + msg, detail: pubData }, pubRes.status);
        }

        return json({ ok: true, listingId: pubData.listingId, offerId, sku });
      } catch (e) {
        console.error('eBay listing error:', e);
        return json({ error: e.message }, 500);
      }
    }

    // ── Stripe QR Checkout v1 ────────────────────────────────────────────────

    // POST /stripe/create-checkout
    // Creates a Stripe Checkout Session (hosted page) for QR-code payment flow.
    // Returns { session_id, checkout_url }.
    if (url.pathname === '/stripe/create-checkout' && request.method === 'POST') {
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not configured in Worker secrets' }, 500);
      try {
        const body = await request.json();
        const { amount_cents, description, store_name } = body;
        if (!amount_cents || amount_cents < 50) return json({ error: 'Minimum amount is $0.50' }, 400);
        const origin = url.origin;
        const params = new URLSearchParams({
          mode: 'payment',
          'payment_method_types[]': 'card',
          success_url: `${origin}/stripe/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/stripe/checkout-cancel`,
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][product_data][name]': description || (store_name ? `${store_name} — Card Purchase` : 'Card Show Purchase'),
          'line_items[0][price_data][unit_amount]': String(Math.round(amount_cents)),
          'line_items[0][quantity]': '1',
          'metadata[source]': 'walkoff-pos',
          'metadata[store]': store_name || '',
        });
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await r.json();
        if (!r.ok) return json({ error: data.error?.message || 'Stripe error', code: data.error?.code }, r.status);
        // Cache pending status in KV (TTL 1 hour)
        if (env.LBA_KV) {
          await env.LBA_KV.put(`stripe_checkout:${data.id}`, JSON.stringify({ status: 'pending', amount: amount_cents, created: Date.now() }), { expirationTtl: 3600 });
        }
        return json({ session_id: data.id, checkout_url: data.url });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // GET /stripe/session-status?id=cs_xxx
    // Checks payment status — first checks KV cache (webhook may have updated it),
    // then falls back to polling Stripe directly.
    if (url.pathname === '/stripe/session-status' && request.method === 'GET') {
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'session id required' }, 400);
      try {
        // Check KV cache first
        if (env.LBA_KV) {
          const cached = await env.LBA_KV.get(`stripe_checkout:${id}`);
          if (cached) {
            const d = JSON.parse(cached);
            if (d.status === 'paid') return json({ status: 'complete', payment_status: 'paid', paid: true, amount_total: d.amount });
          }
        }
        // Poll Stripe API
        if (!env.STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not configured' }, 500);
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
        });
        const data = await r.json();
        if (!r.ok) return json({ error: data.error?.message || 'Stripe error' }, r.status);
        const paid = data.payment_status === 'paid';
        // Update KV if paid
        if (paid && env.LBA_KV) {
          await env.LBA_KV.put(`stripe_checkout:${id}`, JSON.stringify({ status: 'paid', amount: data.amount_total, created: Date.now() }), { expirationTtl: 86400 });
        }
        return json({ status: data.status, payment_status: data.payment_status, paid, amount_total: data.amount_total });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // POST /stripe/webhook
    // Receives Stripe events with HMAC-SHA256 signature verification.
    // Requires STRIPE_WEBHOOK_SECRET in Worker secrets (whsec_...).
    if (url.pathname === '/stripe/webhook' && request.method === 'POST') {
      const body = await request.text();
      const sigHeader = request.headers.get('stripe-signature') || '';

      // Verify Stripe signature using Web Crypto API
      if (env.STRIPE_WEBHOOK_SECRET && sigHeader) {
        try {
          const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
          const t = parts.t;
          const v1 = parts.v1;
          if (!t || !v1) return new Response('Invalid signature header', { status: 400 });

          // Reject events older than 5 minutes (replay protection)
          if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
            return new Response('Webhook timestamp too old', { status: 400 });
          }

          const signedPayload = `${t}.${body}`;
          const secret = env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')
            ? env.STRIPE_WEBHOOK_SECRET.slice(6)
            : env.STRIPE_WEBHOOK_SECRET;

          // Decode base64 secret
          const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
          const key = await crypto.subtle.importKey(
            'raw', secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false, ['sign']
          );
          const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
          const computed = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');

          if (computed !== v1) return new Response('Signature mismatch', { status: 401 });
        } catch (e) {
          console.error('Webhook signature error:', e.message);
          return new Response('Signature verification failed', { status: 401 });
        }
      }
      // (If STRIPE_WEBHOOK_SECRET not yet set, accept without verification — remove after key is confirmed working)

      let event;
      try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }

      // Helper: read/write subscription KV record
      const subKvKey = id => `sub:store:${id}`;
      const custKvKey = id => `sub:cust:${id}`;
      const getSubRec = async id => { try { const r = await env.LBA_KV?.get(subKvKey(id)); return r ? JSON.parse(r) : null; } catch { return null; } };
      const putSubRec = async (id, rec) => env.LBA_KV?.put(subKvKey(id), JSON.stringify({ ...rec, updatedAt: Date.now() }), { expirationTtl: 400 * 24 * 3600 }).catch(() => {});
      const storeFromCust = async custId => { try { const r = await env.LBA_KV?.get(custKvKey(custId)); return r ? JSON.parse(r).store_id : null; } catch { return null; } };

      // checkout.session.completed — POS payment AND subscription checkout
      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object;
        if (session?.id && env.LBA_KV) {
          if (session.metadata?.source === 'walkoff-subscription' || session.mode === 'subscription') {
            // Subscription checkout completed — activate the store
            const pendingSession = await env.LBA_KV.get(`sub:session:${session.id}`).then(r => r ? JSON.parse(r) : {}).catch(() => ({}));
            const storeId = session.metadata?.store_id
              || await storeFromCust(session.customer)
              || pendingSession.store_id;
            if (storeId) {
              const existing = await getSubRec(storeId) || {};
              await putSubRec(storeId, { ...existing, status: 'active', plan_code:session.metadata?.plan_code || pendingSession.plan_code || existing.plan_code || 'store', stripe_customer_id: session.customer, stripe_subscription_id: session.subscription });
              if (session.customer) await env.LBA_KV.put(custKvKey(session.customer), JSON.stringify({ store_id: storeId }), { expirationTtl: 400 * 24 * 3600 }).catch(() => {});
              await env.LBA_KV.delete(`sub:session:${session.id}`).catch(() => {});
            }
          } else {
            // POS one-time payment — update checkout cache (existing behavior)
            await env.LBA_KV.put(`stripe_checkout:${session.id}`, JSON.stringify({ status: 'paid', amount: session.amount_total, created: Date.now() }), { expirationTtl: 86400 }).catch(() => {});
          }
        }
      }

      // customer.subscription.created / .updated — sync status + period
      if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        const sub = event.data?.object;
        if (sub && env.LBA_KV) {
          const storeId = await storeFromCust(sub.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            await putSubRec(storeId, { ...existing, status: sub.status, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, current_period_end: sub.current_period_end ? sub.current_period_end * 1000 : existing.current_period_end, cancel_at_period_end: sub.cancel_at_period_end || false });
          }
        }
      }

      // customer.subscription.deleted — canceled
      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data?.object;
        if (sub && env.LBA_KV) {
          const storeId = await storeFromCust(sub.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            await putSubRec(storeId, { ...existing, status: 'canceled' });
          }
        }
      }

      // invoice.payment_succeeded — refresh period end
      if (event.type === 'invoice.payment_succeeded') {
        const inv = event.data?.object;
        if (inv?.customer && env.LBA_KV) {
          const storeId = await storeFromCust(inv.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            const periodEnd = inv.lines?.data?.[0]?.period?.end;
            await putSubRec(storeId, { ...existing, status: 'active', current_period_end: periodEnd ? periodEnd * 1000 : existing.current_period_end });
          }
        }
      }

      // invoice.payment_failed — mark past_due
      if (event.type === 'invoice.payment_failed') {
        const inv = event.data?.object;
        if (inv?.customer && env.LBA_KV) {
          const storeId = await storeFromCust(inv.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            await putSubRec(storeId, { ...existing, status: 'past_due' });
          }
        }
      }

      return new Response('ok', { status: 200 });
    }

    // ── Subscription Management ───────────────────────────────────────────────
    const SUBSCRIPTION_PLANS = {
      research: { name: 'Research', price: 19, capabilities: ['research'], envKey: 'STRIPE_SUBSCRIPTION_PRICE_RESEARCH' },
      register: { name: 'Register', price: 49, capabilities: ['research','checkout','sales'], envKey: 'STRIPE_SUBSCRIPTION_PRICE_REGISTER' },
      store: { name: 'Store', price: 89, capabilities: ['research','checkout','sales','inventory','consignments','staff','shows'], envKey: 'STRIPE_SUBSCRIPTION_PRICE_STORE' },
      pro: { name: 'Pro', price: 149, capabilities: ['research','checkout','sales','inventory','consignments','staff','shows','marketplace','advanced'], envKey: 'STRIPE_SUBSCRIPTION_PRICE_PRO' },
    };
    const subscriptionPlan = code => SUBSCRIPTION_PLANS[code] ? code : 'store';
    const publicPlan = code => { const p = SUBSCRIPTION_PLANS[subscriptionPlan(code)]; return { plan_code:subscriptionPlan(code), plan_name:p.name, price_monthly:p.price, capabilities:p.capabilities }; };

    if (url.pathname === '/subscription/plans' && request.method === 'GET') {
      return json({ ok:true, plans:Object.keys(SUBSCRIPTION_PLANS).map(publicPlan) });
    }

    // POST /subscription/init-trial
    // Idempotent — writes a 14-day trial record if no subscription exists yet.
    if (url.pathname === '/subscription/init-trial' && request.method === 'POST') {
      if (!env.LBA_KV) return json({ ok: false, error: 'KV not configured' }, 500);
      try {
        const { store_id } = await request.json().catch(() => ({}));
        if (!store_id) return json({ ok: false, error: 'store_id required' }, 400);
        const authz = await requireStoreUser(request, env, store_id, ['owner','admin']);
        if (authz.error) return authz.error;
        const existing = await env.LBA_KV.get(`sub:store:${store_id}`);
        if (existing) return json({ ok: true, new: false, status: JSON.parse(existing).status });
        const trial_end = Date.now() + 14 * 24 * 60 * 60 * 1000;
        await env.LBA_KV.put(`sub:store:${store_id}`, JSON.stringify({ status: 'trialing', plan_code:'store', trial_end, created_at: Date.now(), updatedAt: Date.now() }), { expirationTtl: 400 * 24 * 3600 });
        return json({ ok: true, new: true, status: 'trialing', trial_end });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }

    // GET /subscription/status?store_id=X
    if (url.pathname === '/subscription/status' && request.method === 'GET') {
      const storeId = (url.searchParams.get('store_id') || '').trim();
      if (!storeId) return json({ ok: false, error: 'store_id required' }, 400);
      const authz = await requireStoreUser(request, env, storeId);
      if (authz.error) return authz.error;
      if (!env.LBA_KV) return json({ ok: true, status: 'none', active: false, daysRemaining: 0 });
      const sRank = await getSRankEntitlement(env, storeId);
      if (sRank) return json({ ok:true, status:'s_rank', active:true, daysRemaining:0, plan_code:'pro', plan_name:'S Rank', price_monthly:0, capabilities:SUBSCRIPTION_PLANS.pro.capabilities, complimentary:true, granted_at:sRank.grantedAt || null });
      const raw = await env.LBA_KV.get(`sub:store:${storeId}`);
      if (!raw) return json({ ok: true, status: 'none', active: false, daysRemaining: 0 });
      const rec = JSON.parse(raw);
      const now = Date.now();
      let status = rec.status || 'none';
      const endMs = status === 'trialing' ? rec.trial_end : rec.current_period_end;
      if ((status === 'trialing' || status === 'active') && endMs && endMs < now) {
        status = status === 'trialing' ? 'trialing_expired' : 'expired';
        await env.LBA_KV.put(`sub:store:${storeId}`, JSON.stringify({ ...rec, status, updatedAt: now }), { expirationTtl: 400 * 24 * 3600 }).catch(() => {});
      }
      const active = status === 'active' || status === 'trialing';
      const daysRemaining = endMs && endMs > now ? Math.ceil((endMs - now) / 86400000) : 0;
      const plan = publicPlan(rec.plan_code); // Legacy active/trial subscriptions are grandfathered to Store.
      return json({ ok: true, status, active, daysRemaining, ...plan, trial_end: rec.trial_end || null, current_period_end: rec.current_period_end || null, cancel_at_period_end: rec.cancel_at_period_end || false });
    }

    // POST /subscription/checkout
    // Body: { store_id, store_name, email, plan_code }
    // Creates a Stripe subscription checkout session.
    // Requires STRIPE_SECRET_KEY plus the selected STRIPE_SUBSCRIPTION_PRICE_* secret.
    if (url.pathname === '/subscription/checkout' && request.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' }, 500);
      try {
        const { store_id, store_name, email, plan_code } = await request.json().catch(() => ({}));
        if (!store_id) return json({ ok: false, error: 'store_id required' }, 400);
        const authz = await requireStoreUser(request, env, store_id, ['owner','admin']);
        if (authz.error) return authz.error;
        const selectedPlan = subscriptionPlan(plan_code);
        const priceId = env[SUBSCRIPTION_PLANS[selectedPlan].envKey] || (selectedPlan === 'store' ? env.STRIPE_SUBSCRIPTION_PRICE_ID : null);
        if (!priceId) return json({ ok:false, error:`${SUBSCRIPTION_PLANS[selectedPlan].envKey} not configured in Worker secrets` }, 500);
        const origin = url.origin;
        const params = new URLSearchParams({
          mode: 'subscription',
          'payment_method_types[]': 'card',
          'line_items[0][price]': priceId,
          'line_items[0][quantity]': '1',
          success_url: `${origin}/subscription/success?store_id=${encodeURIComponent(store_id)}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/subscription/cancel`,
          'metadata[store_id]': store_id,
          'metadata[plan_code]': selectedPlan,
          'metadata[source]': 'walkoff-subscription',
          allow_promotion_codes: 'true',
        });
        if (email) params.set('customer_email', email);
        if (store_name) params.set('metadata[store_name]', store_name);
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await r.json();
        if (!r.ok) return json({ ok: false, error: data.error?.message || 'Stripe error' }, r.status);
        if (env.LBA_KV) await env.LBA_KV.put(`sub:session:${data.id}`, JSON.stringify({ store_id, plan_code:selectedPlan }), { expirationTtl: 86400 });
        return json({ ok: true, checkout_url: data.url, session_id: data.id });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }

    // POST /subscription/customer-portal
    // Body: { store_id } — opens Stripe billing portal for the store's customer
    if (url.pathname === '/subscription/customer-portal' && request.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' }, 500);
      try {
        const { store_id } = await request.json().catch(() => ({}));
        if (!store_id || !env.LBA_KV) return json({ ok: false, error: 'store_id required' }, 400);
        const authz = await requireStoreUser(request, env, store_id, ['owner','admin']);
        if (authz.error) return authz.error;
        const raw = await env.LBA_KV.get(`sub:store:${store_id}`);
        if (!raw) return json({ ok: false, error: 'No subscription found' }, 404);
        const { stripe_customer_id } = JSON.parse(raw);
        if (!stripe_customer_id) return json({ ok: false, error: 'No Stripe customer — subscribe first' }, 400);
        const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ customer: stripe_customer_id, return_url: url.origin + '/dashboard.html' }).toString(),
        });
        const data = await r.json();
        if (!r.ok) return json({ ok: false, error: data.error?.message || 'Stripe error' }, r.status);
        return json({ ok: true, url: data.url });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }

    // GET /subscription/success — redirect page shown after subscription checkout
    if (url.pathname === '/subscription/success') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Subscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(0,255,179,.25);border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center}.ic{font-size:64px;margin-bottom:20px}.ti{font-size:24px;font-weight:900;color:#00ffb3;margin-bottom:12px}.su{color:#8892a4;font-size:13px;line-height:1.7;margin-bottom:24px}.btn{display:inline-block;background:#00ffb3;color:#000;font-weight:900;padding:13px 28px;border-radius:10px;text-decoration:none;font-size:13px;letter-spacing:.08em}</style></head><body><div class="c"><div class="ic">🎉</div><div class="ti">You're Subscribed!</div><div class="su">Your store subscription is now active.<br>Return to the dashboard to get started.</div><a href="dashboard.html" class="btn">OPEN DASHBOARD →</a></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // GET /subscription/cancel — redirect page shown after cancelled checkout
    if (url.pathname === '/subscription/cancel') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Checkout Cancelled</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(255,100,50,.25);border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center}.ic{font-size:64px;margin-bottom:20px}.ti{font-size:24px;font-weight:900;color:#ff6432;margin-bottom:12px}.su{color:#8892a4;font-size:13px;line-height:1.7;margin-bottom:24px}.btn{display:inline-block;background:#00ffb3;color:#000;font-weight:900;padding:13px 28px;border-radius:10px;text-decoration:none;font-size:13px;letter-spacing:.08em}</style></head><body><div class="c"><div class="ic">✕</div><div class="ti">Checkout Cancelled</div><div class="su">No charge was made. You can subscribe when ready.</div><a href="dashboard.html" class="btn">RETURN TO DASHBOARD →</a></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // GET /stripe/checkout-success  (Stripe redirects customer here after payment)
    if (url.pathname === '/stripe/checkout-success') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Payment Complete</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(0,255,179,.25);border-radius:20px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.ic{font-size:72px;margin-bottom:20px}.ti{font-size:26px;font-weight:900;color:#00ffb3;margin-bottom:12px}.su{color:#657080;font-size:14px;line-height:1.6}</style></head><body><div class="c"><div class="ic">✓</div><div class="ti">Payment Complete!</div><div class="su">Thank you. The dealer has been notified.<br>You may now close this window.</div></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // GET /stripe/checkout-cancel  (Stripe redirects customer here if they cancel)
    if (url.pathname === '/stripe/checkout-cancel') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Payment Cancelled</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(255,77,109,.25);border-radius:20px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.ic{font-size:72px;margin-bottom:20px}.ti{font-size:26px;font-weight:900;color:#ff4d6d;margin-bottom:12px}.su{color:#657080;font-size:14px;line-height:1.6}</style></head><body><div class="c"><div class="ic">✗</div><div class="ti">Payment Cancelled</div><div class="su">Please return to the dealer to try again or choose a different payment method.</div></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // ── END Stripe QR Checkout v1 ─────────────────────────────────────────────

    if (url.pathname === '/stripe/create-payment-intent') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      const storeId = requestStoreId(request, url);
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not set in Worker secrets' }, 500);

      try {
        const { amount, currency = 'usd', description = 'Walk-Off Sports Cards' } = await request.json();
        if (!amount || amount < 50) return json({ error: 'Amount must be at least $0.50' }, 400);

        const params = new URLSearchParams({
          amount: String(Math.round(amount)),
          currency,
          description,
          'payment_method_types[]': 'card',
          'metadata[source]': 'LBA Scanner POS',
        });

        const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        const data = await stripeRes.json();
        if (!stripeRes.ok) return json({ error: data.error?.message || 'Stripe error' }, stripeRes.status);
        return json({ clientSecret: data.client_secret, paymentIntentId: data.id });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // JustTCG pricing proxy. Keep JUSTTCG_API_KEY in Worker secrets only.
    if (url.pathname.startsWith('/pricing/justtcg')) {
      const key = env.JUSTTCG_API_KEY;
      if (!key) return json({ ok: false, needsKey: true, source: 'justtcg', error: 'JUSTTCG_API_KEY not set in Worker secrets' }, 501);

      const conditionCode = s => {
        const v = String(s || '').toLowerCase();
        if (/light/.test(v) || v === 'lp') return 'LP';
        if (/moderate/.test(v) || v === 'mp') return 'MP';
        if (/heavy/.test(v) || v === 'hp') return 'HP';
        if (/damage/.test(v) || v === 'dmg') return 'DMG';
        return 'NM';
      };
      const finishCode = s => {
        const v = String(s || 'normal').toLowerCase();
        if (/reverse/.test(v)) return 'reverse_holo';
        if (/etched/.test(v)) return 'etched_foil';
        if (/surge/.test(v)) return 'surge_foil';
        if (/textured/.test(v)) return 'textured_foil';
        if (/holo/.test(v)) return 'holofoil';
        if (/foil/.test(v)) return 'foil';
        if (/first|1st/.test(v)) return 'first_edition';
        if (/unlimited/.test(v)) return 'unlimited';
        return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'normal';
      };
      const justGame = s => {
        const v = String(s || '').toLowerCase();
        if (/magic|mtg/.test(v)) return 'Magic: The Gathering';
        if (/pokemon|pokémon/.test(v)) return 'Pokemon';
        if (/yu|yugioh|yu-gi-oh/.test(v)) return 'Yu-Gi-Oh!';
        if (/lorcana/.test(v)) return 'Lorcana';
        if (/one piece/.test(v)) return 'One Piece';
        return s || '';
      };
      const money = v => Number(String(v ?? '').replace(/[$,]/g, '')) || 0;
      const priceFrom = v => money(v?.price || v?.marketPrice || v?.market_price || v?.averagePrice || v?.avgPrice || v?.tcgplayerMarketPrice || v?.lowPrice || v?.low);
      const normalizeJustVariant = (v, card = {}, i = 0) => {
        const conditionName = v.condition || v.conditionName || v.name || 'Near Mint';
        const finishName = v.printing || v.printingName || v.variant || v.variantName || v.finish || v.finishName || 'Normal';
        const market = priceFrom(v);
        return {
          justtcgVariantId: v.id || v.variantId || v.cardVariantId || '',
          skuId: v.tcgplayerSkuId || v.skuId || v.tcgplayer_sku_id || v.id || `${card.id || card.cardId || 'just'}-${i}`,
          tcgplayerSkuId: v.tcgplayerSkuId || v.skuId || v.tcgplayer_sku_id || '',
          productConditionId: v.productConditionId || v.tcgplayerProductConditionId || '',
          conditionId: Number(v.conditionId || 0) || null,
          condition: conditionCode(conditionName),
          conditionName,
          variantId: Number(v.variantId || 0) || null,
          finish: finishCode(finishName),
          finishName,
          languageId: Number(v.languageId || 0) || null,
          language: v.language || v.languageName || 'English',
          languageName: v.language || v.languageName || 'English',
          printing: finishName,
          marketPrice: market || null,
          lowPrice: money(v.lowPrice || v.minPrice || v.min || v.low) || null,
          midPrice: money(v.midPrice || v.averagePrice || v.avgPrice) || null,
          highPrice: money(v.highPrice || v.maxPrice || v.max) || null,
          recentSoldPrice: money(v.lastSoldPrice || v.recentSoldPrice) || null,
          priceChange7d: Number(v.priceChange7d || v.change7d || v.change_7d || 0) || 0,
          priceChange30d: Number(v.priceChange30d || v.change30d || v.change_30d || 0) || 0,
          priceChange90d: Number(v.priceChange90d || v.change90d || v.change_90d || 0) || 0,
          priceHistory: v.priceHistory || v.history || [],
          lastUpdated: v.lastUpdated || v.updatedAt || v.priceUpdatedAt || null,
          priceSource: market ? 'JustTCG Variant Market' : 'JustTCG Product Estimate',
          priceConfidence: market ? 'high' : 'medium',
        };
      };
      const normalizeJustCard = card => {
        const rawVariants = card.variants || card.printings || card.skus || card.prices || card.conditions || [];
        const variants = Array.isArray(rawVariants)
          ? rawVariants.map((v, i) => normalizeJustVariant(v, card, i)).filter(v => v.finish && v.condition)
          : Object.entries(rawVariants || {}).flatMap(([finish, p], i) => normalizeJustVariant({ ...p, printing: finish }, card, i));
        const selectedVariant = variants.find(v => v.condition === 'NM') || variants[0] || null;
        return {
          productId: card.id || card.cardId || card.justtcgCardId || '',
          justtcgCardId: card.id || card.cardId || '',
          tcgplayerId: card.tcgplayerId || card.tcgplayerProductId || '',
          name: card.name || card.title || '',
          setName: card.setName || card.set || card.groupName || '',
          cardNumber: card.cardNumber || card.number || card.collectorNumber || '',
          category: card.game || card.gameName || card.category || '',
          game: card.game || card.gameName || card.category || '',
          rarity: card.rarity || '',
          imageUrl: card.imageUrl || card.image || card.image_url || card.images?.small || card.images?.large || '',
          productUrl: card.url || card.productUrl || '',
          releaseDate: card.releaseDate || card.releasedAt || '',
          confidenceScore: 86,
          matchReasons: ['JustTCG match'],
          availableVariants: variants,
          selectedVariant,
          priceChange7d: selectedVariant?.priceChange7d || 0,
          priceChange30d: selectedVariant?.priceChange30d || 0,
          priceChange90d: selectedVariant?.priceChange90d || 0,
          priceHistory: selectedVariant?.priceHistory || [],
          raw: card,
        };
      };
      async function justFetch(path, params = {}) {
        const qs = new URLSearchParams(params);
        const res = await fetch('https://api.justtcg.com/v1' + path + (qs.toString() ? '?' + qs.toString() : ''), {
          headers: { 'x-api-key': key, 'Accept': 'application/json' },
        });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
        if (!res.ok) throw new Error(errorMessageFromApi(data, 'JustTCG ' + res.status));
        return data;
      }
      try {
        const searchMatch = url.pathname === '/pricing/justtcg/search';
        const cardMatch = url.pathname.match(/^\/pricing\/justtcg\/card\/([^/]+)$/);
        const productVariantMatch = url.pathname.match(/^\/pricing\/justtcg\/product\/([^/]+)\/(?:variants|sku-prices)$/);
        const tcgplayerMatch = url.pathname.match(/^\/pricing\/justtcg\/tcgplayer\/([^/]+)$/);
        const skuMatch = url.pathname.match(/^\/pricing\/justtcg\/sku\/([^/]+)$/);
        const batchVariantMatch = url.pathname === '/pricing/justtcg/variants/batch';
        let cards = [];
        if (batchVariantMatch) {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          const body = await request.json().catch(() => ({}));
          const ids = Array.isArray(body.cardIds) ? body.cardIds : [];
          const duration = body.priceHistoryDuration || url.searchParams.get('priceHistoryDuration') || '90d';
          const out = [];
          for (const id of ids.slice(0, 10)) {
            const data = await justFetch('/cards/' + encodeURIComponent(id), { priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' })
              .catch(() => justFetch('/cards', { id, cardId: id, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' }));
            const card = Array.isArray(data) ? data[0] : (data.card || data.data?.[0] || data.data || data);
            if (card) out.push(normalizeJustCard(card));
          }
          return json({ ok: true, success: true, source: 'justtcg', matches: out });
        }
        if (searchMatch) {
          const q = (url.searchParams.get('q') || '').trim();
          const category = justGame(url.searchParams.get('category') || url.searchParams.get('game') || '');
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards', { q, name: q, search: q, game: category, limit: 24, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' });
          cards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);
        } else if (cardMatch || productVariantMatch) {
          const id = decodeURIComponent(cardMatch?.[1] || productVariantMatch?.[1]);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards/' + encodeURIComponent(id), { priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' }).catch(() => justFetch('/cards', { id, cardId: id, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' }));
          cards = Array.isArray(data) ? data : [data.card || data.data?.[0] || data.data || data].filter(Boolean);
        } else if (tcgplayerMatch) {
          const tcgplayerId = decodeURIComponent(tcgplayerMatch[1]);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards', { tcgplayerId, tcgplayerProductId: tcgplayerId, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' });
          cards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);
        } else if (skuMatch) {
          const sku = decodeURIComponent(skuMatch[1]);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards', { tcgplayerSkuId: sku, skuId: sku, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' });
          cards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);
        } else {
          return json({ ok: false, error: 'Unknown JustTCG route' }, 404);
        }
        const matches = cards.map(normalizeJustCard).filter(c => c.name);
        if (!matches.length) return json({ ok: false, source: 'justtcg', error: 'No match', matches: [] }, 404);
        if (skuMatch) {
          const sku = decodeURIComponent(skuMatch[1]);
          const card = matches[0];
          const selectedVariant = card.availableVariants.find(v => String(v.skuId) === sku || String(v.tcgplayerSkuId) === sku) || card.selectedVariant;
          return json({ ok: true, success: true, source: 'justtcg', card, selectedVariant, price: selectedVariant?.marketPrice || 0 });
        }
        return json({ ok: true, success: true, source: 'justtcg', matches, selectedVariant: matches[0]?.selectedVariant || null });
      } catch (e) {
        return json({ ok: false, source: 'justtcg', error: e.message }, 500);
      }
    }

    // TCGplayer's public marketplace pricepoints endpoint does not send browser
    // CORS headers, so proxy the small exact-ID response. No TCGplayer credential
    // is required and no listing/customer data is exposed.
    const tcgplayerProductMatch = url.pathname.match(/^\/pricing\/tcgplayer\/product\/(\d+)$/);
    if (tcgplayerProductMatch) {
      const productId = tcgplayerProductMatch[1];
      try {
        const upstream = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints`, {
          headers:{ 'Accept':'application/json' },
          signal:AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
          cf:{ cacheTtl:300, cacheEverything:true },
        });
        if (!upstream.ok) return json({ ok:false, source:'TCGplayer', productId, error:`TCGplayer HTTP ${upstream.status}` }, upstream.status === 404 ? 404 : 502);
        const pricepoints = await upstream.json().catch(() => []);
        const normal = (Array.isArray(pricepoints) ? pricepoints : []).find(row => String(row.printingType || '').toLowerCase() === 'normal') || pricepoints?.[0] || null;
        return json({
          ok:true,
          source:'TCGplayer marketplace pricepoints',
          productId,
          name:String(url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9 &'():.,!+\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
          imageUrl:`https://product-images.tcgplayer.com/fit-in/437x437/${productId}.jpg`,
          productUrl:`https://www.tcgplayer.com/product/${productId}`,
          marketPrice:Number(normal?.marketPrice || 0) || null,
          listedMedianPrice:Number(normal?.listedMedianPrice || 0) || null,
          pricepoints:Array.isArray(pricepoints) ? pricepoints : [],
        });
      } catch (e) {
        return json({ ok:false, source:'TCGplayer', productId, error:/timeout|abort/i.test(String(e?.message || e)) ? 'TCGplayer lookup timed out' : 'TCGplayer lookup failed' }, 502);
      }
    }

    // PriceCharting guide proxy. Token and CSV URLs stay in Worker/KV only.
    if (url.pathname.startsWith('/pricing/pricecharting') || url.pathname.startsWith('/comic/metron/') || url.pathname === '/barcode/lookup') {
      const token = env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY;

      const pennies = v => {
        const n = Number(v);
        return n > 0 ? Math.round(n) / 100 : null;
      };
      const PC_CSV_CATEGORIES = ['Pokemon Cards', 'Magic Cards', 'YuGiOh Cards', 'One Piece Cards', 'Lorcana Cards', 'Digimon Cards', 'Dragon Ball Cards', 'Garbage Pail Cards', 'Marvel Cards', 'Star Wars Cards', 'Other TCG Cards', 'Comics', 'Video Games', 'Funko Pops', 'LEGO Sets', 'Coins', 'Amiibo', 'Strategy Guides', 'Gaming Magazines', 'Sports Cards'];
      const pcCategoryKey = c => {
        const raw = String(c || 'General').trim();
        const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const alias = {
          'pokemon-card':'Pokemon Cards',
          'pokemon-cards':'Pokemon Cards',
          'magic-card':'Magic Cards',
          'magic-cards':'Magic Cards',
          'mtg':'Magic Cards',
          'yugioh-cards':'YuGiOh Cards',
          'yu-gi-oh-cards':'YuGiOh Cards',
          'video-game':'Video Games',
          'video-games':'Video Games',
          'sport-cards':'Sports Cards',
          'sports-cards':'Sports Cards'
        }[slug];
        if (alias) return alias;
        const exact = PC_CSV_CATEGORIES.find(x => x.toLowerCase() === raw.toLowerCase());
        return exact || raw.replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 80) || 'General';
      };
      const kvKey = (kind, category) => `pc_csv_${kind}:${pcCategoryKey(category)}`;
      const chunkKey = (category, cacheVersion, chunkIndex) => `pc_csv_chunk:${pcCategoryKey(category)}:${String(cacheVersion || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80)}:${Number(chunkIndex) || 0}`;
      const manifestKey = category => kvKey('manifest', category);
      const maskPcUrl = raw => {
        try {
          const u = new URL(String(raw || ''));
          ['t','token','api_key','apikey','key'].forEach(k => { if (u.searchParams.has(k)) u.searchParams.set(k, '***'); });
          return u.toString();
        } catch (_) {
          return String(raw || '').replace(/([?&](?:t|token|api_key|apikey|key)=)[^&]+/ig, '$1***');
        }
      };
      const csvState = (category, patch = {}) => ({ category, state: patch.state || 'ready', configured: !!patch.configured, urlMasked: patch.url ? maskPcUrl(patch.url) : undefined, ...patch, url: undefined });
      const mergeCsvMeta = (prior = {}, category, patch = {}) => csvState(category, {
        ...prior,
        ...patch,
        lastSuccessAt: patch.lastSuccessAt || prior?.lastSuccessAt || null,
        lastSyncedAt: patch.lastSyncedAt || prior?.lastSyncedAt || null,
        lastSuccessfulRowCount: patch.lastSuccessfulRowCount ?? prior?.lastSuccessfulRowCount ?? prior?.rowCount ?? 0,
      });
      const csvFetchOptions = () => ({
        headers: { 'Accept': 'text/csv,*/*' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      });
      const pcUrl = path => 'https://www.pricecharting.com' + path;
      const pcImageUrl = p => {
        const raw = p['image-url'] || p.imageUrl || p.image || p.coverUrl || p.thumbnail || p['box-art-url'] || p['image'] || '';
        if (raw) {
          if (/^\/\//.test(raw)) return 'https:' + raw;
          if (/^\//.test(raw)) return 'https://www.pricecharting.com' + raw;
          return raw;
        }
        return '';
      };
      const pcMoney = (p, key, normalizedPath = '') => {
        const fromCsv = pennies(p[key]);
        if (fromCsv !== null && fromCsv !== undefined) return fromCsv;
        const parts = String(normalizedPath || '').split('.').filter(Boolean);
        let cur = p;
        for (const part of parts) cur = cur?.[part];
        const n = Number(cur);
        return n > 0 ? n : null;
      };
      const matchReasonsFor = (p, q) => {
        const reasons = [];
        const hay = [p['product-name'], p['console-name'], p.genre].filter(Boolean).join(' ').toLowerCase();
        String(q || '').toLowerCase().split(/\s+/).filter(Boolean).forEach(t => { if (hay.includes(t)) reasons.push(t); });
        return reasons.length ? reasons.slice(0, 6) : ['PriceCharting search match'];
      };
      const normalizePcProduct = (p, q = '') => ({
        source: 'PriceCharting',
        productId: String(p.id || p.productId || ''),
        productName: p['product-name'] || p.productName || '',
        consoleName: p['console-name'] || p.consoleName || '',
        genre: p.genre || '',
        releaseDate: p['release-date'] || p.releaseDate || null,
        url: p['product-url'] || p.url || (p.id ? `https://www.pricecharting.com/game/${p.id}` : null),
        imageUrl: pcImageUrl(p),
        prices: {
          ungraded: pcMoney(p, 'loose-price', 'prices.ungraded'),
          grade7: pcMoney(p, 'cib-price', 'prices.grade7'),
          grade8: pcMoney(p, 'new-price', 'prices.grade8'),
          grade9: pcMoney(p, 'graded-price', 'prices.grade9'),
          grade9_5: pcMoney(p, 'box-only-price', 'prices.grade9_5'),
          psa10: pcMoney(p, 'manual-only-price', 'prices.psa10'),
          bgs10: pcMoney(p, 'bgs-10-price', 'prices.bgs10'),
          cgc10: pcMoney(p, 'condition-17-price', 'prices.cgc10'),
          sgc10: pcMoney(p, 'condition-18-price', 'prices.sgc10'),
        },
        comicPrices: {
          ungraded: pcMoney(p, 'loose-price', 'comicPrices.ungraded'),
          grade4: pcMoney(p, 'cib-price', 'comicPrices.grade4'),
          grade6: pcMoney(p, 'new-price', 'comicPrices.grade6'),
          grade8: pcMoney(p, 'graded-price', 'comicPrices.grade8'),
          grade9_2: pcMoney(p, 'box-only-price', 'comicPrices.grade9_2'),
          grade9_4: pcMoney(p, 'condition-17-price', 'comicPrices.grade9_4'),
          grade9_8: pcMoney(p, 'manual-only-price', 'comicPrices.grade9_8'),
          grade10: pcMoney(p, 'bgs-10-price', 'comicPrices.grade10'),
        },
        retail: {
          looseBuy: pcMoney(p, 'retail-loose-buy', 'retail.looseBuy'),
          looseSell: pcMoney(p, 'retail-loose-sell', 'retail.looseSell'),
          cibBuy: pcMoney(p, 'retail-cib-buy', 'retail.cibBuy'),
          cibSell: pcMoney(p, 'retail-cib-sell', 'retail.cibSell'),
          newBuy: pcMoney(p, 'retail-new-buy', 'retail.newBuy'),
          newSell: pcMoney(p, 'retail-new-sell', 'retail.newSell'),
        },
        demand: {
          salesVolume: Number(p['sales-volume'] || p.salesVolume || 0) || null,
          genre: p.genre || '',
          consoleName: p['console-name'] || p.consoleName || '',
          releaseDate: p['release-date'] || p.releaseDate || null,
          upc: p.upc || p.UPC || '',
          asin: p.asin || p.ASIN || '',
          epid: p.epid || p.ePID || p.EPID || '',
        },
        videoGame: {
          productName: p['product-name'] || p.productName || '',
          consoleName: p['console-name'] || p.consoleName || '',
          loosePrice: pennies(p['loose-price']),
          cibPrice: pennies(p['cib-price']),
          newPrice: pennies(p['new-price']),
          gradedPrice: pennies(p['graded-price']),
          boxOnlyPrice: pennies(p['box-only-price']),
          manualOnlyPrice: pennies(p['manual-only-price']),
          retailLooseBuy: pennies(p['retail-loose-buy']),
          retailLooseSell: pennies(p['retail-loose-sell']),
          retailCibBuy: pennies(p['retail-cib-buy']),
          retailCibSell: pennies(p['retail-cib-sell']),
          retailNewBuy: pennies(p['retail-new-buy']),
          retailNewSell: pennies(p['retail-new-sell']),
          salesVolume: Number(p['sales-volume'] || p.salesVolume || 0) || null,
          upc: p.upc || p.UPC || '',
          asin: p.asin || p.ASIN || '',
          epid: p.epid || p.ePID || p.EPID || '',
        },
        rawApiPricesPennies: {
          'loose-price': p['loose-price'] ?? null,
          'cib-price': p['cib-price'] ?? null,
          'new-price': p['new-price'] ?? null,
          'graded-price': p['graded-price'] ?? null,
          'box-only-price': p['box-only-price'] ?? null,
          'manual-only-price': p['manual-only-price'] ?? null,
          'bgs-10-price': p['bgs-10-price'] ?? null,
          'condition-17-price': p['condition-17-price'] ?? null,
          'condition-18-price': p['condition-18-price'] ?? null,
          'retail-loose-buy': p['retail-loose-buy'] ?? null,
          'retail-loose-sell': p['retail-loose-sell'] ?? null,
          'retail-cib-buy': p['retail-cib-buy'] ?? null,
          'retail-cib-sell': p['retail-cib-sell'] ?? null,
          'retail-new-buy': p['retail-new-buy'] ?? null,
          'retail-new-sell': p['retail-new-sell'] ?? null,
        },
        lastUpdated: p['updated-at'] || p.updatedAt || null,
        confidence: matchReasonsFor(p, q).length >= 3 ? 'high' : matchReasonsFor(p, q).length >= 1 ? 'medium' : 'low',
        matchReasons: matchReasonsFor(p, q),
        raw: p,
      });
      const gradeKey = (company = 'PSA', grade = '') => {
        const g = String(grade || '').toLowerCase().replace(/^psa|^bgs|^cgc|^sgc/g, '').trim();
        const c = String(company || '').toLowerCase();
        if (c.includes('bgs') && g === '10') return 'bgs10';
        if (c.includes('cgc') && g === '10') return 'cgc10';
        if (c.includes('sgc') && g === '10') return 'sgc10';
        if (g === '10') return 'psa10';
        if (g === '9.5') return 'grade9_5';
        if (g.startsWith('9')) return 'grade9';
        if (g.startsWith('8')) return 'grade8';
        if (g.startsWith('7')) return 'grade7';
        return 'ungraded';
      };
      async function pcFetch(path, params = {}) {
        const qs = new URLSearchParams({ t: token, ...params });
        // In-process rate limiter — no KV needed, good enough per isolate
        const now = Date.now();
        if (_pcLastCall > 0) {
          const wait = Math.max(0, 1100 - (now - _pcLastCall));
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        }
        _pcLastCall = Date.now();
        const res = await fetch(pcUrl(path) + '?' + qs.toString(), { headers: { 'Accept': 'application/json' } });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
        if (!res.ok || data.status === 'error') throw new Error(data['error-message'] || data.error || 'PriceCharting ' + res.status);
        return data;
      }

      const comicPcQuery = issue => [issue.seriesName, issue.number ? '#' + issue.number : '', issue.seriesYearBegan || '', 'Comic Books']
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const isComicPcCandidate = candidate => /^comic books\b/i.test(String(candidate?.consoleName || '').trim());
      const normalizeComicRunText = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const comicPcIdentity = candidate => {
        const productName = String(candidate?.productName || '').trim();
        const issueMatch = productName.match(/#\s*([0-9]+(?:\.[0-9]+)?[a-z]?)(?=\b|\s|\[|\()/i);
        const beforeIssue = issueMatch ? productName.slice(0, issueMatch.index).trim() : '';
        const descriptorMatch = beforeIssue.match(/\s*\[([^\]]+)\]\s*$/);
        const seriesName = descriptorMatch ? beforeIssue.slice(0, descriptorMatch.index).trim() : beforeIssue;
        const explicitYearMatch = productName.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/);
        return {
          series:normalizeComicRunText(seriesName),
          number:String(issueMatch?.[1] || '').toLowerCase(),
          descriptor:String(descriptorMatch?.[1] || '').trim(),
          explicitYear:String(explicitYearMatch?.[1] || ''),
        };
      };
      const matchingComicPcCandidates = (candidates, issue) => {
        const seriesPhrase = normalizeComicRunText(issue.seriesName);
        const number = String(issue.number || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
        const allowedYears = new Set([issue.seriesYearBegan, String(issue.coverDate || '').slice(0, 4), String(issue.storeDate || '').slice(0, 4)].map(String).filter(value => /^(?:19|20)\d{2}$/.test(value)));
        const variantWords = String(issue.issueName || issue.selectedVariant?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length > 2 && !['cover','variant','issue'].includes(word));
        return (candidates || []).filter(isComicPcCandidate).map(candidate => {
          const identity = comicPcIdentity(candidate);
          // PriceCharting title searches often return similarly named 2025 spin-offs
          // for a 1984 run. Require the exact title before the issue marker, the exact
          // issue number, and (when supplied) a year belonging to this Metron issue/run.
          const seriesMatch = !!seriesPhrase && identity.series === seriesPhrase;
          const numberMatch = !!number && (identity.number === number || (/^\d+$/.test(number) && new RegExp(`^${number}[a-z]$`, 'i').test(identity.number)));
          const yearMatch = !identity.explicitYear || !allowedYears.size || allowedYears.has(identity.explicitYear);
          const normalized = normalizeComicRunText(candidate.productName);
          const variantMatches = variantWords.filter(word => normalized.includes(word)).length;
          const score = (seriesMatch ? 80 : 0) + (numberMatch ? 80 : 0) + (yearMatch ? 20 : 0) + (/comic/i.test(candidate.consoleName || '') ? 20 : 0) + variantMatches * 5;
          return { candidate, score, numberMatch, seriesMatch, yearMatch, variantMatches };
        }).filter(match => match.seriesMatch && match.numberMatch && match.yearMatch)
          .sort((a, b) => b.score - a.score).map(match => ({ ...match.candidate, comicMatchScore:match.score }));
      };
      const bestComicPcCandidate = (candidates, issue) => {
        return matchingComicPcCandidates(candidates, issue)[0] || null;
      };
      const pcProductPageUrl = product => {
        const slug = value => String(value || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return product?.productName && product?.consoleName ? `https://www.pricecharting.com/game/${slug(product.consoleName)}/${slug(product.productName)}` : '';
      };
      const hydratePcCoverImage = async product => {
        if (!product) return product;
        const pageUrl = pcProductPageUrl(product);
        if (!pageUrl) return product;
        if (product.imageUrl) return { ...product, url:pageUrl };
        try {
          const pageRes = await fetch(pageUrl, { headers:{ 'User-Agent':'Mozilla/5.0 (compatible; Walk-Off Comic Cover/2026)', 'Accept':'text/html' }, cf:{ cacheTtl:86400, cacheEverything:true } });
          if (!pageRes.ok) return product;
          const html = await pageRes.text();
          const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          const storage = html.match(/https?:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^"']+\/(?:240|300|400|1600)\.jpg/i);
          return { ...product, imageUrl:og?.[1]?.replace(/&amp;/g, '&') || storage?.[0] || '', url:pageUrl };
        } catch (_) { return product; }
      };
      const comicPcCoverDescriptor = (product, issue) => {
        const name = String(product?.productName || '');
        const identity = comicPcIdentity(product);
        const number = String(issue?.number || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let suffix = number ? name.replace(new RegExp(`^.*?#\\s*${number}`, 'i'), '') : name;
        suffix = suffix.replace(/[\[(]\s*(?:19|20)\d{2}\s*[\])]/g, ' ')
          .replace(/\bcomic books?\b/gi, ' ')
          .replace(/^[\s\-:|/]+|[\s\-:|/]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const baseNumber = String(issue?.number || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
        const letteredCover = identity.number !== baseNumber && identity.number.startsWith(baseNumber)
          ? `cover ${identity.number.slice(baseNumber.length)}` : '';
        return normalizeComicRunText([identity.descriptor, letteredCover, suffix].filter(Boolean).join(' '));
      };
      const comicPcCandidates = async (issue, force = false) => {
        if (!token) return [];
        const q = comicPcQuery(issue);
        if (!q) return [];
        const exact = [issue.seriesName, issue.number ? '#' + issue.number : ''].filter(Boolean).join(' ').trim();
        const queries = [...new Set([q, exact && `${exact} variant`, exact && `${exact} foil`, exact && `${exact} virgin`, exact && `${exact} retailer exclusive`].filter(Boolean))];
        const cacheKey = `comic-pricecharting:v8:${queries.join('|').toLowerCase().slice(0, 500)}`;
        if (env.LBA_KV && !force) {
          const cached = await env.LBA_KV.get(cacheKey, 'json').catch(() => null);
          if (Array.isArray(cached)) return cached;
        }
        try {
          const found = new Map();
          // PriceCharting is rate-limited per request. Run these in order so the
          // limiter actually spaces them; Promise.all caused all delayed calls to
          // wake together and usually left only the first cover search alive.
          for (const query of queries) {
            let data = { products:[] };
            try { data = await pcFetch('/api/products', { q:query }); } catch (_) {}
            (data.products || []).map(product => normalizePcProduct(product, query)).forEach(product => {
              const id = String(product.productId || '');
              if (id && !found.has(id)) found.set(id, product);
            });
          }
          const products = [...found.values()].slice(0, 60);
          if (env.LBA_KV) await env.LBA_KV.put(cacheKey, JSON.stringify(products), { expirationTtl:60 * 60 * 6 });
          return products;
        } catch (_) {
          return [];
        }
      };

      if (url.pathname === '/comic/metron/search' && request.method === 'GET') {
        const storeId = requestStoreId(request, url);
        const access = await requireStoreUser(request, env, storeId);
        if (access.error) return access.error;
        const rawQuery = String(url.searchParams.get('q') || '').trim().slice(0, 180);
        const series = String(url.searchParams.get('series') || '').trim().slice(0, 120);
        const seriesId = String(url.searchParams.get('series_id') || '').replace(/\D/g, '').slice(0, 20);
        const number = String(url.searchParams.get('number') || '').trim().slice(0, 30);
        const year = String(url.searchParams.get('year') || '').replace(/\D/g, '').slice(0, 4);
        const publisher = String(url.searchParams.get('publisher') || '').trim().slice(0, 80);
        const upc = String(url.searchParams.get('upc') || '').replace(/\D/g, '').slice(0, 20);
        const sku = String(url.searchParams.get('sku') || '').trim().slice(0, 80);
        const creator = String(url.searchParams.get('creator') || '').trim().slice(0, 120);
        const page = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
        if (!series && !seriesId && !creator && !upc && !sku) return json({ ok:false, error:'Comic series, creator, UPC, or SKU is required' }, 400);
        try {
          if (creator) {
            const creatorResponse = await metronFetch(env, '/creator/', { name:creator }, 60 * 60 * 24 * 7);
            const creators = (Array.isArray(creatorResponse.data) ? creatorResponse.data : (creatorResponse.data?.results || [])).slice(0, 10);
            const exactCreator = creators.find(item => metronName(item).toLowerCase() === creator.toLowerCase()) || creators[0];
            if (!exactCreator?.id) return json({ ok:true, source:'Metron', query:rawQuery, creator, creators:[], issues:[], seriesChoices:[], reason:'No Metron creator matched that name' });
            const issueResponse = await metronFetch(env, '/issue/', { creator_id:exactCreator.id }, 60 * 60 * 24);
            const rawIssues = Array.isArray(issueResponse.data) ? issueResponse.data : (issueResponse.data?.results || []);
            return json({ ok:true, source:'Metron', query:rawQuery, creator:{ id:String(exactCreator.id), name:metronName(exactCreator) }, creators:creators.map(item => ({ id:String(item.id || ''), name:metronName(item) })), cacheStatus:issueResponse.cacheStatus, issues:rawIssues.slice(0, 20).map(normalizeMetronListIssue), seriesChoices:[], priceCandidates:[] });
          }
          let selectedSeries = null;
          let seriesChoices = [];
          if (!upc && !sku && !seriesId) {
            const seriesResponse = await metronFetch(env, '/series/', {
              name:series,
              ...(year ? { year_began:year } : {}),
              ...(publisher ? { publisher_name:publisher } : {}),
            }, 60 * 60 * 24 * 7);
            seriesChoices = (Array.isArray(seriesResponse.data) ? seriesResponse.data : (seriesResponse.data?.results || [])).slice(0, 30).map(normalizeMetronSeries);
            if (seriesChoices.length !== 1) return json({ ok:true, source:'Metron', query:rawQuery, seriesChoices, issues:[], requiresSeriesSelection:seriesChoices.length > 1, reason:seriesChoices.length ? 'Choose the exact series and run' : 'No Metron series matched that title' });
            selectedSeries = seriesChoices[0];
          }
          const selectedSeriesId = seriesId || selectedSeries?.id || '';
          const filters = upc ? { upc } : sku ? { sku } : { series_id:selectedSeriesId, number, page };
          const [initialMetron, selectedSeriesDetail] = await Promise.all([
            metronFetch(env, '/issue/', filters, 60 * 60 * 24),
            selectedSeriesId ? metronFetch(env, `/series/${selectedSeriesId}/`, {}, 60 * 60 * 24 * 7).catch(() => null) : Promise.resolve(null),
          ]);
          let metron = initialMetron;
          if (selectedSeriesDetail?.data) selectedSeries = normalizeMetronSeries(selectedSeriesDetail.data);
          let rawIssues = Array.isArray(metron.data) ? metron.data : (metron.data?.results || []);
          if (upc && !rawIssues.length && upc.length >= 12) {
            metron = await metronFetch(env, '/issue/', { upc_starts_with:upc.slice(0, 13) }, 60 * 60 * 24);
            rawIssues = Array.isArray(metron.data) ? metron.data : (metron.data?.results || []);
          }
          const metronPage = Array.isArray(metron.data) ? {} : (metron.data || {});
          // Metron's paginated response currently omits page_size while returning
          // up to 100 issues. Falling back to 20 invents nonexistent pages (for
          // example, a 150-record run became eight pages instead of two).
          const reportedPageSize = Number(metronPage.page_size || metronPage.pageSize || 0);
          const pageSize = Math.max(1, reportedPageSize || (page === 1 && rawIssues.length ? rawIssues.length : 100));
          const total = Math.max(rawIssues.length, Number(metronPage.count || metronPage.total || selectedSeries?.issueCount || rawIssues.length) || 0);
          const totalPages = Math.max(1, Math.ceil(total / pageSize));
          const pagination = {
            page,
            pageSize,
            total,
            totalPages,
            hasNext:Boolean(metronPage.next) || page < totalPages,
            hasPrevious:Boolean(metronPage.previous) || page > 1,
          };
          const issues = rawIssues.map(normalizeMetronListIssue);
          return json({ ok:true, source:'Metron', query:rawQuery, filters, selectedSeries, seriesChoices, cacheStatus:metron.cacheStatus, issues, pagination, priceCandidates:[] });
        } catch (error) {
          const status = [401,403,429].includes(Number(error.status)) ? Number(error.status) : 502;
          const message = status === 401 || status === 403 ? 'Metron credentials were rejected' : status === 429 ? 'Metron rate limit reached; cached comic records remain available' : 'Metron comic search failed';
          return json({ ok:false, source:'Metron', error:message, retryAfter:error.retryAfter || null }, status, error.retryAfter ? { 'Retry-After':error.retryAfter } : {});
        }
      }

      const metronSeriesPreviewMatch = url.pathname.match(/^\/comic\/metron\/series\/(\d+)\/preview$/);
      if (metronSeriesPreviewMatch && request.method === 'GET') {
        const storeId = requestStoreId(request, url);
        const access = await requireStoreUser(request, env, storeId);
        if (access.error) return access.error;
        try {
          const result = await metronFetch(env, `/series/${metronSeriesPreviewMatch[1]}/issue_list/`, { limit:10 }, 60 * 60 * 24 * 30);
          const rawIssues = Array.isArray(result.data) ? result.data : (result.data?.results || []);
          const preview = rawIssues.map(normalizeMetronListIssue).find(issue => issue.imageUrl) || null;
          return json({ ok:true, source:'Metron', seriesId:metronSeriesPreviewMatch[1], cacheStatus:result.cacheStatus, preview });
        } catch (error) {
          const status = [401,403,404,429].includes(Number(error.status)) ? Number(error.status) : 502;
          return json({ ok:false, source:'Metron', error:status === 429 ? 'Metron preview rate limit reached' : 'Metron series preview unavailable' }, status);
        }
      }

      const metronIssueMatch = url.pathname.match(/^\/comic\/metron\/issue\/(\d+)$/);
      if (metronIssueMatch && request.method === 'GET') {
        const storeId = requestStoreId(request, url);
        const access = await requireStoreUser(request, env, storeId);
        if (access.error) return access.error;
        try {
          const metron = await metronFetch(env, `/issue/${metronIssueMatch[1]}/`, {}, 60 * 60 * 24 * 7);
          let issue = normalizeMetronDetail(metron.data || {});
          const variantKey = String(url.searchParams.get('variant') || '');
          const selectedVariant = variantKey ? issue.variants.find(variant => String(variant.id) === variantKey || String(variant.metronIssueId) === variantKey) : null;
          if (selectedVariant) issue = { ...issue, issueName:selectedVariant.name || issue.issueName, number:selectedVariant.number || issue.number, imageUrl:selectedVariant.imageUrl || issue.imageUrl, sku:selectedVariant.sku || issue.sku, upc:selectedVariant.upc || issue.upc, coverPrice:selectedVariant.coverPrice || issue.coverPrice, selectedVariant };
          const forcePrice = url.searchParams.get('refresh') === '1';
          const linkedPcId = String(url.searchParams.get('pricecharting_id') || '').replace(/\D/g, '').slice(0, 30);
          let linkedPrice = null;
          if (linkedPcId) {
            try {
              const linkedDetail = normalizePcProduct(await pcFetch('/api/product', { id:linkedPcId }), comicPcQuery(issue));
              if (isComicPcCandidate(linkedDetail)) linkedPrice = { ...linkedDetail, savedExactLink:true, comicMatchScore:999 };
            } catch (_) {}
          }
          const [seriesIssues, priceCandidates] = await Promise.all([
            issue.seriesId ? metronExactIssueRecords(env, issue).catch(() => []) : Promise.resolve([]),
            comicPcCandidates(issue, forcePrice),
          ]);
          const rawSeriesIssues = Array.isArray(seriesIssues) ? seriesIssues : [];
          const metronCovers = metronSiblingCovers(issue, rawSeriesIssues);
          const matchedCandidates = matchingComicPcCandidates(priceCandidates, issue);
          const candidateById = new Map();
          if (linkedPrice?.productId) candidateById.set(String(linkedPrice.productId), linkedPrice);
          matchedCandidates.forEach(product => {
            const id = String(product.productId || '');
            if (id && !candidateById.has(id)) candidateById.set(id, product);
          });
          const comicCandidates = [...candidateById.values()].slice(0, 24);
          const pcCovers = await Promise.all(comicCandidates.map(hydratePcCoverImage));
          const pcCoverRows = pcCovers.map(product => ({
            id:`pricecharting:${product.productId}`,
            pricechartingProductId:product.productId,
            issueName:product.productName,
            name:product.productName,
            number:issue.number,
            seriesId:issue.seriesId,
            seriesName:issue.seriesName,
            seriesYearBegan:issue.seriesYearBegan,
            coverDate:issue.coverDate,
            publisher:issue.publisher,
            imageUrl:product.imageUrl,
            pricechartingUrl:product.url,
            pricecharting:product,
            source:'PriceCharting',
            coverDescriptor:comicPcCoverDescriptor(product, issue),
          }));
          // PriceCharting and Metron use different image URLs for the same main
          // cover. Attach the standard PriceCharting price to Metron's main tile
          // instead of rendering a fake second cover.
          const standardPcCover = pcCoverRows.find(cover => !cover.coverDescriptor) || null;
          const mergedMetronCovers = metronCovers.map((cover, index) => index === 0 && standardPcCover ? {
            ...cover,
            pricechartingProductId:standardPcCover.pricechartingProductId,
            pricechartingUrl:standardPcCover.pricechartingUrl,
            pricecharting:standardPcCover.pricecharting,
            source:'Metron + PriceCharting',
          } : cover);
          const separatePcCovers = mergedMetronCovers.length ? pcCoverRows.filter(cover => cover.coverDescriptor) : pcCoverRows;
          const covers = [...mergedMetronCovers, ...separatePcCovers]
            .filter((cover, index, all) => cover.imageUrl && all.findIndex(other => String(other.imageUrl).split('?')[0] === String(cover.imageUrl).split('?')[0]) === index);
          const candidate = comicCandidates[0] || null;
          const runnerUp = comicCandidates[1] || null;
          let priceMatch = linkedPrice || (candidate && (!runnerUp || Number(candidate.comicMatchScore || 0) - Number(runnerUp.comicMatchScore || 0) >= 15) ? candidate : null);
          if (priceMatch?.productId) {
            try {
              const detail = await pcFetch('/api/product', { id:priceMatch.productId });
              const normalizedPriceMatch = normalizePcProduct(detail, comicPcQuery(issue));
              priceMatch = { ...normalizedPriceMatch, url:pcProductPageUrl(normalizedPriceMatch) || normalizedPriceMatch.url, savedExactLink:!!linkedPrice };
            } catch (_) {}
          }
          return json({ ok:true, source:'Metron + PriceCharting', cacheStatus:metron.cacheStatus, issue, covers, priceCandidates:comicCandidates, priceMatch });
        } catch (error) {
          const status = [401,403,404,429].includes(Number(error.status)) ? Number(error.status) : 502;
          const message = status === 401 || status === 403 ? 'Metron credentials were rejected' : status === 429 ? 'Metron rate limit reached; try the cached record again shortly' : status === 404 ? 'Metron issue not found' : 'Metron issue lookup failed';
          return json({ ok:false, source:'Metron', error:message, retryAfter:error.retryAfter || null }, status, error.retryAfter ? { 'Retry-After':error.retryAfter } : {});
        }
      }
      const normalizeBarcodeValue = raw => {
        const original = String(raw ?? '').trim();
        const digits = original.replace(/\D/g, '');
        let primary = digits, supplement = '';
        if (digits.length === 14 || digits.length === 15 || digits.length === 17) { primary = digits.slice(0, 12); supplement = digits.slice(12); }
        else if (digits.length === 18) { primary = digits.slice(0, 13); supplement = digits.slice(13); }
        const upcA = primary.length === 12 ? primary : primary.length === 13 && primary.startsWith('0') ? primary.slice(1) : '';
        const ean13 = primary.length === 13 ? primary : primary.length === 12 ? '0' + primary : '';
        const upcE = primary.length === 8 ? primary : '';
        const candidates = [...new Set([upcA, ean13, upcE, primary].filter(Boolean))];
        return { raw:original, cleaned:digits, primary, upcA, ean13, upcE, supplement, candidates, typeGuess:primary.length===12?'UPC-A':primary.length===13?'EAN-13':primary.length===8?'UPC-E':'unknown', isValidLikely:[8,12,13].includes(primary.length) };
      };
      const barcodeCategory = (product, hint = 'auto') => {
        const text = [product.productName, product.consoleName, product.genre].filter(Boolean).join(' ').toLowerCase();
        if (/\b(booster box|booster bundle|elite trainer box|etb|collector booster|hobby box|blaster|mega box|display box|factory sealed|pack|tin|case)\b/.test(text)) return 'sealed';
        if (/\b(comics?|marvel comics?|dc comics?|image comics?|dark horse|idw|mirage)\b/.test(text)) return 'comics';
        if (/\b(pokemon cards?|pok[eé]mon cards?)\b/.test(text)) return 'pokemon';
        if (/\b(magic cards?|magic the gathering|mtg)\b/.test(text)) return 'mtg';
        if (/\b(sports? cards?|baseball|football|basketball|hockey|soccer|topps|panini|bowman|upper deck)\b/.test(text)) return 'sports';
        return ['comics','pokemon','mtg','sports','sealed','other'].includes(hint) ? hint : 'other';
      };
      const barcodeCandidate = (product, hint, routeType, attemptedCode) => {
        const category = barcodeCategory(product, hint);
        const isComic = category === 'comics';
        const isSealed = category === 'sealed';
        const upc = product.demand?.upc || product.videoGame?.upc || attemptedCode || '';
        return {
          category,
          provider:'pricecharting',
          providerProductId:product.productId || '',
          title:product.productName || 'Unknown product',
          subtitle:[product.consoleName, product.genre, product.releaseDate ? String(product.releaseDate).slice(0,4) : ''].filter(Boolean).join(' / '),
          consoleName:product.consoleName || '', genre:product.genre || '', upc,
          imageUrl:product.imageUrl || '', providerUrl:product.url || '',
          priceSummary:{ raw:product.comicPrices?.ungraded ?? null, graded98:product.comicPrices?.grade9_8 ?? null, ungraded:product.prices?.ungraded ?? null, psa10:product.prices?.psa10 ?? null },
          confidence:routeType === 'confirmed' ? 100 : routeType === 'upc' ? (isSealed ? 96 : isComic ? 82 : 90) : 55,
          matchReason:routeType === 'upc' ? ['Exact UPC response from PriceCharting', isComic ? 'Barcode narrows the issue; cover still requires confirmation' : isSealed ? 'Sealed-product UPC is strong evidence' : 'Confirm product before saving'] : ['PriceCharting candidate search fallback'],
          needsConfirmation:true, needsCoverConfirmation:isComic,
          evidence:{ type:'barcode', routeType, barcode:attemptedCode || upc, supplement:'' },
          raw:{ productId:product.productId || '', productName:product.productName || '', consoleName:product.consoleName || '', genre:product.genre || '', releaseDate:product.releaseDate || null }
        };
      };
      const metronBarcodeCandidate = (issue, attemptedCode, supplement = '') => ({
        category:'comics',
        provider:'metron',
        providerProductId:String(issue.id || ''),
        metronIssueId:String(issue.id || ''),
        title:[issue.seriesName, issue.number ? '#' + issue.number : ''].filter(Boolean).join(' ') || issue.issueName || 'Comic issue',
        subtitle:[issue.publisher, issue.seriesYearBegan ? issue.seriesYearBegan + ' series' : '', issue.issueName].filter(Boolean).join(' / '),
        consoleName:'Comic Books',
        genre:'Comic',
        upc:attemptedCode,
        imageUrl:issue.imageUrl || '',
        providerUrl:issue.resourceUrl || '',
        priceSummary:{ raw:null, graded98:null },
        confidence:98,
        matchReason:['Exact Metron comic barcode match', supplement ? 'Five-digit cover supplement retained for confirmation' : 'Confirm the exact cover before saving'],
        needsConfirmation:true,
        needsCoverConfirmation:true,
        evidence:{ type:'barcode', routeType:'metron-upc', barcode:attemptedCode, supplement },
        raw:issue,
      });

      if (url.pathname === '/barcode/lookup') {
        if (request.method !== 'POST') return json({ status:'error', error:'POST required' }, 405);
        let body = {};
        try { body = await request.json(); } catch (_) { return json({ status:'error', error:'Valid JSON body required' }, 400); }
        const barcode = normalizeBarcodeValue(body.barcode || '');
        const hint = String(body.categoryHint || 'auto').toLowerCase();
        const query = String(body.query || body.titleQuery || '').trim().slice(0, 160);
        if (!barcode.isValidLikely) return json({ status:'error', error:'Barcode must be a likely UPC-A, UPC-E, or EAN-13 value', barcode }, 400);
        if (body.supplement) barcode.supplement = String(body.supplement).replace(/\D/g, '').slice(0, 5);
        const sourceCalls = [], found = [], tried = [];
        if ((hint === 'comics' || hint === 'auto') && env.METRON_USER && env.METRON_PASS) {
          for (const code of barcode.candidates.slice(0, 3)) {
            const fullCode = code + (barcode.supplement || '');
            try {
              let result = await metronFetch(env, '/issue/', { upc:fullCode }, 60 * 60 * 24 * 7);
              let issues = Array.isArray(result.data) ? result.data : (result.data?.results || []);
              if (!issues.length) {
                result = await metronFetch(env, '/issue/', { upc_starts_with:code }, 60 * 60 * 24 * 7);
                issues = Array.isArray(result.data) ? result.data : (result.data?.results || []);
              }
              found.push(...issues.slice(0, 20).map(normalizeMetronListIssue).map(issue => metronBarcodeCandidate(issue, code, barcode.supplement)));
              sourceCalls.push({ provider:'metron', routeType:'upc', barcode:code, success:issues.length > 0 });
              if (issues.length) break;
            } catch (_) { sourceCalls.push({ provider:'metron', routeType:'upc', barcode:code, success:false }); }
          }
        }
        for (const code of token ? barcode.candidates.slice(0, 3) : []) {
          tried.push(code);
          try {
            const data = await pcFetch('/api/product', { upc:code });
            const product = normalizePcProduct(data, code);
            const success = !!product.productId;
            sourceCalls.push({ provider:'pricecharting', routeType:'upc', barcode:code, success });
            if (success) { found.push(barcodeCandidate(product, hint, 'upc', code)); break; }
          } catch (_) { sourceCalls.push({ provider:'pricecharting', routeType:'upc', barcode:code, success:false }); }
        }
        const fallbackQuery = query || (found[0]?.category === 'comics' ? found[0].title : '');
        if (fallbackQuery && (!found.length || found[0]?.confidence < 85)) {
          try {
            const data = await pcFetch('/api/products', { q:fallbackQuery });
            const products = (data.products || []).map(p => normalizePcProduct(p, fallbackQuery));
            const seen = new Set(found.map(candidate => `${candidate.provider}:${candidate.providerProductId}`));
            found.push(...products.filter(p => !seen.has(`pricecharting:${p.productId}`)).slice(0, 20).map(p => barcodeCandidate(p, hint, 'search', barcode.primary)));
            sourceCalls.push({ provider:'pricecharting', routeType:'search', success:products.length > 0 });
          } catch (_) { sourceCalls.push({ provider:'pricecharting', routeType:'search', success:false }); }
        }
        barcode.candidatesTried = tried;
        found.forEach(candidate => { candidate.evidence.supplement = barcode.supplement || ''; });
        return json({ status:'success', barcode, candidates:found, sourceCalls, message:found.length ? (found.length > 1 ? 'Multiple possible matches found' : 'Confirm this product before saving') : (token ? 'No product found by UPC' : 'No Metron match found and PriceCharting is unavailable') });
      }
      function parseCsvLine(line) {
        const out = [];
        let cur = '', quoted = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
            else quoted = !quoted;
          } else if (ch === ',' && !quoted) {
            out.push(cur);
            cur = '';
          } else cur += ch;
        }
        out.push(cur);
        return out;
      }
      function parsePcCsv(text) {
        const src = String(text || '').replace(/^\uFEFF/, '');
        const lines = [];
        let cur = '', quoted = false;
        for (let i = 0; i < src.length; i++) {
          const ch = src[i], next = src[i + 1];
          if (ch === '"' && quoted && next === '"') { cur += '"'; i++; continue; }
          if (ch === '"') { quoted = !quoted; cur += ch; continue; }
          if ((ch === '\n' || ch === '\r') && !quoted) {
            if (cur.trim()) lines.push(cur);
            cur = '';
            if (ch === '\r' && next === '\n') i++;
            continue;
          }
          cur += ch;
        }
        if (cur.trim()) lines.push(cur);
        if (quoted) throw new Error('parse_error: unterminated quoted CSV field');
        if (lines.length < 2) return [];
        const headersRaw = parseCsvLine(lines[0]).map(h => h.trim());
        const canonical = h => String(h || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
        const alias = {
          'product-name':'product-name',
          'product name':'product-name',
          'console-name':'console-name',
          'console name':'console-name',
          'loose-price':'loose-price',
          'loose price':'loose-price',
          'cib-price':'cib-price',
          'cib price':'cib-price',
          'new-price':'new-price',
          'new price':'new-price',
          'graded-price':'graded-price',
          'graded price':'graded-price',
          'image-url':'image-url',
          'image url':'image-url',
          'product-url':'product-url',
          'product url':'product-url'
        };
        const headers = headersRaw.map(h => alias[canonical(h)] || canonical(h));
        if (!headers.includes('product-name') && !headers.includes('id')) throw new Error('parse_error: missing expected PriceCharting headers. Saw: ' + headersRaw.slice(0, 8).join(', '));
        return lines.slice(1).map(line => {
          const vals = parseCsvLine(line);
          const row = {};
          headers.forEach((h, i) => row[h] = vals[i] ?? '');
          return row;
        }).filter(row => row['product-name'] || row.id);
      }
      function csvMatches(rows, q) {
        const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        return (rows || []).map(row => {
          const hay = [
            row['product-name'], row.productName,
            row['console-name'], row.consoleName,
            row.genre, row.upc, row.UPC, row.epid, row.ePID,
            row.productId, row.id
          ].filter(Boolean).join(' ').toLowerCase();
          const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
          return { row, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 25).map(x => normalizePcProduct(x.row, q));
      }
      async function chunkedCsvMatches(category, q) {
        if (!env.LBA_KV) return [];
        const manifest = await env.LBA_KV.get(manifestKey(category), 'json');
        if (!manifest || manifest.syncStatus !== 'complete' || !manifest.cacheVersion || !Number(manifest.totalChunks || 0)) return [];
        const matches = [];
        for (let i = 0; i < Number(manifest.totalChunks || 0); i++) {
          const rows = await env.LBA_KV.get(chunkKey(category, manifest.cacheVersion, i), 'json');
          if (Array.isArray(rows) && rows.length) {
            matches.push(...csvMatches(rows, q).map(m => ({ ...m, csvCategory: pcCategoryKey(category), cacheVersion: manifest.cacheVersion, cachedAt: manifest.lastSuccessfulSync })));
          }
          matches.sort((a, b) => (b.confidence === 'high') - (a.confidence === 'high'));
          if (matches.length >= 75) break;
        }
        return matches.slice(0, 25);
      }
      try {
        if (url.pathname.startsWith('/pricing/pricecharting/csv')) {
          return json({ ok: false, removed: true, error: 'PC CSV KV cache removed. Use /pricing/pricecharting/search for live lookups.' }, 410);
        }
        if (false && url.pathname === '/pricing/pricecharting/csv/status') {
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const categories = PC_CSV_CATEGORIES;
          const status = {};
          for (const cat of categories) {
            const meta = await env.LBA_KV.get(kvKey('meta', cat), 'json');
            const manifest = await env.LBA_KV.get(manifestKey(cat), 'json');
            const savedUrl = await env.LBA_KV.get(kvKey('url', cat));
            const rows = await env.LBA_KV.get(kvKey('rows', cat), 'json');
            const legacyRowCount = Array.isArray(rows) ? rows.length : 0;
            const chunkRowCount = Number(manifest?.cachedRowCount || 0);
            const cacheRowCount = chunkRowCount || legacyRowCount;
            status[cat] = meta ? { ...meta, manifest: manifest || null, cacheRowCount, rowCount: Number(meta.rowCount || cacheRowCount || 0), chunkRowCount, legacyRowCount, cacheKey: manifest?.cacheKey || kvKey('rows', cat) } : { category: cat, state: savedUrl ? (cacheRowCount ? 'synced' : 'ready') : 'not_configured', configured: !!savedUrl, urlPresent: !!savedUrl, urlMasked: savedUrl ? maskPcUrl(savedUrl) : '', rowCount: cacheRowCount, cacheRowCount, chunkRowCount, legacyRowCount, lastAttemptedAt: null, lastSuccessAt: manifest?.lastSuccessfulSync || null, lastSyncedAt: manifest?.lastSuccessfulSync || null, lastError: manifest?.lastError || '', cacheKey: manifest?.cacheKey || kvKey('rows', cat), manifest: manifest || null };
          }
          return json({ ok: true, source: 'PriceCharting CSV', categories: status });
        }
        if (url.pathname === '/pricing/pricecharting/csv/test-url') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const csvUrl = String(body.fullUrl || body.url || '').trim();
          if (!csvUrl) return json({ ok: false, state: 'not_configured', error: 'fullUrl required in POST JSON body' }, 400);
          let parsedUrl;
          try {
            parsedUrl = new URL(csvUrl);
            if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error('invalid protocol');
          } catch (_) {
            return json({ ok: false, state: 'invalid_url', error: 'Invalid CSV URL' }, 400);
          }
          let res;
          try {
            res = await fetch(csvUrl, csvFetchOptions());
          } catch (e) {
            return json({ ok: false, state: 'worker_error', responseType: 'FETCH_FAILED', error: e.name === 'TimeoutError' || /abort/i.test(e.message || '') ? 'CSV fetch timed out before import could start' : (e.message || 'CSV fetch failed'), urlMasked: maskPcUrl(csvUrl) }, 502);
          }
          const contentType = res.headers.get('content-type') || '';
          const text = await res.text();
          const responsePreview = text.slice(0, 200).replace(/([?&](?:t|token|api_key|apikey|key)=)[^&\\s"']+/ig, '$1***');
          if (!res.ok) return json({ ok: false, state: 'fetch_failed', responseStatus: res.status, responseContentType: contentType, error: 'CSV fetch failed ' + res.status + ': ' + responsePreview, urlMasked: maskPcUrl(csvUrl) }, res.status);
          if (/text\/html/i.test(contentType) || /<!doctype html|<html/i.test(text.slice(0, 500))) {
            return json({ ok: false, state: 'HTML_RETURNED', responseType: 'HTML_RETURNED', responseStatus: res.status, responseContentType: contentType, responsePreview, urlMasked: maskPcUrl(csvUrl) }, 422);
          }
          const rows = parsePcCsv(text);
          const normalized = rows.map(r => normalizePcProduct(r)).filter(r => r.productName || r.productId);
          return json({
            ok: true,
            state: 'CSV_RETURNED',
            responseType: 'CSV_RETURNED',
            responseStatus: res.status,
            responseContentType: contentType,
            urlMasked: maskPcUrl(csvUrl),
            detectedCategory: category,
            headers: rows[0] ? Object.keys(rows[0]) : [],
            firstParsedRows: rows.slice(0, 3),
            parsedRowCount: rows.length,
            normalizedRowCount: normalized.length,
            cacheWriteSuccess: false,
            cacheKey: kvKey('rows', category),
          });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/start') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const cacheVersion = String(body.cacheVersion || ('browser-' + Date.now())).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
          const startedAt = new Date().toISOString();
          const incomingUrl = String(body.fullUrl || body.url || '').trim();
          if (incomingUrl) await env.LBA_KV.put(kvKey('url', category), incomingUrl);
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const priorManifest = await env.LBA_KV.get(manifestKey(category), 'json');
          const manifest = {
            ...(priorManifest || {}),
            category,
            cacheVersion,
            syncStatus: 'uploading_chunks',
            sourceType: 'browser_chunked_pricecharting_csv',
            lastAttemptedSync: startedAt,
            lastAttemptedAt: startedAt,
            lastSuccessfulSync: priorManifest?.lastSuccessfulSync || prior?.lastSyncedAt || null,
            cachedRowCount: Number(priorManifest?.cachedRowCount || prior?.rowCount || 0),
            expectedRowCount: Number(body.totalRows || 0),
            rowsPerChunk: Number(body.rowsPerChunk || body.chunkSize || 500),
            totalChunks: Number(body.totalChunks || 0),
            uploadedChunks: [],
            failedChunks: [],
            lastError: '',
            urlMasked: incomingUrl ? maskPcUrl(incomingUrl) : prior?.urlMasked || '',
            cacheKey: `pc_csv_chunk:${category}:${cacheVersion}:*`
          };
          const meta = mergeCsvMeta(prior, category, {
            state: 'uploading_chunks',
            configured: true,
            url: incomingUrl || undefined,
            urlPresent: true,
            rowCount: manifest.cachedRowCount,
            cacheRowCount: manifest.cachedRowCount,
            lastAttemptedAt: startedAt,
            lastError: '',
            source: 'PriceCharting CSV browser chunks',
            cacheKey: manifest.cacheKey,
          });
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(manifest), { expirationTtl: 60 * 60 * 24 * 45 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'uploading_chunks', manifest, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/upload') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const cacheVersion = String(body.cacheVersion || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
          const chunkIndex = Number(body.chunkIndex);
          const rows = Array.isArray(body.rows) ? body.rows : [];
          if (!cacheVersion) return json({ ok: false, error: 'cacheVersion required' }, 400);
          if (!Number.isFinite(chunkIndex) || chunkIndex < 0) return json({ ok: false, error: 'valid chunkIndex required' }, 400);
          if (!rows.length) return json({ ok: false, error: 'rows required' }, 400);
          const manifest = await env.LBA_KV.get(manifestKey(category), 'json') || { category, cacheVersion, uploadedChunks: [] };
          if (manifest.cacheVersion && manifest.cacheVersion !== cacheVersion) return json({ ok: false, error: 'cacheVersion mismatch', activeCacheVersion: manifest.cacheVersion }, 409);
          await env.LBA_KV.put(chunkKey(category, cacheVersion, chunkIndex), JSON.stringify(rows), { expirationTtl: 60 * 60 * 24 * 45 });
          const uploaded = new Set(Array.isArray(manifest.uploadedChunks) ? manifest.uploadedChunks : []);
          uploaded.add(chunkIndex);
          const next = {
            ...manifest,
            category,
            cacheVersion,
            syncStatus: 'uploading_chunks',
            uploadedChunks: [...uploaded].sort((a, b) => a - b),
            uploadedRowCount: Number(manifest.uploadedRowCount || 0) + rows.length,
            totalChunks: Math.max(Number(manifest.totalChunks || 0), Number(body.totalChunks || 0), chunkIndex + 1),
            updatedAt: new Date().toISOString(),
            lastError: ''
          };
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'chunk_uploaded', category, cacheVersion, chunkIndex, rowCount: rows.length, uploadedChunks: next.uploadedChunks.length, manifest: next });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/complete') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const cacheVersion = String(body.cacheVersion || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
          const totalChunks = Number(body.totalChunks || 0);
          const totalRows = Number(body.totalRows || 0);
          const manifest = await env.LBA_KV.get(manifestKey(category), 'json');
          if (!manifest || manifest.cacheVersion !== cacheVersion) return json({ ok: false, error: 'No active chunk upload for cacheVersion' }, 404);
          const uploaded = new Set(Array.isArray(manifest.uploadedChunks) ? manifest.uploadedChunks : []);
          const missing = [];
          for (let i = 0; i < totalChunks; i++) if (!uploaded.has(i)) missing.push(i);
          if (missing.length) return json({ ok: false, state: 'missing_chunks', error: 'Missing chunk uploads', missingChunks: missing.slice(0, 50), manifest }, 409);
          const completedAt = new Date().toISOString();
          const nextManifest = {
            ...manifest,
            syncStatus: 'complete',
            state: 'complete',
            lastSuccessfulSync: completedAt,
            lastSuccessfulSyncAt: completedAt,
            lastSuccessfulRowCount: totalRows,
            cachedRowCount: totalRows,
            totalRows,
            totalChunks,
            priceAgeHours: 0,
            lastError: '',
            cacheKey: `pc_csv_chunk:${category}:${cacheVersion}:*`
          };
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const meta = mergeCsvMeta(prior, category, {
            state: 'complete',
            configured: true,
            urlPresent: true,
            rowCount: totalRows,
            normalizedRowCount: totalRows,
            cacheRowCount: totalRows,
            lastAttemptedAt: manifest.lastAttemptedAt || manifest.lastAttemptedSync || completedAt,
            lastSuccessAt: completedAt,
            lastSyncedAt: completedAt,
            lastSuccessfulRowCount: totalRows,
            lastError: '',
            source: 'PriceCharting CSV browser chunks',
            cacheKey: nextManifest.cacheKey
          });
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(nextManifest), { expirationTtl: 60 * 60 * 24 * 45 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'complete', manifest: nextManifest, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/fail') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const failedAt = new Date().toISOString();
          const priorManifest = await env.LBA_KV.get(manifestKey(category), 'json') || {};
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const error = String(body.error || 'Browser chunk sync failed').slice(0, 500);
          const manifest = { ...priorManifest, syncStatus: 'failed', state: 'failed', lastFailedSync: failedAt, lastError: error, failedChunks: Array.isArray(body.failedChunkIndexes) ? body.failedChunkIndexes.slice(0, 200) : [] };
          const meta = mergeCsvMeta(prior, category, { state: 'failed', configured: true, lastAttemptedAt: failedAt, lastFailedAt: failedAt, lastFailedError: error, lastError: error, rowCount: Number(prior?.rowCount || priorManifest.cachedRowCount || 0), cacheRowCount: Number(prior?.cacheRowCount || priorManifest.cachedRowCount || 0) });
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(manifest), { expirationTtl: 60 * 60 * 24 * 45 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'failed', cachePreserved: true, manifest, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/clear') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const manifest = await env.LBA_KV.get(manifestKey(category), 'json');
          let deletedChunks = 0;
          if (manifest?.cacheVersion && Number(manifest.totalChunks || 0)) {
            for (let i = 0; i < Number(manifest.totalChunks || 0); i++) {
              await env.LBA_KV.delete(chunkKey(category, manifest.cacheVersion, i));
              deletedChunks++;
            }
          }
          await env.LBA_KV.delete(kvKey('rows', category));
          await env.LBA_KV.delete(manifestKey(category));
          const savedUrl = await env.LBA_KV.get(kvKey('url', category));
          const meta = csvState(category, { state: savedUrl ? 'ready' : 'not_configured', configured: !!savedUrl, url: savedUrl || '', urlPresent: !!savedUrl, rowCount: 0, cacheRowCount: 0, lastAttemptedAt: new Date().toISOString(), lastError: '', cacheKey: kvKey('rows', category) });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'cleared', category, deletedChunks, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/sync') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const attemptAt = new Date().toISOString();
          const incomingUrl = String(body.fullUrl || body.url || '').trim();
          if (incomingUrl) {
            try {
              const parsed = new URL(incomingUrl);
              if (!/^https?:$/.test(parsed.protocol)) throw new Error('invalid protocol');
              await env.LBA_KV.put(kvKey('url', category), incomingUrl);
            } catch (_) {
              const meta = csvState(category, { state: 'invalid_url', configured: false, lastAttemptedAt: attemptAt, lastError: 'Invalid CSV URL' });
              await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
              return json({ ok: false, state: 'invalid_url', error: 'Invalid CSV URL', meta }, 400);
            }
          }
          const csvUrl = incomingUrl || await env.LBA_KV.get(kvKey('url', category));
          if (!csvUrl) {
            const meta = csvState(category, { state: 'not_configured', configured: false, lastAttemptedAt: attemptAt, lastError: 'CSV URL required first sync' });
            return json({ ok: false, state: 'not_configured', error: 'CSV URL required first sync', meta }, 400);
          }
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const looksLikeHugeDownload = /price-guide\/download-custom/i.test(csvUrl);
          if (looksLikeHugeDownload && body.blockingImport !== true) {
            const rows = await env.LBA_KV.get(kvKey('rows', category), 'json');
            const preservedRows = Array.isArray(rows) ? rows.length : Number(prior?.rowCount || 0);
            const meta = mergeCsvMeta(prior, category, {
              state: 'TIMEOUT_TOO_LARGE',
              configured: true,
              url: csvUrl,
              urlPresent: true,
              rowCount: preservedRows,
              cacheRowCount: preservedRows,
              lastAttemptedAt: attemptAt,
              lastFailedAt: attemptAt,
              lastFailedError: 'TIMEOUT_TOO_LARGE: PriceCharting download-custom CSV is too large for one Worker request. Existing cache was preserved. Use Test URL for validation and a future chunk/background importer for full refresh.',
              lastError: 'TIMEOUT_TOO_LARGE: PriceCharting download-custom CSV is too large for one Worker request. Existing cache was preserved.',
              cacheKey: kvKey('rows', category)
            });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({
              ok: false,
              state: 'TIMEOUT_TOO_LARGE',
              error: meta.lastError,
              cachePreserved: true,
              preservedRowCount: preservedRows,
              meta
            }, 413);
          }
          const now = Date.now();
          if (prior?.lastSyncedAt && now - Date.parse(prior.lastSyncedAt) < 10 * 60 * 1000) {
            const retryAt = new Date(Date.parse(prior.lastSyncedAt) + 10 * 60 * 1000).toISOString();
            const meta = { ...prior, state: 'rate_limited', lastAttemptedAt: attemptAt, retryAt };
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: true, skipped: true, state: 'rate_limited', reason: 'PriceCharting CSV limit: wait 10 minutes between CSV calls', retryAt, meta });
          }
          if (!body.force && prior?.lastSyncedAt && new Date(prior.lastSyncedAt).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) {
            return json({ ok: true, skipped: true, reason: 'Already synced today', meta: prior });
          }
          let res, text = '';
          const fetchStartedMeta = mergeCsvMeta(prior, category, { state: 'fetch_started', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastError: '' });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(fetchStartedMeta), { expirationTtl: 60 * 60 * 24 * 30 });
          try {
            res = await fetch(csvUrl, csvFetchOptions());
            const downloadedMeta = mergeCsvMeta(fetchStartedMeta, category, { state: 'downloaded', configured: true, url: csvUrl, lastAttemptedAt: attemptAt });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(downloadedMeta), { expirationTtl: 60 * 60 * 24 * 30 });
            text = await res.text();
          } catch (e) {
            const timeout = e.name === 'TimeoutError' || /abort|timeout/i.test(e.message || '');
            const meta = mergeCsvMeta(prior, category, {
              state: timeout ? 'TIMEOUT_TOO_LARGE' : 'failed',
              configured: true,
              url: csvUrl,
              lastAttemptedAt: attemptAt,
              lastFailedAt: attemptAt,
              lastFailedError: timeout ? 'TIMEOUT_TOO_LARGE: CSV is too large to download/import in one Worker request. Existing cache was preserved.' : (e.message || 'Worker fetch failed'),
              lastError: timeout ? 'TIMEOUT_TOO_LARGE: CSV is too large to download/import in one Worker request. Existing cache was preserved.' : (e.message || 'Worker fetch failed')
            });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: meta.state, error: meta.lastError, cachePreserved: true, meta }, timeout ? 413 : 502);
          }
          if (!res.ok) {
            const state = res.status === 401 || res.status === 403 ? 'auth_error' : res.status === 429 ? 'rate_limited' : 'worker_error';
            const meta = mergeCsvMeta(prior, category, { state, configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: 'CSV fetch failed ' + res.status + ': ' + text.slice(0, 120), lastError: 'CSV fetch failed ' + res.status + ': ' + text.slice(0, 120) });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state, error: meta.lastError, cachePreserved: true, meta }, res.status);
          }
          const contentType = res.headers.get('content-type') || '';
          const responsePreview = text.slice(0, 200).replace(/([?&](?:t|token|api_key|apikey|key)=)[^&\\s"']+/ig, '$1***');
          if (/text\/html/i.test(contentType) || /<!doctype html|<html/i.test(text.slice(0, 500))) {
            const meta = mergeCsvMeta(prior, category, { state: 'HTML_RETURNED', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: 'HTML_RETURNED: PriceCharting returned an HTML page instead of CSV', lastError: 'HTML_RETURNED: PriceCharting returned an HTML page instead of CSV', responseStatus: res.status, responseContentType: contentType, responsePreview });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: 'HTML_RETURNED', responseType: 'HTML_RETURNED', responseStatus: res.status, responseContentType: contentType, responsePreview, error: meta.lastError, cachePreserved: true, meta }, 422);
          }
          let rows;
          try {
            const parsingMeta = mergeCsvMeta(prior, category, { state: 'parsing', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, responseStatus: res.status, responseContentType: contentType });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(parsingMeta), { expirationTtl: 60 * 60 * 24 * 30 });
            rows = parsePcCsv(text).slice(0, 50000);
          } catch (e) {
            const meta = mergeCsvMeta(prior, category, { state: 'parse_error', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: e.message || 'Malformed CSV', lastError: e.message || 'Malformed CSV' });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: 'parse_error', error: meta.lastError, cachePreserved: true, meta }, 422);
          }
          if (!rows.length) {
            const meta = mergeCsvMeta(prior, category, { state: 'empty_csv', configured: true, url: csvUrl, rowCount: 0, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: 'CSV parsed but contained no product rows', lastError: 'CSV parsed but contained no product rows' });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: 'empty_csv', error: meta.lastError, cachePreserved: true, meta }, 422);
          }
          const normalizedRowCount = rows.map(r => normalizePcProduct(r)).filter(r => r.productName || r.productId).length;
          const writingMeta = mergeCsvMeta(prior, category, { state: 'writing_cache', configured: true, url: csvUrl, urlPresent: true, rowCount: rows.length, normalizedRowCount, lastAttemptedAt: attemptAt, responseStatus: res.status, responseContentType: contentType });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(writingMeta), { expirationTtl: 60 * 60 * 24 * 30 });
          const meta = csvState(category, { state: 'complete', configured: true, url: csvUrl, urlPresent: true, rowCount: rows.length, normalizedRowCount, cacheRowCount: rows.length, lastAttemptedAt: attemptAt, lastSuccessAt: new Date(now).toISOString(), lastSyncedAt: new Date(now).toISOString(), lastSuccessfulRowCount: rows.length, lastError: '', lastFailedAt: prior?.lastFailedAt || null, lastFailedError: prior?.lastFailedError || '', source: 'PriceCharting CSV', sample: rows[0], responseStatus: res.status, responseContentType: contentType, cacheKey: kvKey('rows', category) });
          await env.LBA_KV.put(kvKey('rows', category), JSON.stringify(rows), { expirationTtl: 60 * 60 * 24 * 14 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
          return json({ ok: true, state: 'synced', responseType: 'CSV_RETURNED', responseStatus: res.status, responseContentType: contentType, parsedRowCount: rows.length, normalizedRowCount, cacheWriteSuccess: true, cacheKey: kvKey('rows', category), headers: rows[0] ? Object.keys(rows[0]) : [], firstParsedRows: rows.slice(0, 3), meta, sample: rows[0] });
        }
        if (url.pathname === '/pricing/pricecharting/csv/search') {
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const q = (url.searchParams.get('q') || '').trim();
          const category = url.searchParams.get('category') || '';
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          const cats = category ? [pcCategoryKey(category)] : PC_CSV_CATEGORIES;
          const matches = [];
          for (const cat of cats) {
            const rows = await env.LBA_KV.get(kvKey('rows', cat), 'json');
            if (Array.isArray(rows)) matches.push(...csvMatches(rows, q).map(m => ({ ...m, csvCategory: cat })));
            matches.push(...await chunkedCsvMatches(cat, q));
          }
          return json({ ok: true, source: 'PriceCharting CSV', query: q, matches: matches.slice(0, 25), products: matches.slice(0, 25) });
        }
        if (!token) return json({ ok: false, needsKey: true, source: 'PriceCharting', error: 'PRICECHARTING_TOKEN not set in Worker secrets' }, 501);
        if (url.pathname === '/pricing/pricecharting/comic-sweep' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const queries = [...new Set((Array.isArray(body.queries) ? body.queries : []).map(q => String(q || '').replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean))].slice(0, 10);
          const exactIssue = body.exactIssue && typeof body.exactIssue === 'object' ? {
            seriesName:String(body.exactIssue.seriesName || '').trim().slice(0, 160),
            number:String(body.exactIssue.number || '').trim().slice(0, 20),
            seriesYearBegan:String(body.exactIssue.seriesYearBegan || '').trim().slice(0, 10),
            coverDate:String(body.exactIssue.coverDate || '').trim().slice(0, 20),
            storeDate:String(body.exactIssue.storeDate || '').trim().slice(0, 20),
          } : null;
          if (!queries.length) return json({ ok: false, error: 'queries required' }, 400);
          const found = new Map();
          const attempts = [];
          for (const q of queries) {
            let products = [];
            try {
              const data = await pcFetch('/api/products', { q });
              products = (data.products || []).map(p => normalizePcProduct(p, q));
            } catch (_) {}
            attempts.push({ query:q, resultCount:products.length });
            products.forEach(product => {
              const id = String(product.productId || '');
              if (!id) return;
              const prior = found.get(id);
              if (prior) prior.foundByQueries = [...new Set([...(prior.foundByQueries || []), q])];
              else found.set(id, { ...product, foundByQueries:[q] });
            });
          }
          const products = exactIssue?.seriesName && exactIssue?.number ? matchingComicPcCandidates([...found.values()], exactIssue) : [...found.values()];
          return json({ ok:true, source:'PriceCharting', endpoint:'/api/products', attempts, exactFiltered:Boolean(exactIssue?.seriesName && exactIssue?.number), products, matches:products });
        }
        if (url.pathname === '/pricing/pricecharting/search') {
          const q = (url.searchParams.get('q') || '').trim();
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          // Forward console filter to PriceCharting so category-specific searches work
          const consoleFilter = url.searchParams.get('console') || url.searchParams.get('category') || '';
          const apiParams = { q };
          if (consoleFilter) apiParams['console'] = consoleFilter;
          let products = [];
          try {
            const data = await pcFetch('/api/products', apiParams);
            products = (data.products || []).map(p => normalizePcProduct(p, q));
          } catch (_) {
            // PC API error (rate-limit, bad query, etc.) — return empty rather than 500
          }
          return json({ ok: true, source: 'PriceCharting', query: q, products, matches: products });
        }
        const productMatch = url.pathname.match(/^\/pricing\/pricecharting\/product\/([^/]+)$/);
        if (productMatch) {
          const data = await pcFetch('/api/product', { id: decodeURIComponent(productMatch[1]) });
          const product = normalizePcProduct(data, data['product-name'] || '');
          const slug = value => String(value || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          if (product.productName && product.consoleName) product.url = `https://www.pricecharting.com/game/${slug(product.consoleName)}/${slug(product.productName)}`;
          if (!product.imageUrl && product.productName && product.consoleName) {
            try {
              const pageRes = await fetch(`https://www.pricecharting.com/game/${slug(product.consoleName)}/${slug(product.productName)}`, {
                headers:{ 'User-Agent':'Mozilla/5.0 (compatible; Walk-Off Catalog Image/2026)', 'Accept':'text/html' },
                cf:{ cacheTtl:7200, cacheEverything:true },
              });
              if (pageRes.ok) {
                const html = await pageRes.text();
                const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
                const storage = html.match(/https?:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^"']+\/(?:240|300|400|1600)\.jpg/i);
                product.imageUrl = og?.[1]?.replace(/&amp;/g, '&') || storage?.[0] || '';
              }
            } catch (_) {}
          }
          return json({ ok: true, source: 'PriceCharting', product, ...product });
        }
        if (url.pathname === '/pricing/pricecharting/slab-prices') {
          const q = [url.searchParams.get('q'), url.searchParams.get('setName'), url.searchParams.get('cardNumber') ? '#' + url.searchParams.get('cardNumber') : ''].filter(Boolean).join(' ').trim();
          const company = url.searchParams.get('company') || 'PSA';
          const grade = url.searchParams.get('grade') || '10';
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          const data = await pcFetch('/api/products', { q });
          const first = (data.products || [])[0];
          if (!first) return json({ ok: false, source: 'PriceCharting', error: 'No match', matches: [] }, 404);
          const productData = await pcFetch('/api/product', { id: first.id });
          const product = normalizePcProduct(productData, q);
          const selectedKey = gradeKey(company, grade);
          return json({
            ok: true,
            source: 'PriceCharting',
            query: q,
            company,
            grade,
            selectedKey,
            selectedValue: product.prices[selectedKey] || null,
            product,
            matches: [product],
            note: 'PriceCharting values are grade-bucket guide values, not exact sold comps.',
          });
        }
        return json({ ok: false, error: 'Unknown PriceCharting route' }, 404);
      } catch (e) {
        return json({ ok: false, source: 'PriceCharting', error: e.message }, 500);
      }
    }

    if (url.pathname === '/pricing/tcg/resolve-product') {
      const params = new URLSearchParams({
        q: url.searchParams.get('query') || url.searchParams.get('q') || '',
        category: url.searchParams.get('category') || '',
        include_variants: 'true',
        include_price_history: 'true'
      });
      const upstream = await fetch(new URL('/pricing/justtcg/search?' + params.toString(), url.origin), { headers: request.headers });
      return new Response(upstream.body, upstream);
    }
    if (url.pathname === '/pricing/tcg/product-variants') {
      const productId = url.searchParams.get('productId') || '';
      if (!productId) return json({ ok: false, error: 'productId required' }, 400);
      const params = new URLSearchParams({ include_variants: 'true', include_price_history: 'true', priceHistoryDuration: url.searchParams.get('priceHistoryDuration') || '90d' });
      const upstream = await fetch(new URL('/pricing/justtcg/card/' + encodeURIComponent(productId) + '?' + params.toString(), url.origin), { headers: request.headers });
      const data = await upstream.json().catch(() => ({}));
      const card = data.card || data.matches?.[0] || null;
      return json({ ok: upstream.ok && !!card, source: 'JustTCG', productId, variantMatrix: card ? { productId: card.productId || productId, source: 'JustTCG', name: card.name || '', setName: card.setName || '', cardNumber: card.cardNumber || '', variants: card.availableVariants || [] } : null, card, error: data.error || '' }, upstream.status);
    }
    if (url.pathname === '/pricing/tcg/sku-price') {
      const skuId = url.searchParams.get('skuId') || '';
      if (!skuId) return json({ ok: false, error: 'skuId required' }, 400);
      const upstream = await fetch(new URL('/pricing/justtcg/sku/' + encodeURIComponent(skuId), url.origin), { headers: request.headers });
      return new Response(upstream.body, upstream);
    }

    // GET /pricing/pokemon/export?type=cards|sealed|ebay|population
    // Business-tier bulk export — decompresses gzip, returns CSV text
    if (url.pathname === '/pricing/pokemon/export' && request.method === 'GET') {
      const type = url.searchParams.get('type') || 'cards';
      const validTypes = ['cards', 'sealed', 'ebay', 'population'];
      if (!validTypes.includes(type)) {
        return json({ ok: false, error: 'Invalid type. Use: ' + validTypes.join(', ') }, 400);
      }
      const apiKey = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
      if (!apiKey) return json({ ok: false, error: 'POKEMONPRICE_API_KEY not configured' }, 501);

      // Pass E bypass still applies — check subscription unless demo/bypass
      const pptStoreId2 = request.headers.get('X-Store-Id') || '';
      const isDemo2 = !pptStoreId2 || pptStoreId2.startsWith('demo');
      const bypassIds2 = (env.BYPASS_STORE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const ownerIds2 = (env.OWNER_STORE_IDS || env.OWNER_STORE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!isDemo2 && !bypassIds2.includes(pptStoreId2) && !ownerIds2.includes(pptStoreId2) && env.LBA_KV) {
        const subRaw2 = await env.LBA_KV.get(`sub:store:${pptStoreId2}`);
        const sub2 = subRaw2 ? JSON.parse(subRaw2) : null;
        const s2 = sub2?.status || 'none';
        const endMs2 = s2 === 'trialing' ? sub2?.trial_end : sub2?.current_period_end;
        if (!((s2 === 'active' || s2 === 'trialing') && (!endMs2 || endMs2 > Date.now()))) {
          return json({ ok: false, error: 'Subscription required.', subscriptionRequired: true, status: s2 }, 402);
        }
      }

      let upRes;
      try {
        upRes = await fetch(`https://www.pokemonpricetracker.com/api/v2/export?type=${type}`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'text/csv, application/gzip, */*' },
          redirect: 'follow',
        });
      } catch (e) {
        return json({ ok: false, error: 'Export request failed: ' + e.message }, 502);
      }

      if (upRes.status === 403) return json({ ok: false, error: 'Business plan required for bulk exports. Upgrade at pokemonpricetracker.com', businessRequired: true }, 403);
      if (upRes.status === 429) return json({ ok: false, error: 'Daily export limit reached (2 per day). Resets at 6:00 AM UTC.', limitReached: true }, 429);
      if (upRes.status === 503 || upRes.status === 404) return json({ ok: false, error: 'Export not yet available — dumps regenerate daily at 6:00 AM UTC.', notReady: true }, 503);
      if (!upRes.ok) return json({ ok: false, error: 'Export failed: HTTP ' + upRes.status }, upRes.status);

      const generatedAt = upRes.headers.get('x-generated-at') || upRes.headers.get('last-modified') || '';
      const downloadsRemaining = upRes.headers.get('x-downloads-remaining') || '';
      const resetAt = upRes.headers.get('x-reset-at') || '';
      const contentType = upRes.headers.get('content-type') || '';
      const contentEncoding = upRes.headers.get('content-encoding') || '';
      const isGzip = contentEncoding.includes('gzip') || contentType.includes('gzip') || upRes.url.endsWith('.gz');

      let csvText;
      try {
        if (isGzip) {
          const ds = new DecompressionStream('gzip');
          const decompressed = upRes.body.pipeThrough(ds);
          csvText = await new Response(decompressed).text();
        } else {
          csvText = await upRes.text();
        }
      } catch (e) {
        return json({ ok: false, error: 'Decompression failed: ' + e.message }, 500);
      }

      const rowCount = Math.max(0, csvText.split('\n').length - 2); // minus header + trailing newline
      return new Response(csvText, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'X-Generated-At': generatedAt,
          'X-Downloads-Remaining': downloadsRemaining,
          'X-Reset-At': resetAt,
          'X-Row-Count': String(rowCount),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Generated-At,X-Downloads-Remaining,X-Reset-At,X-Row-Count',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname.startsWith('/pricing/pokemonpricetracker/') || url.pathname.startsWith('/pricing/pokemon/')) {
      // Docs: docs/api/pokemon-price-tracker-openapi.json
      // Clean aliases: /pricing/pokemon/* → canonical /pricing/pokemonpricetracker/*
      const pptPath = url.pathname.startsWith('/pricing/pokemon/') && !url.pathname.startsWith('/pricing/pokemonpricetracker/')
        ? url.pathname.replace('/pricing/pokemon/', '/pricing/pokemonpricetracker/')
        : url.pathname;
      const key = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
      if (!key) return json({ ok: false, source: 'pokemonpricetracker', error: 'POKEMONPRICE_API_KEY not configured' }, 501);

      // Pass E: subscription gate + daily usage counter
      const pptStoreId = request.headers.get('X-Store-Id') || '';
      const isDemo = !pptStoreId || pptStoreId.startsWith('demo');
      const bypassIds = (env.BYPASS_STORE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const ownerIds = (env.OWNER_STORE_IDS || env.OWNER_STORE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isBypassed = bypassIds.includes(pptStoreId) || ownerIds.includes(pptStoreId);
      if (!isDemo && !isBypassed && env.LBA_KV) {
        const pptAuth = await requireStoreUser(request, env, pptStoreId);
        if (pptAuth.error) return pptAuth.error;
        const subRaw = await env.LBA_KV.get(`sub:store:${pptStoreId}`);
        const sub = subRaw ? JSON.parse(subRaw) : null;
        const subStatus = sub?.status || 'none';
        const endMs = subStatus === 'trialing' ? sub?.trial_end : sub?.current_period_end;
        const subActive = await storeHasSubscriptionAccess(env, pptStoreId, sub);
        if (!subActive) {
          return json({
            ok: false,
            source: 'pokemonpricetracker',
            error: 'Subscription required — start your free trial or subscribe to use Pokemon price lookups.',
            subscriptionRequired: true,
            status: subStatus,
          }, 402);
        }
      }

      const routeMap = {
        '/pricing/pokemonpricetracker/cards': { upstream:'/cards', method:'GET', requiredAny:['tcgPlayerId','cardId','search','setId','set','setName'] },
        '/pricing/pokemonpricetracker/sets': { upstream:'/sets', method:'GET', requiredAny:[] },
        '/pricing/pokemonpricetracker/sealed-products': { upstream:'/sealed-products', method:'GET', requiredAny:[] },
        '/pricing/pokemonpricetracker/parse-title': { upstream:'/parse-title', method:'POST', requiredAny:[] },
        '/pricing/pokemonpricetracker/population': { upstream:'/population', method:'GET', requiredAny:[] },
      };
      const spec = routeMap[pptPath];
      if (!spec) return json({ ok: false, source: 'pokemonpricetracker', error: 'Unknown PokemonPriceTracker route' }, 404);
      if (request.method !== spec.method) return json({ ok: false, source: 'pokemonpricetracker', error: spec.method + ' only' }, 405);
      const params = new URLSearchParams();
      const allowed = ['language', 'tcgPlayerId', 'cardId', 'setId', 'set', 'setName', 'search', 'rarity', 'cardType', 'artist', 'minPrice', 'maxPrice', 'printing', 'condition', 'includeHistory', 'includeEbay', 'includeBoth', 'includePopulation', 'days', 'maxDataPoints', 'fetchAllInSet', 'sortBy', 'sortOrder', 'limit', 'offset', 'name'];
      for (const name of allowed) {
        const value = url.searchParams.get(name);
        if (value != null && value !== '') params.set(name, value);
      }
      if (spec.requiredAny?.length && !spec.requiredAny.some(name => params.get(name))) {
        return json({ ok: false, source: 'pokemonpricetracker', error: spec.requiredAny.join(', ') + ' required' }, 400);
      }
      if (!params.get('language')) params.set('language', 'english');
      if (pptPath === '/pricing/pokemonpricetracker/cards') {
        const exactLookup = !!(params.get('tcgPlayerId') || params.get('cardId'));
        const isFetchAll = String(params.get('fetchAllInSet') || '').toLowerCase() === 'true';
        const isNameSearch = !!params.get('search') && !exactLookup && !isFetchAll;
        const requestedLimit = Number(params.get('limit') || (exactLookup ? 1 : isFetchAll ? 300 : isNameSearch ? 50 : 20));
        params.set('limit', String(exactLookup ? 1 : isFetchAll ? Math.min(500, requestedLimit || 300) : isNameSearch ? Math.min(50, Math.max(1, requestedLimit || 50)) : Math.min(20, Math.max(1, requestedLimit || 20))));
        if (String(params.get('fetchAllInSet') || '').toLowerCase() === 'true') {
          const hasSetFilter = !!(params.get('set') || params.get('setName') || params.get('setId'));
          if (!hasSetFilter) return json({ ok: false, source: 'pokemonpricetracker', error: 'fetchAllInSet requires set, setName, or setId param.' }, 400);
        }
      }
      const bodyText = spec.method === 'POST' ? await request.text() : '';
      const stableKeySource = spec.method + ':' + spec.upstream + '?' + [...params.entries()].sort((a,b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1]))).map(([k,v]) => k + '=' + v).join('&') + ':' + bodyText;
      const cacheKey = pptPath === '/pricing/pokemonpricetracker/cards' && (params.get('tcgPlayerId') || params.get('cardId'))
        ? 'pokemon:' + (params.get('tcgPlayerId') || params.get('cardId'))
        : pptPath === '/pricing/pokemonpricetracker/sealed-products' && params.get('tcgPlayerId')
        ? 'pokemon:sealed:' + params.get('tcgPlayerId')
        : pptPath === '/pricing/pokemonpricetracker/cards' && params.get('search')
        ? 'ppt_search:' + md5Hex(new TextEncoder().encode(String(params.get('language') || 'english').toLowerCase() + ':' + String(params.get('search') || '').trim().toLowerCase().replace(/\s+/g, ' ')))
        : pptPath === '/pricing/pokemonpricetracker/parse-title'
        ? 'ppt_parse:' + md5Hex(new TextEncoder().encode(String(bodyText || '').trim().toLowerCase().replace(/\s+/g, ' ')))
        : 'ppt_api_cache:' + btoa(stableKeySource).replace(/=+$/,'').slice(0, 180);
      if (env.LBA_KV && (spec.method === 'GET' || pptPath === '/pricing/pokemonpricetracker/parse-title') && url.searchParams.get('fresh') !== 'true') {
        const cached = await env.LBA_KV.get(cacheKey, 'json').catch(() => null);
        if (cached) return json({ ...cached, cache:{ state:'hit', source:'worker-kv', cacheKey, cachedAt:cached.cache?.cachedAt || null } });
      }
      if (env.LBA_KV) {
        // v2 deliberately ignores the legacy ppt_quota_exhausted_until key:
        // older code poisoned it for every transient HTTP 429.
        const quotaUntil = Number(await env.LBA_KV.get('ppt_daily_quota_exhausted_until_v2').catch(() => null) || 0);
        if (quotaUntil && Date.now() < quotaUntil) {
          const stale = await env.LBA_KV.get(cacheKey, 'json').catch(() => null);
          if (stale) return json({ ...stale, providerQuotaState:'exhausted', retryAt:new Date(quotaUntil).toISOString(), cache:{ state:'stale', source:'worker-kv', cacheKey, cachedAt:stale.cache?.cachedAt || null } });
          return json({ ok: false, source: 'pokemonpricetracker', error: 'PokemonPriceTracker quota exhausted', providerStatus: 429, providerQuotaState: 'exhausted', retryAt: new Date(quotaUntil).toISOString() }, 429);
        }
        const rateLimitUntil = Number(await env.LBA_KV.get('ppt_rate_limited_until_v2').catch(() => null) || 0);
        if (rateLimitUntil && Date.now() < rateLimitUntil) {
          const stale = await env.LBA_KV.get(cacheKey, 'json').catch(() => null);
          if (stale) return json({ ...stale, providerQuotaState:'rate_limited', retryAt:new Date(rateLimitUntil).toISOString(), cache:{ state:'stale', source:'worker-kv', cacheKey, cachedAt:stale.cache?.cachedAt || null } });
          return json({ ok:false, source:'pokemonpricetracker', error:'PokemonPriceTracker is temporarily rate limited', providerStatus:429, providerQuotaState:'rate_limited', retryAt:new Date(rateLimitUntil).toISOString() }, 429);
        }
      }
      const upstreamUrl = 'https://www.pokemonpricetracker.com/api/v2' + spec.upstream + (params.toString() ? '?' + params.toString() : '');
      const upstream = await fetch(upstreamUrl, {
        method: spec.method,
        headers: {
          'Authorization': 'Bearer ' + key,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: spec.method === 'POST' ? bodyText : undefined,
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
      const cards = Array.isArray(data?.data) ? data.data
        : (data?.data && typeof data.data === 'object') ? [data.data]
        : Array.isArray(data?.cards) ? data.cards
        : Array.isArray(data?.results) ? data.results
        : data?.card ? [data.card]
        : [];
      if (!upstream.ok) {
        const providerMessage = errorMessageFromApi(data, 'PokemonPriceTracker API ' + upstream.status);
        const dailyRemainingRaw = upstream.headers.get('X-RateLimit-Daily-Remaining');
        const dailyRemaining = dailyRemainingRaw == null || dailyRemainingRaw === '' ? null : Number(dailyRemainingRaw);
        const dailyQuotaBlocked = (Number.isFinite(dailyRemaining) && dailyRemaining <= 0)
          || /daily.{0,20}(quota|credit).{0,20}(exhaust|limit)|(?:quota|credits?).{0,20}exhaust/i.test(providerMessage)
          || (upstream.status === 403 && /quota|credits?|exhaust/i.test(providerMessage));
        const transientRateLimited = upstream.status === 429 && !dailyQuotaBlocked;
        if (dailyQuotaBlocked && env.LBA_KV) {
          await env.LBA_KV.put('ppt_daily_quota_exhausted_until_v2', String(Date.now() + 60 * 60 * 1000), { expirationTtl: 60 * 60 });
        } else if (transientRateLimited && env.LBA_KV) {
          await env.LBA_KV.put('ppt_rate_limited_until_v2', String(Date.now() + 60 * 1000), { expirationTtl: 60 });
        }
        const stale = env.LBA_KV ? await env.LBA_KV.get(cacheKey, 'json').catch(() => null) : null;
        if ((dailyQuotaBlocked || transientRateLimited) && stale) {
          return json({ ...stale, providerQuotaState: dailyQuotaBlocked ? 'exhausted' : 'rate_limited', providerStatus: upstream.status, warning: providerMessage, cache:{ state:'stale', source:'worker-kv', cacheKey, cachedAt:stale.cache?.cachedAt || null } }, 200, pokemonQuotaHeaders(upstream.headers));
        }
        return json({
          ok: false,
          source: 'pokemonpricetracker',
          error: providerMessage,
          providerStatus: upstream.status,
          providerQuotaState: dailyQuotaBlocked ? 'exhausted' : transientRateLimited ? 'rate_limited' : 'available',
          detail: data,
          usage: {
            remaining: upstream.headers.get('X-RateLimit-Remaining') || null,
            dailyRemaining: upstream.headers.get('X-RateLimit-Daily-Remaining') || null,
            consumed: upstream.headers.get('X-API-Calls-Consumed') || null,
            breakdown: upstream.headers.get('X-API-Calls-Breakdown') || null,
          },
        }, [401, 403, 429].includes(upstream.status) ? upstream.status : 500, pokemonQuotaHeaders(upstream.headers));
      }
      const payload = {
        ok: true,
        source: 'pokemonpricetracker',
        route: spec.upstream,
        data: data?.data ?? data,
        cards,
        card: cards[0] || null,
        count: cards.length,
        usage: {
          remaining: upstream.headers.get('X-RateLimit-Remaining') || null,
          dailyRemaining: upstream.headers.get('X-RateLimit-Daily-Remaining') || null,
          consumed: upstream.headers.get('X-API-Calls-Consumed') || null,
          breakdown: upstream.headers.get('X-API-Calls-Breakdown') || null,
        },
        cache:{ state:'miss', source:'live', cacheKey, cachedAt:new Date().toISOString() },
      };
      // Await the write so exact product lookups reliably become reusable. A
      // floating KV write may be cancelled as soon as the response completes.
      if (env.LBA_KV && upstream.ok) {
        await env.LBA_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 }).catch(() => {});
      }
      return json(payload, 200, pokemonQuotaHeaders(upstream.headers));
    }

    // Universal TCG pricing proxy.
    // Optional secret: TCGAPI_KEY from https://tcgapi.dev
    // GET /pricing/tcg?q=&game=&set=&condition=&finish=&language=&sealed=true
    if (url.pathname === '/pricing/tcg') {
      const q = (url.searchParams.get('q') || '').trim();
      const game = (url.searchParams.get('game') || '').trim().toLowerCase();
      const setName = (url.searchParams.get('set') || '').trim().toLowerCase();
      const condition = (url.searchParams.get('condition') || 'NM').toUpperCase();
      const finishFilter = (url.searchParams.get('finish') || '').trim().toLowerCase();
      const languageFilter = (url.searchParams.get('language') || 'English').trim();
      const sealed = /^(1|true|yes)$/i.test(url.searchParams.get('sealed') || '');
      if (q.length < 2) return json({ ok: false, error: 'q required' }, 400);

      const condMult = { NM: 1, LP: 0.8, MP: 0.64, HP: 0.4, DMG: 0.25 };
      const conditions = ['NM', 'LP', 'MP', 'HP', 'DMG'];
      const conditionNames = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
      const normalizeFinish = value => {
        const raw = String(value || 'normal').toLowerCase();
        if (/reverse/.test(raw)) return 'reverse_holo';
        if (/holo/.test(raw)) return 'holofoil';
        if (/etched/.test(raw)) return 'etched_foil';
        if (/surge/.test(raw)) return 'surge_foil';
        if (/textured/.test(raw)) return 'textured_foil';
        if (/serial/.test(raw)) return 'serialized';
        if (/foil/.test(raw)) return 'foil';
        if (/1st|first/.test(raw)) return 'first_edition';
        if (/unlimited/.test(raw)) return 'unlimited';
        return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'normal';
      };
      const pickPrice = p => Number(p?.marketPrice ?? p?.market_price ?? p?.market ?? p?.price ?? p?.midPrice ?? p?.median_price ?? p?.mid ?? p?.lowPrice ?? p?.low_price ?? p?.low ?? 0);
      const makeVariants = (priceMap, productId = '', productConditionIdPrefix = '') => {
        const entries = Array.isArray(priceMap)
          ? priceMap.map((p, i) => [p.printing || p.finish || p.sub_type || 'normal', p, i])
          : Object.entries(priceMap || {}).map(([k, p], i) => [k, p, i]);
        const variants = [];
        entries.forEach(([finishRaw, p, i]) => {
          const finish = normalizeFinish(finishRaw);
          const baseMarket = pickPrice(p);
          const low = Number(p?.lowPrice ?? p?.low_price ?? p?.low ?? p?.directLowPrice ?? p?.direct_low_price ?? 0) || null;
          const mid = Number(p?.midPrice ?? p?.median_price ?? p?.mid ?? p?.price ?? 0) || null;
          const high = Number(p?.highPrice ?? p?.high_price ?? p?.high ?? 0) || null;
          conditions.forEach(cond => {
            const skuId = p?.skuId || p?.sku_id || p?.id || `${productId || 'product'}-${finish}-${cond}`;
            const hasSkuMarket = Number(p?.[cond]?.marketPrice || p?.[cond]?.market || 0) > 0;
            const condMarket = hasSkuMarket ? Number(p[cond].marketPrice || p[cond].market) : null;
            const fallback = cond === 'NM' ? baseMarket : Math.round(baseMarket * (condMult[cond] || 1) * 100) / 100;
            variants.push({
              skuId: `${skuId}-${cond}`,
              productConditionId: p?.productConditionId || p?.product_condition_id || `${productConditionIdPrefix || productId || 'pc'}-${i}-${cond}`,
              condition: cond,
              conditionName: conditionNames[cond],
              finish,
              foilType: finish,
              language: languageFilter || 'English',
              printing: String(finishRaw || finish),
              marketPrice: condMarket,
              productLevelMarketPrice: baseMarket || null,
              estimatedMarketPrice: condMarket || (baseMarket ? fallback : null),
              lowPrice: low,
              midPrice: mid,
              highPrice: high,
              directLowPrice: Number(p?.directLowPrice ?? p?.direct_low_price ?? 0) || null,
              lowestListingPrice: Number(p?.lowestListingPrice ?? p?.lowest_listing_price ?? p?.low ?? 0) || null,
              lowestShipping: Number(p?.lowestShipping ?? p?.lowest_shipping ?? 0) || null,
              recentSoldPrice: Number(p?.recentSoldPrice ?? p?.recent_sold_price ?? 0) || null,
              lastUpdated: p?.lastUpdated || p?.last_updated || null,
              priceConfidence: condMarket ? 'high' : baseMarket ? (cond === 'NM' ? 'medium' : 'low') : 'unknown',
              priceSource: condMarket ? 'TCGplayer SKU Market' : baseMarket ? (cond === 'NM' ? 'Product-Level Estimate' : 'Estimated fallback') : 'Needs Research',
            });
          });
        });
        return variants.filter(v => !finishFilter || v.finish === finishFilter || String(v.printing || '').toLowerCase().includes(finishFilter));
      };
      const matchResponse = (match, variants, source, selectedVariant) => ({
        success: true,
        query: q,
        source,
        matches: [{
          productId: match.id || match.productId || match.tcgplayer_id || '',
          name: match.name || q,
          cleanName: match.clean_name || match.cleanName || match.name || q,
          groupId: match.group_id || match.groupId || '',
          groupName: match.group_name || match.set_name || match.set?.name || '',
          setName: match.set_name || match.set?.name || '',
          setCode: match.set_code || match.set?.id || '',
          cardNumber: match.number || match.cardNumber || '',
          rarity: match.rarity || '',
          productLine: match.product_line || match.supertype || game || '',
          categoryName: match.category_name || game || '',
          imageUrl: match.image_url || match.images?.small || match.images?.large || '',
          productUrl: match.url || match.tcgplayer?.url || '',
          confidenceScore: 80,
          matchReasons: ['pricing proxy match'],
          availableVariants: variants,
          extraInfo: {
            productLine: match.product_line || match.supertype || '',
            categoryName: match.category_name || game || '',
            manaCost: match.mana_cost || '',
            typeLine: match.type_line || '',
            oracleText: match.oracle_text || '',
            artist: match.artist || '',
            releaseDate: match.releaseDate || match.set?.releaseDate || '',
          }
        }],
        selectedVariant,
        errors: []
      });
      const gameSlug = (() => {
        if (/magic|mtg/.test(game)) return 'magic-the-gathering';
        if (/yu|yugioh|yu-gi-oh/.test(game)) return 'yu-gi-oh';
        if (/pokemon|pokémon/.test(game)) return 'pokemon';
        if (/one piece/.test(game)) return 'one-piece-card-game';
        if (/lorcana/.test(game)) return 'lorcana';
        return game.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      })();

      if (env.TCGAPI_KEY) {
        try {
          const params = new URLSearchParams({ q, per_page: '20', sort: 'relevance' });
          if (gameSlug) params.set('game', gameSlug);
          if (sealed) params.set('type', 'Sealed Products');
          const apiRes = await fetch(`https://api.tcgapi.dev/v1/search?${params.toString()}`, {
            headers: { 'X-API-Key': env.TCGAPI_KEY, 'Accept': 'application/json' },
          });
          const data = await apiRes.json().catch(() => ({}));
          if (!apiRes.ok) return json({ ok: false, source: 'tcgapi', error: errorMessageFromApi(data, 'TCG API error'), detail: data }, apiRes.status);
          const rows = data.data || [];
          const best = rows
            .map(card => {
              let score = 0;
              const hay = [card.name, card.clean_name, card.set_name, card.number].filter(Boolean).join(' ').toLowerCase();
              const qq = q.toLowerCase();
              if (hay.includes(qq)) score += 20;
              if (setName && String(card.set_name || '').toLowerCase().includes(setName)) score += 20;
              if (sealed && /sealed/i.test(card.product_type || '')) score += 20;
              if (card.market_price || card.price || card.low_price) score += 10;
              return { card, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.card;
          if (!best) return json({ ok: false, source: 'tcgapi', error: 'No match', matches: [] }, 404);
          const priceRows = Array.isArray(best.prices) ? best.prices : [];
          const normalPrice = priceRows.find(p => /normal|regular|standard/i.test(p.printing || '')) || priceRows[0] || {};
          const nm = Number(
            best.market_price ||
            best.price ||
            best.median_price ||
            best.low_price ||
            normalPrice.market_price ||
            normalPrice.price ||
            normalPrice.median_price ||
            normalPrice.low_price ||
            0
          );
          const variants = makeVariants(priceRows.length ? priceRows : [{ printing:'normal', market_price:nm }], best.id || best.productId || '', best.product_condition_id || '');
          const selectedVariant = variants.find(v => v.condition === condition && (!finishFilter || v.finish === finishFilter)) || variants.find(v => v.condition === condition) || variants[0] || null;
          const price = Number(selectedVariant?.marketPrice || selectedVariant?.estimatedMarketPrice || selectedVariant?.productLevelMarketPrice || 0);
          return json({
            ok: true,
            ...matchResponse(best, variants, 'tcgapi', selectedVariant),
            source: 'tcgapi',
            match: best,
            price,
            condition,
            nmMarket: nm,
            rawMatches: rows.slice(0, 8),
          });
        } catch (e) {
          return json({ ok: false, source: 'tcgapi', error: e.message }, 500);
        }
      }

      if (/pokemon|pokémon/.test(game)) {
        try {
          const pokemonHeaders = env.POKEMONTCG_API_KEY ? { 'X-Api-Key': env.POKEMONTCG_API_KEY } : {};
          const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent('name:"' + q + '"')}&pageSize=10`, {
            headers: pokemonHeaders,
          });
          if (!r.ok) {
            const err = await r.text();
            return json({ ok: false, source: 'pokemontcg', error: 'PokemonTCG API ' + r.status, detail: err.slice(0, 200) }, r.status);
          }
          const d = await r.json();
          const card = d.data?.[0];
          const prices = card?.tcgplayer?.prices || {};
          const nm = Object.values(prices).find(p => p?.market > 0 || p?.mid > 0)?.market || Object.values(prices).find(p => p?.mid > 0)?.mid || 0;
          if (!card || !nm) return json({ ok: false, source: 'pokemontcg', error: 'No price match' }, 404);
          const variants = makeVariants(prices, card.id || '', card.id || '');
          const selectedVariant = variants.find(v => v.condition === condition && (!finishFilter || v.finish === finishFilter)) || variants.find(v => v.condition === condition) || variants[0] || null;
          return json({
            ok: true,
            ...matchResponse(card, variants, 'pokemontcg', selectedVariant),
            source: 'pokemontcg',
            match: card,
            price: Number(selectedVariant?.marketPrice || selectedVariant?.estimatedMarketPrice || selectedVariant?.productLevelMarketPrice || 0),
            condition,
            nmMarket: nm,
            rawMatches: d.data || []
          });
        } catch (e) {
          return json({ ok: false, source: 'pokemontcg', error: e.message }, 500);
        }
      }

      return json({
        ok: false,
        needsKey: true,
        source: 'none',
        error: 'TCGAPI_KEY not set. Add a free key from https://tcgapi.dev for MTG, Yu-Gi-Oh, Lorcana, One Piece, sealed products, and other TCG prices.',
      }, 501);
    }

    // User-uploaded inventory photos: stored in R2 (not embedded as base64 in
    // the synced inventory row) so every device's inventory sync only carries
    // a short URL instead of the whole image on every pull.
    if (url.pathname === '/inventory/photo/upload' && request.method === 'POST') {
      const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Photo storage not configured' }, 500);
      const contentType = String(request.headers.get('Content-Type') || 'image/jpeg').split(';')[0].trim();
      if (!contentType.startsWith('image/')) return json({ ok: false, error: 'Only image uploads are supported' }, 400);
      const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
      const buf = await request.arrayBuffer();
      if (!buf.byteLength) return json({ ok: false, error: 'Empty upload' }, 400);
      if (buf.byteLength > 8 * 1024 * 1024) return json({ ok: false, error: 'Photo must be under 8MB' }, 400);
      const key = `inventory-photos/${storeId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await env.MTG_CATALOG_R2.put(key, buf, { httpMetadata: { contentType } });
      return json({ ok: true, url: `${url.origin}/inventory/photo/${key}` });
    }
    const inventoryPhotoMatch = url.pathname.match(/^\/inventory\/photo\/(inventory-photos\/.+)$/);
    if (inventoryPhotoMatch && request.method === 'GET') {
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Photo storage not configured' }, 500);
      const obj = await env.MTG_CATALOG_R2.get(inventoryPhotoMatch[1]);
      if (!obj) return new Response('Not found', { status: 404, headers: CORS });
      return new Response(obj.body, {
        headers: { ...CORS, 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
      });
    }
    // Only reachable for a genuinely deleted item (sold/consigned items are
    // never hard-deleted -- see inventoryDeleteBlockReason in the dashboard),
    // so this never touches a photo that still belongs to sale history.
    if (url.pathname === '/inventory/photo/delete' && request.method === 'POST') {
      const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
      const auth = await requireStoreUser(request, env, storeId);
      if (auth.error) return auth.error;
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Photo storage not configured' }, 500);
      const body = await request.json().catch(() => ({}));
      const photoMatch = String(body.url || '').match(/\/inventory\/photo\/(inventory-photos\/[^?#]+)/);
      if (!photoMatch) return json({ ok: false, error: 'Not an inventory photo URL' }, 400);
      const key = photoMatch[1];
      if (!key.startsWith(`inventory-photos/${storeId}/`)) return json({ ok: false, error: 'Photo does not belong to this store' }, 403);
      await env.MTG_CATALOG_R2.delete(key);
      return json({ ok: true });
    }

    // Store branding logo: same R2 hosting as inventory photos, but its own
    // prefix since it's a persistent store-identity asset, not a deletable
    // inventory record -- there's no per-item delete-on-delete concept here.
    if (url.pathname === '/store/logo/upload' && request.method === 'POST') {
      const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
      const auth = await requireStoreUser(request, env, storeId, ['owner', 'admin']);
      if (auth.error) return auth.error;
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Logo storage not configured' }, 500);
      const contentType = String(request.headers.get('Content-Type') || 'image/png').split(';')[0].trim();
      if (!contentType.startsWith('image/')) return json({ ok: false, error: 'Only image uploads are supported' }, 400);
      const ext = (contentType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
      const buf = await request.arrayBuffer();
      if (!buf.byteLength) return json({ ok: false, error: 'Empty upload' }, 400);
      if (buf.byteLength > 4 * 1024 * 1024) return json({ ok: false, error: 'Logo must be under 4MB' }, 400);
      const key = `store-logos/${storeId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await env.MTG_CATALOG_R2.put(key, buf, { httpMetadata: { contentType } });
      return json({ ok: true, url: `${url.origin}/store/logo/${key}` });
    }
    const storeLogoMatch = url.pathname.match(/^\/store\/logo\/(store-logos\/.+)$/);
    if (storeLogoMatch && request.method === 'GET') {
      if (!env.MTG_CATALOG_R2) return json({ ok: false, error: 'Logo storage not configured' }, 500);
      const obj = await env.MTG_CATALOG_R2.get(storeLogoMatch[1]);
      if (!obj) return new Response('Not found', { status: 404, headers: CORS });
      return new Response(obj.body, {
        headers: { ...CORS, 'Content-Type': obj.httpMetadata?.contentType || 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
      });
    }

    const PSA_BASE = 'https://api.psacard.com/publicapi';

    if (url.pathname.startsWith('/psa/')) {
      if (!env.PSA_TOKEN) return json({ error: 'PSA_TOKEN not set in Worker secrets', hint: 'Add it in Cloudflare Worker variables' }, 500);

      const certMatch = url.pathname.match(/^\/psa\/cert\/(\d+)$/);
      if (certMatch) {
        const certNumber = certMatch[1];
        try {
          const psaRes = await fetch(`${PSA_BASE}/cert/GetByCertNumber/${certNumber}`, {
            headers: { 'Authorization': 'Bearer ' + env.PSA_TOKEN, 'Accept': 'application/json' },
          });

          if (!psaRes.ok) {
            const errText = await psaRes.text();
            return json({ error: 'PSA API error ' + psaRes.status, detail: errText.substring(0, 200) }, psaRes.status);
          }

          const data = await psaRes.json();
          // PSA's own docs: a 200 doesn't guarantee cert data -- malformed cert
          // numbers or unfound certs still return 200 with IsValidRequest:false
          // or ServerMessage:"No data found" instead of an HTTP error.
          if (data?.IsValidRequest === false || /no data found/i.test(String(data?.ServerMessage || ''))) {
            return json({ ok: false, error: data.ServerMessage || 'PSA has no record for that cert number' }, 404);
          }
          const cert = data?.PSACert || data;
          // PSA only started attaching images to cert lookups in Oct 2021, and the
          // public API has shipped the URL under a couple of different casings/shapes
          // over time -- check each rather than assuming one.
          const imageList = Array.isArray(cert.Images) ? cert.Images
            : Array.isArray(cert.ImageURLs) ? cert.ImageURLs
            : [];
          const firstImage = v => typeof v === 'string' ? v : (v?.URL || v?.Url || v?.ImageURL || '');
          const photoUrl = cert.ImageURL || cert.ImageUrl || firstImage(imageList[0]) || null;
          const photoUrls = imageList.map(firstImage).filter(Boolean);

          return json({
            ok: true,
            cert: {
              certNumber: cert.CertNumber || certNumber,
              subject: cert.Subject || null,
              year: cert.Year || null,
              brand: cert.Brand || null,
              category: cert.Category || null,
              series: cert.Series || null,
              cardNumber: cert.CardNumber || cert.SpecNumber || null,
              variety: cert.Variety || null,
              grade: cert.CardGrade || cert.Grade || null,
              gradeDesc: cert.GradeDescription || null,
              totalPop: cert.TotalPopulation || 0,
              popHigher: cert.PopulationHigher ?? cert.PopHigher ?? 0,
              isDualCert: cert.IsDualCert || false,
              isAuthentic: cert.IsAuthentic || false,
              itemStatus: cert.ItemStatus || null,
              psaSetId: cert.PSASetID || null,
              specId: cert.SpecID || null,
              photoUrl,
              photoUrls: photoUrls.length ? photoUrls : (photoUrl ? [photoUrl] : []),
              labelType: cert.LabelType || null,
            },
          });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }

      const popMatch = url.pathname.match(/^\/psa\/pop\/(\d+)$/);
      if (popMatch) {
        const specSetId = popMatch[1];
        try {
          const psaRes = await fetch(`${PSA_BASE}/pop/GetPopulationReport/${specSetId}`, {
            headers: { 'Authorization': 'Bearer ' + env.PSA_TOKEN, 'Accept': 'application/json' },
          });
          if (!psaRes.ok) return json({ error: 'PSA pop error ' + psaRes.status }, psaRes.status);
          const data = await psaRes.json();
          return json({ ok: true, pop: data });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }

      return json({ error: 'Unknown PSA route. Use /psa/cert/:certNumber or /psa/pop/:specSetId' }, 404);
    }

    if (url.pathname === '/comic/variants') {
      const title = url.searchParams.get('title') || '';
      const issue = url.searchParams.get('issue') || '';
      const year = url.searchParams.get('year') || '';
      if (!title) return json({ variants: [] });
      if (!env.COMICVINE_API_KEY) return json({ variants: [], error: 'COMICVINE_API_KEY not configured' });

      try {
        const volRes = await fetch(
          `https://comicvine.gamespot.com/api/volumes/?api_key=${env.COMICVINE_API_KEY}&format=json` +
          `&filter=name:${encodeURIComponent(title)}&field_list=id,name,publisher,image,start_year&limit=10`,
          { headers: { 'User-Agent': 'LBAScanner/1.0' } }
        );
        if (!volRes.ok) return json({ variants: [], error: 'CV volumes ' + volRes.status });
        const volData = await volRes.json();
        let volumes = volData.results || [];
        if (!volumes.length) return json({ variants: [] });

        if (year) {
          const targetYear = parseInt(year, 10);
          volumes = volumes.sort((a, b) => {
            const da = Math.abs((parseInt(a.start_year, 10) || 0) - targetYear);
            const db = Math.abs((parseInt(b.start_year, 10) || 0) - targetYear);
            return da - db;
          });
        }

        const variants = [];
        for (const vol of volumes.slice(0, 5)) {
          const issFilter = issue ? `,issue_number:${issue}` : '';
          const issRes = await fetch(
            `https://comicvine.gamespot.com/api/issues/?api_key=${env.COMICVINE_API_KEY}&format=json` +
            `&filter=volume:${vol.id}${issFilter}` +
            `&field_list=id,name,issue_number,image,cover_date,volume,description&limit=20`,
            { headers: { 'User-Agent': 'LBAScanner/1.0' } }
          );
          if (!issRes.ok) continue;
          const issData = await issRes.json();
          for (const iss of (issData.results || [])) {
            const issYear = iss.cover_date ? iss.cover_date.slice(0, 4) : (vol.start_year || '');
            variants.push({
              id: iss.id,
              title: iss.name || title,
              issue_number: iss.issue_number,
              volume: iss.volume?.name || vol.name,
              volume_id: vol.id,
              publisher: vol.publisher?.name || '',
              cover_image: iss.image?.super_url || iss.image?.medium_url || null,
              cover_date: iss.cover_date || null,
              year: issYear,
              description: iss.description ? iss.description.replace(/<[^>]+>/g, '').slice(0, 200) : null,
            });
          }
        }

        if (year) {
          variants.sort((a, b) => {
            const da = Math.abs((parseInt(a.year, 10) || 0) - parseInt(year, 10));
            const db = Math.abs((parseInt(b.year, 10) || 0) - parseInt(year, 10));
            return da - db;
          });
        }

        return json({ ok: true, variants });
      } catch (e) {
        return json({ variants: [], error: e.message });
      }
    }

    if (url.pathname === '/comps/sold') {
      const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim();
      const limit = Number(url.searchParams.get('limit') || 40);
      const mode = (url.searchParams.get('mode') || '').toLowerCase();
      if (!q) return json({ ok: false, error: 'q required' }, 400);
      try {
        let result = await fetchSoldCompsProvider(env, q, Math.max(limit * 2, 40));
        const warnings = [];
        if (result.warning) warnings.push(result.warning);
        if (!result.comps.length) {
          const ebay = await fetchEbaySoldComps(env, q, Math.max(limit * 2, 40));
          if (ebay.warning) warnings.push(ebay.warning);
          if (ebay.comps.length) result = ebay;
        }
        const filtered = filterSoldComps(result.comps, q, mode);
        const comps = filtered
          .filter(c => Number(c.total || c.price || 0) > 0)
          .sort((a, b) => (Date.parse(b.soldAt || '') || 0) - (Date.parse(a.soldAt || '') || 0))
          .slice(0, Math.min(100, Math.max(10, limit)));
        const ebayAppAvailable = !!(env.EBAY_APP_ID || await getStoredSecret(env, 'EBAY_CLIENT_ID'));
        return json({
          ok: true,
          query: q,
          mode,
          source: comps.length ? result.source : 'none',
          comps,
          stats: soldCompStats(comps),
          buckets: soldCompBuckets(comps),
          filteredOut: Math.max(0, result.comps.length - filtered.length),
          warnings: [...new Set(warnings.filter(Boolean))].slice(0, 3),
          needsProvider: !env.SOLDCOMPS_API_KEY && !ebayAppAvailable,
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === '/graded/pricing') {
      const q = (url.searchParams.get('q') || '').trim();
      const category = (url.searchParams.get('category') || '').toLowerCase();
      const tcgPlayerId = (url.searchParams.get('tcgPlayerId') || '').trim();
      if (!q) return json({ ok: false, error: 'q required' }, 400);

      const median = values => {
        const a = values.filter(v => Number(v) > 0).sort((x, y) => x - y);
        if (!a.length) return 0;
        const mid = Math.floor(a.length / 2);
        return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
      };

      const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
      const searches = [
        { key: 'raw', label: 'Raw sold', query: clean(`${q} ungraded raw`) },
        { key: 'psa9', label: 'PSA 9 sold', query: clean(`${q} PSA 9`) },
        { key: 'psa10', label: 'PSA 10 sold', query: clean(`${q} PSA 10`) },
        { key: 'bgs95', label: 'BGS 9.5 sold', query: clean(`${q} BGS 9.5`) },
        { key: 'cgc10', label: 'CGC 10 sold', query: clean(`${q} CGC 10`) },
      ];

      function moneyValue(v) {
        if (typeof v === 'number') return v > 0 ? v : 0;
        if (typeof v === 'string') {
          const n = Number(v.replace(/[$,]/g, ''));
          return n > 0 ? n : 0;
        }
        if (!v || typeof v !== 'object') return 0;
        for (const key of ['market', 'marketPrice', 'price', 'value', 'avg', 'average', 'median', 'lastSold', 'last_sale', 'lastSale']) {
          const n = moneyValue(v[key]);
          if (n) return n;
        }
        return 0;
      }

      function recursivePrice(obj, company, grade) {
        if (!obj || typeof obj !== 'object') return 0;
        const targetGrade = String(grade).replace('.', '');
        const descriptor = [
          obj.grade,
          obj.condition,
          obj.grader,
          obj.gradingCompany,
          obj.company,
          obj.title,
          obj.label,
        ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9.]/g, '');
        if (descriptor.includes(company.toLowerCase()) && descriptor.includes(targetGrade)) {
          const direct = moneyValue(obj);
          if (direct) return direct;
        }
        const companyKeys = [company, company.toUpperCase(), company.toLowerCase()];
        for (const ck of companyKeys) {
          const branch = obj[ck];
          if (branch && typeof branch === 'object') {
            const direct = moneyValue(branch[String(grade)] || branch['grade_' + String(grade).replace('.', '_')]);
            if (direct) return direct;
          }
        }
        for (const [key, value] of Object.entries(obj)) {
          const normalized = key.toLowerCase().replace(/[^a-z0-9.]/g, '');
          if (normalized.includes(company.toLowerCase()) && normalized.includes(targetGrade)) {
            const direct = moneyValue(value);
            if (direct) return direct;
          }
          if (value && typeof value === 'object') {
            const nested = recursivePrice(value, company, grade);
            if (nested) return nested;
          }
        }
        return 0;
      }

      function recursivePopulation(obj, company, grade) {
        if (!obj || typeof obj !== 'object') return 0;
        const targetGrade = String(grade).replace('.', '');
        const descriptor = [
          obj.grade,
          obj.condition,
          obj.grader,
          obj.gradingCompany,
          obj.company,
          obj.title,
          obj.label,
        ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9.]/g, '');
        if (descriptor.includes(company.toLowerCase()) && descriptor.includes(targetGrade)) {
          const n = Number(obj.population || obj.pop || obj.totalPop || obj.count);
          if (n > 0) return n;
        }
        for (const [key, value] of Object.entries(obj)) {
          const normalized = key.toLowerCase().replace(/[^a-z0-9.]/g, '');
          if (normalized.includes(company.toLowerCase()) && normalized.includes(targetGrade) && /pop|population/.test(normalized)) {
            const n = Number(value);
            if (n > 0) return n;
          }
          if (value && typeof value === 'object') {
            const nested = recursivePopulation(value, company, grade);
            if (nested) return nested;
          }
        }
        return 0;
      }

      async function pokemonPriceTracker() {
        const key = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
        const isPokemon = !category || /pokemon|tcg/.test(category) || /pokemon/i.test(q) || tcgPlayerId;
        if (!key || !isPokemon) return null;

        const params = new URLSearchParams({
          limit: /^\d+$/.test(tcgPlayerId) ? '1' : '5',
          includeEbay: 'true',
          days: '7',
        });
        if (/^\d+$/.test(tcgPlayerId)) params.set('tcgPlayerId', tcgPlayerId);
        else params.set('search', q);

        async function callPpt(requestParams) {
          const res = await fetch(new URL('/pricing/pokemonpricetracker/cards?' + requestParams.toString(), url.origin), { headers: request.headers });
          const raw = await res.text();
          let data;
          try { data = JSON.parse(raw); } catch (e) { data = { raw: raw.slice(0, 300) }; }
          return {
            res,
            data,
            remaining: res.headers.get('X-RateLimit-Daily-Remaining') || null,
            consumed: res.headers.get('X-API-Calls-Consumed') || null,
          };
        }

        let { res: pptRes, data, remaining, consumed } = await callPpt(params);
        const providerWarnings = [];
        if (!pptRes.ok && [400, 402, 403].includes(pptRes.status) && params.get('includeEbay') === 'true') {
          providerWarnings.push('PokemonPriceTracker graded/eBay data unavailable on this key or request; showing basic card data if available');
          params.delete('includeEbay');
          params.delete('days');
          ({ res: pptRes, data, remaining, consumed } = await callPpt(params));
        }
        if (!pptRes.ok) {
          const msg = errorMessageFromApi(data, 'PokemonPriceTracker API ' + pptRes.status);
          return { ok: false, source: 'pokemonpricetracker', warnings: ['PokemonPriceTracker API ' + pptRes.status + ': ' + msg], providerDetail: data, remaining, consumed };
        }

        const cards = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.cards) ? data.cards : []);
        const card = cards[0] || data?.data || data?.card || null;
        if (!card || Array.isArray(card)) {
          return { ok: false, source: 'pokemonpricetracker', warnings: ['PokemonPriceTracker found no matching Pokemon card'], remaining, consumed };
        }

        const rawPrice = moneyValue(card.prices?.market || card.prices || card.tcgplayer || card.rawPrice || card.marketPrice);
        const mapped = [
          { key: 'raw', label: 'Raw market', value: rawPrice, pop: 0 },
          { key: 'psa8', label: 'PSA 8 value', value: recursivePrice(card, 'psa', 8), pop: recursivePopulation(card, 'psa', 8) },
          { key: 'psa9', label: 'PSA 9 value', value: recursivePrice(card, 'psa', 9), pop: recursivePopulation(card, 'psa', 9) },
          { key: 'psa10', label: 'PSA 10 value', value: recursivePrice(card, 'psa', 10), pop: recursivePopulation(card, 'psa', 10) },
          { key: 'bgs95', label: 'BGS 9.5 value', value: recursivePrice(card, 'bgs', 9.5), pop: recursivePopulation(card, 'bgs', 9.5) },
          { key: 'cgc10', label: 'CGC 10 value', value: recursivePrice(card, 'cgc', 10), pop: recursivePopulation(card, 'cgc', 10) },
        ];
        const comps = mapped.map(c => ({
          key: c.key,
          label: c.label,
          query: q,
          source: 'pokemonpricetracker',
          count: c.pop || 0,
          averagePrice: Math.round((c.value || 0) * 100) / 100,
          medianPrice: Math.round((c.value || 0) * 100) / 100,
          population: c.pop || 0,
          recentPrices: [],
          error: null,
        }));
        const hasAnyPrice = comps.some(c => c.medianPrice > 0);
        const hasGradedPrice = comps.some(c => c.key !== 'raw' && c.medianPrice > 0);
        return {
          ok: hasAnyPrice,
          source: 'pokemonpricetracker',
          comps,
          card: {
            name: card.name || card.card || q,
            setName: card.setName || card.set?.name || card.set || null,
            cardNumber: card.cardNumber || card.number || null,
            image: card.image?.large || card.image?.small || card.images?.large || card.images?.small || null,
          },
          warnings: providerWarnings.concat(hasGradedPrice ? [] : ['PokemonPriceTracker returned raw pricing but no graded values for this card/key']),
          remaining,
          consumed,
        };
      }

      const pokemonResult = await pokemonPriceTracker();
      if (pokemonResult) {
        return json({
          ok: true,
          query: q,
          source: 'pokemonpricetracker',
          comps: pokemonResult.comps || [],
          card: pokemonResult.card || null,
          warnings: pokemonResult.warnings || [],
          needsEbayAuth: false,
          needsEbay: false,
          usage: { remaining: pokemonResult.remaining || null, consumed: pokemonResult.consumed || null },
        });
      }

      async function completedPrices(query) {
        const sc = await fetchSoldCompsProvider(env, query, 50);
        if (sc.comps?.length) {
          const mode = /\b(raw|ungraded)\b/i.test(query) ? 'raw' : 'graded';
          const filtered = filterSoldComps(sc.comps, query, mode);
          const prices = filtered.map(c => Number(c.total || c.price || 0)).filter(p => p > 0);
          return { source: 'soldcomps', prices, filteredOut: Math.max(0, sc.comps.length - filtered.length) };
        }
        if (!env.EBAY_APP_ID) return { source: 'none', prices: [] };
        const findRes = await fetch(
          `https://svcs.ebay.com/services/search/FindingService/v1` +
          `?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0` +
          `&SECURITY-APPNAME=${env.EBAY_APP_ID}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD` +
          `&GLOBAL-ID=EBAY-US` +
          `&keywords=${encodeURIComponent(query)}` +
          `&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true` +
          `&sortOrder=EndTimeSoonest&paginationInput.entriesPerPage=25`
        );
        if (!findRes.ok) return { source: 'ebay_sold', prices: [], error: 'Finding API ' + findRes.status };
        const fd = await findRes.json();
        const root = fd.findCompletedItemsResponse?.[0] || {};
        const ack = root.ack?.[0] || '';
        const errMsg = root.errorMessage?.[0]?.error?.[0]?.message?.[0] || '';
        if (ack && !['Success', 'Warning'].includes(ack)) {
          return { source: 'ebay_sold', prices: [], error: 'Finding API ' + (errMsg || ack) };
        }
        const items = fd.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
        const prices = items
          .map(i => Number(i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0))
          .filter(p => p > 0);
        return { source: 'ebay_sold', prices: filterSoldComps(items.map(i => normalizeSoldComp(i, 'ebay_sold')).filter(Boolean), query, /\b(raw|ungraded)\b/i.test(query) ? 'raw' : 'graded').map(c => Number(c.total || c.price || 0)).filter(p => p > 0) };
      }

      async function activePrices(query) {
        if (!env.EBAY_USER_TOKEN) return { source: 'none', prices: [] };
        const browseRes = await fetch(
          `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=25&sort=price`,
          { headers: {
            'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'Content-Type': 'application/json',
          } }
        );
        if (!browseRes.ok) return { source: 'ebay_active', prices: [], error: 'Browse API ' + browseRes.status };
        const bd = await browseRes.json();
        const prices = (bd.itemSummaries || [])
          .map(i => Number(i.price?.value || 0))
          .filter(p => p > 0);
        return { source: 'ebay_active', prices };
      }

      const comps = [];
      for (const s of searches) {
        let result = await completedPrices(s.query);
        if (!result.prices.length) result = await activePrices(s.query);
        const avg = result.prices.length ? result.prices.reduce((a, b) => a + b, 0) / result.prices.length : 0;
        comps.push({
          ...s,
          source: result.source,
          count: result.prices.length,
          averagePrice: Math.round(avg * 100) / 100,
          medianPrice: Math.round(median(result.prices) * 100) / 100,
          recentPrices: result.prices.slice(0, 8),
          error: result.error || null,
        });
      }

      const warnings = [...new Set(comps.map(c => c.error).filter(Boolean))];
      return json({
        ok: true,
        query: q,
        source: env.EBAY_APP_ID ? 'ebay_sold' : (env.EBAY_USER_TOKEN ? 'ebay_active' : 'none'),
        comps,
        warnings,
        needsEbayAuth: warnings.some(w => /401|authorization|access token|invalid/i.test(w)),
        needsEbay: !env.EBAY_APP_ID && !env.EBAY_USER_TOKEN,
      });
    }

    if (url.pathname === '/comic/pricing') {
      const title = url.searchParams.get('title') || '';
      const issue = url.searchParams.get('issue') || '';
      if (!title) return json({ averagePrice: 0, recentPrices: [] });

      const q = encodeURIComponent(`${title}${issue ? ' #' + issue : ''} comic`);

      try {
        if (env.EBAY_APP_ID) {
          const findRes = await fetch(
            `https://svcs.ebay.com/services/search/FindingService/v1` +
            `?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0` +
            `&SECURITY-APPNAME=${env.EBAY_APP_ID}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD` +
            `&keywords=${q}` +
            `&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true` +
            `&categoryId=63&sortOrder=EndTimeSoonest&paginationInput.entriesPerPage=20`
          );
          if (findRes.ok) {
            const fd = await findRes.json();
            const items = fd.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
            const prices = items
              .map(i => parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0'))
              .filter(p => p > 0);
            if (prices.length) {
              const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
              return json({ ok: true, averagePrice: Math.round(avg * 100) / 100, recentPrices: prices.slice(0, 10), source: 'ebay_sold' });
            }
          }
        }

        if (env.EBAY_USER_TOKEN) {
          const browseRes = await fetch(
            `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${q}&limit=20&sort=PRICE_ASC`,
            { headers: {
              'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
              'Content-Type': 'application/json',
            } }
          );
          if (browseRes.ok) {
            const bd = await browseRes.json();
            const prices = (bd.itemSummaries || [])
              .map(i => parseFloat(i.price?.value || '0'))
              .filter(p => p > 0);
            if (prices.length) {
              const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
              return json({ ok: true, averagePrice: Math.round(avg * 100) / 100, recentPrices: prices.slice(0, 10), source: 'ebay_active' });
            }
          }
        }

        return json({ averagePrice: 0, recentPrices: [], source: 'none' });
      } catch (e) {
        return json({ averagePrice: 0, recentPrices: [], error: e.message });
      }
    }

    // ── TOPPS ROUTES ──────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/topps/')) {
      const kv = env.LBA_KV;

      // GET /topps/catalog — hardcoded catalog merged with import status
      if (url.pathname === '/topps/catalog' && request.method === 'GET') {
        const idxRaw = kv ? await kv.get('sets_index') : null;
        const importedMap = {};
        (idxRaw ? JSON.parse(idxRaw) : []).forEach(s => { importedMap[s.slug] = s; });
        const catalog = TOPPS_CATALOG.map(s => ({
          ...s,
          imported: !!importedMap[s.slug],
          _meta: importedMap[s.slug] || null,
        }));
        return json({ ok: true, catalog });
      }

      // GET /topps/test-import?n=5 — dry-run import N sets, return quality report (no KV writes)
      if (url.pathname === '/topps/test-import' && request.method === 'GET') {
        const n = Math.min(parseInt(url.searchParams.get('n') || '5', 10), 10);
        const slugFilter = url.searchParams.get('slug'); // test a specific slug
        const TEST_SETS = slugFilter
          ? TOPPS_CATALOG.filter(s => s.slug === slugFilter)
          : [
              TOPPS_CATALOG.find(s => s.slug === '2025-topps-chrome-baseball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-topps-series-1-baseball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-bowman-baseball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-26-topps-chrome-basketball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-topps-chrome-football'),
            ].filter(Boolean).slice(0, n);

        const results = [];
        for (const entry of TEST_SETS) {
          const urlsToTry = [
            entry.beckettUrl,
            `https://www.beckett.com/news/${entry.slug}-cards/`,
            `https://www.beckett.com/news/${entry.slug}-checklist/`,
          ].filter(Boolean);

          let parsed = null;
          let usedUrl = null;
          let fetchError = null;
          for (const tryUrl of urlsToTry) {
            const fetchRes = await fetch(tryUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.beckett.com/',
              },
              redirect: 'follow',
            }).catch(e => { fetchError = e.message; return null; });

            if (!fetchRes || !fetchRes.ok) {
              fetchError = fetchRes ? `HTTP ${fetchRes.status}` : fetchError;
              continue;
            }
            const html = await fetchRes.text();
            parsed = parseBeckettChecklist(html, entry.slug, entry.name, entry.sport, entry.year);
            if (parsed && (parsed.base_set?.cards?.length > 0 || parsed.insert_sets?.length > 0)) {
              usedUrl = tryUrl;
              break;
            }
          }

          const baseCards = parsed?.base_set?.cards || [];
          const insertSets = parsed?.insert_sets || [];
          const autoSets = parsed?.autograph_sets || [];
          const memSets = parsed?.memorabilia_sets || [];

          results.push({
            slug: entry.slug,
            name: entry.name,
            sport: entry.sport,
            year: entry.year,
            ok: !!usedUrl,
            source: usedUrl,
            error: usedUrl ? null : (fetchError || 'Parser found 0 cards'),
            counts: {
              base: baseCards.length,
              insertSets: insertSets.length,
              autoSets: autoSets.length,
              memSets: memSets.length,
              parallels: parsed?.parallels?.length || 0,
            },
            // Sample data for quality check
            sampleBase: baseCards.slice(0, 5).map(c => `#${c.number} ${c.player} (${c.team || '?'})${c.rc ? ' RC' : ''}`),
            insertSetNames: insertSets.map(s => `${s.name} (${s.cards?.length || 0} cards)`),
            autoSetNames: autoSets.map(s => `${s.name} (${s.cards?.length || 0} cards)`),
            parallels: parsed?.parallels?.slice(0, 8) || [],
          });
        }

        const passing = results.filter(r => r.ok && (r.counts.base > 0 || r.counts.insertSets > 0 || r.counts.autoSets > 0));
        return json({
          ok: true,
          tested: results.length,
          passing: passing.length,
          failing: results.length - passing.length,
          readyToScale: passing.length === results.length,
          results,
        });
      }


      if (url.pathname === '/topps/debug-pdf' && request.method === 'GET') {
        const pdfUrl = url.searchParams.get('url');
        if (!pdfUrl) return json({ error: 'url param required' }, 400);
        const res = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.topps.com/',
            'Accept': 'application/pdf,*/*',
          },
        }).catch(e => null);
        if (!res) return json({ error: 'Fetch failed' }, 502);
        const ct = res.headers.get('content-type') || '';
        const finalUrl = res.url;
        const status = res.status;
        if (!ct.includes('pdf') && !pdfUrl.toLowerCase().includes('.pdf')) {
          const html = await res.text();
          // Look for PDF links
          const pdfLinks = [];
          const linkRe = /href="([^"]*\.pdf[^"]*)"/gi;
          let m;
          while ((m = linkRe.exec(html)) !== null) pdfLinks.push(m[1]);
          return json({ ok: false, status, contentType: ct, finalUrl, htmlLength: html.length, pdfLinks, htmlSnippet: html.slice(0, 2000) });
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Check PDF header
        let header = '';
        for (let i = 0; i < Math.min(20, bytes.length); i++) header += String.fromCharCode(bytes[i]);
        // Try text extraction
        let extractedText = '';
        try { extractedText = await extractPdfText(buf); } catch(e) { extractedText = 'ERROR: ' + e.message; }
        return json({
          ok: true, status, contentType: ct, finalUrl,
          pdfSize: buf.byteLength,
          pdfHeader: header,
          extractedLength: extractedText.length,
          extractedSample: extractedText.slice(0, 3000),
        });
      }

      // GET /topps/fetch-catalog — scrape topps.com/pages/checklists for live set list
      if (url.pathname === '/topps/fetch-catalog' && request.method === 'GET') {
        const idxRaw = kv ? await kv.get('sets_index') : null;
        const importedMap = {};
        (idxRaw ? JSON.parse(idxRaw) : []).forEach(s => { importedMap[s.slug] = s; });

        // Try live scrape first
        let liveSets = await fetchToppsChecklistCatalog();

        // Merge with hardcoded catalog (hardcoded has better metadata)
        const hardcodedMap = {};
        TOPPS_CATALOG.forEach(s => { hardcodedMap[s.slug] = s; });

        // Build unified list: live sets + hardcoded sets not in live list
        const merged = [];
        const seenSlugs = new Set();

        if (liveSets && liveSets.length > 0) {
          for (const ls of liveSets) {
            const hc = hardcodedMap[ls.slug];
            const entry = hc ? { ...hc, url: ls.url } : ls;
            entry.imported = !!importedMap[ls.slug];
            entry._meta = importedMap[ls.slug] || null;
            merged.push(entry);
            seenSlugs.add(ls.slug);
          }
        }
        // Add hardcoded sets not found in live page
        for (const hc of TOPPS_CATALOG) {
          if (!seenSlugs.has(hc.slug)) {
            merged.push({ ...hc, imported: !!importedMap[hc.slug], _meta: importedMap[hc.slug] || null });
          }
        }

        return json({ ok: true, catalog: merged, source: liveSets ? 'live' : 'hardcoded' });
      }

      // POST /topps/import-checklist — import a set using Beckett HTML (preferred) or PDF
      if (url.pathname === '/topps/import-checklist' && request.method === 'POST') {
        if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
        const body = await request.json().catch(() => ({}));
        const { slug, name, sport = 'baseball', year = '', brand = '' } = body;
        if (!slug || !name) return json({ ok: false, error: 'slug and name required' }, 400);

        // Find the catalog entry to get beckettUrl
        const catEntry = TOPPS_CATALOG.find(s => s.slug === slug) || {};
        let beckettUrl = body.beckettUrl || catEntry.beckettUrl;

        // Auto-construct Beckett URL if not provided
        if (!beckettUrl) {
          beckettUrl = `https://www.beckett.com/news/${slug}-cards/`;
        }

        // Try up to 3 Beckett URL patterns
        const urlsToTry = [
          beckettUrl,
          `https://www.beckett.com/news/${slug}-checklist/`,
          `https://www.beckett.com/news/${slug}/`,
        ];

        let parsed = null;
        let usedUrl = null;
        for (const tryUrl of urlsToTry) {
          const fetchRes = await fetch(tryUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.beckett.com/',
              'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
          }).catch(() => null);

          if (!fetchRes || !fetchRes.ok) continue;
          const html = await fetchRes.text();
          parsed = parseBeckettChecklist(html, slug, name, sport, year);
          if (parsed && (parsed.base_set?.cards?.length > 0 || parsed.insert_sets?.length > 0)) {
            usedUrl = tryUrl;
            break;
          }
        }

        if (!parsed || (parsed.base_set?.cards?.length === 0 && parsed.insert_sets?.length === 0)) {
          return json({ ok: false, error: `Checklist not found on Beckett. Tried: ${urlsToTry.join(', ')}` }, 404);
        }

        await kv.put(`set:${slug}`, JSON.stringify(parsed));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year, brand,
          setSize: parsed.base_set?.cards?.length || 0,
          releaseDate: parsed.release_date || year,
          importedAt: new Date().toISOString(),
          beckettUrl: usedUrl,
          baseCount: parsed.base_set?.cards?.length || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount, autoSetCount: meta.autoSetCount, source: usedUrl });
      }

      // GET /topps/proxy-pdf?url=URL — proxy a Topps PDF to the browser (bypasses CORS)
      if (url.pathname === '/topps/proxy-pdf' && request.method === 'GET') {
        const pdfUrl = url.searchParams.get('url');
        if (!pdfUrl) return json({ ok: false, error: 'url param required' }, 400);
        const pdfRes = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.topps.com/',
            'Accept': 'application/pdf,*/*',
          },
        }).catch(() => null);
        if (!pdfRes || !pdfRes.ok) return json({ ok: false, error: `PDF fetch failed: ${pdfRes?.status || 'network error'}` }, 502);
        const ct = pdfRes.headers.get('content-type') || 'application/octet-stream';
        if (ct.includes('html')) {
          const html = await pdfRes.text();
          const m = html.match(/href="([^"]*\.pdf[^"]*)"/i) || html.match(/src="([^"]*\.pdf[^"]*)"/i);
          if (m) {
            const realUrl = m[1].startsWith('http') ? m[1] : 'https://www.topps.com' + m[1];
            return new Response(JSON.stringify({ redirect: realUrl }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
          }
          return json({ ok: false, error: 'URL returned HTML, no PDF link found' }, 422);
        }
        const buf = await pdfRes.arrayBuffer();
        return new Response(buf, { headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Length': String(buf.byteLength) } });
      }

      // POST /topps/import-pdf — fetch a PDF URL, extract text, parse, store in KV
      if (url.pathname === '/topps/import-pdf' && request.method === 'POST') {
        if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
        const body = await request.json().catch(() => ({}));
        const { url: pdfUrl, slug, name, sport = 'baseball', year = '', brand = '' } = body;
        if (!pdfUrl || !slug || !name) return json({ ok: false, error: 'url, slug, name required' }, 400);

        // Fetch the PDF
        const pdfRes = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.topps.com/',
            'Accept': 'application/pdf,*/*',
          },
        }).catch(e => null);

        if (!pdfRes || !pdfRes.ok) {
          return json({ ok: false, error: `PDF fetch failed: ${pdfRes?.status || 'network error'} — ${pdfUrl}` }, 502);
        }

        const ct = pdfRes.headers.get('content-type') || '';
        if (!ct.includes('pdf') && !pdfUrl.toLowerCase().includes('.pdf')) {
          // Might be an HTML page wrapping the PDF link — try to find PDF URL in the response
          const html = await pdfRes.text();
          const pdfLinkM = html.match(/href="([^"]*\.pdf[^"]*)"/i);
          if (pdfLinkM) {
            return json({ ok: false, redirect: pdfLinkM[1], error: 'Redirected to PDF URL, retry with redirect URL' }, 200);
          }
          return json({ ok: false, error: 'URL did not return a PDF' }, 422);
        }

        const arrayBuffer = await pdfRes.arrayBuffer();
        let text = '';
        try {
          text = await extractPdfText(arrayBuffer);
        } catch (e) {
          return json({ ok: false, error: 'PDF text extraction failed: ' + e.message }, 422);
        }

        if (!text || text.trim().length < 50) {
          return json({ ok: false, error: 'Could not extract readable text from PDF (length=' + text.length + ')', textSample: text.slice(0, 500) }, 422);
        }

        // Parse the extracted text
        const parsed = parseToppsChecklistText(text, { slug, name, sport, year, brand });

        // If 0 cards, return the text sample for debugging instead of storing empty data
        if (parsed.base_set.cards.length === 0 && parsed.insert_sets.length === 0 && parsed.autograph_sets.length === 0) {
          return json({ ok: false, error: 'Parser found 0 cards — text format may not match expected Topps checklist format', textSample: text.slice(0, 2000), textLength: text.length }, 422);
        }

        // Store in KV
        await kv.put(`set:${slug}`, JSON.stringify(parsed));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year, brand,
          setSize: parsed.base_set?.cards?.length || 0,
          releaseDate: year,
          importedAt: new Date().toISOString(),
          baseCount: parsed.base_set?.cards?.length || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount, autoSetCount: meta.autoSetCount });
      }

      // POST /topps/seed-supabase — upsert full TOPPS_CATALOG into topps_sets table
      if (url.pathname === '/topps/seed-supabase' && request.method === 'POST') {
        const sbUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
        const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
        if (!sbUrl || !sbKey) return json({ ok: false, error: 'Supabase not configured' }, 503);
        const rows = TOPPS_CATALOG.map(s => ({
          slug: s.slug,
          set_name: s.name,
          year: String(s.year || ''),
          brand: s.brand || '',
          sport: s.sport || 'baseball',
          release_name: s.name,
          product: s.brand || 'Topps',
          card_count: 0,
          source_ids: [],
          beckett_url: s.beckettUrl || null,
        }));
        // Upsert in batches of 50
        const BATCH = 50;
        let inserted = 0;
        const errors = [];
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const res = await fetch(`${sbUrl}/rest/v1/topps_sets`, {
            method: 'POST',
            headers: {
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(batch),
          });
          if (res.ok) {
            inserted += batch.length;
          } else {
            const err = await res.text().catch(() => res.status);
            errors.push(`batch ${i}-${i + batch.length}: ${err}`);
          }
        }
        return json({ ok: errors.length === 0, total: rows.length, inserted, errors });
      }

      return json({ error: 'Not found' }, 404);
    }

    // Topps Checklist Browser API. Supabase is the catalog source of truth.
    // KV is intentionally not used as a fallback for checklist set/card data.
    if (url.pathname.startsWith('/topps-checklists')) {
      // The immutable Topps catalog was verified and moved to R2 on
      // 2026-07-16. These legacy Supabase-backed routes stay retired so an
      // old client cannot recreate catalog database load after cleanup.
      return json({ ok: false, error: 'Topps catalog moved to R2; install it from Offline Data' }, 410);
      const kv = env.LBA_KV;
      const supabaseToppsUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
      const supabaseToppsKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
      const supabaseToppsEnabled = !!(supabaseToppsUrl && supabaseToppsKey);
      if (!supabaseToppsEnabled) return json({ ok: false, error: 'Supabase Topps catalog not configured' }, 503);
      const TOPPS_CARD_CHUNK_SIZE = 5000;
      const readJsonKv = async (key, fallback) => {
        if (!kv) return fallback;
        const raw = await kv.get(key);
        if (!raw) return fallback;
        try { return JSON.parse(raw); } catch (_) { return fallback; }
      };
      const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const dbText = v => String(v || '').replace(/\s+/g, ' ').trim();
      const dbLike = v => '*' + dbText(v).replace(/\*/g, ' ').trim() + '*';
      const supabaseRest = async (table, params = new URLSearchParams(), { count = false } = {}) => {
        const apiUrl = new URL(`${supabaseToppsUrl}/rest/v1/${table}`);
        params.forEach((value, key) => apiUrl.searchParams.append(key, value));
        const headers = {
          apikey: supabaseToppsKey,
          Authorization: `Bearer ${supabaseToppsKey}`,
          Accept: 'application/json',
        };
        if (count) headers.Prefer = 'count=exact';
        const res = await fetch(apiUrl.toString(), { headers });
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error(data?.message || data?.error || `Supabase ${table} failed`);
        const range = res.headers.get('content-range') || '';
        const total = Number((range.match(/\/(\d+)$/) || [])[1] || 0);
        return { data, total: Number.isFinite(total) ? total : 0 };
      };
      const toppsSetFromDb = row => ({
        id: row.id,
        year: row.year,
        brand: row.brand,
        product: row.product,
        sport: row.sport,
        setName: row.set_name,
        releaseName: row.release_name,
        sourceIds: row.source_ids || [],
        cardCount: row.card_count || 0,
        updatedAt: row.updated_at,
      });
      const toppsCardFromDb = row => ({
        id: row.id,
        setId: row.set_id,
        sourceId: row.source_id,
        year: row.year,
        brand: row.brand,
        product: row.product,
        sport: row.sport,
        setName: row.set_name,
        releaseName: row.release_name,
        cardNumber: row.card_number,
        player: row.player,
        subject: row.subject,
        team: row.team,
        notes: row.notes,
        section: row.section,
        flags: row.flags || {},
        parseConfidence: Number(row.parse_confidence || 0),
        searchText: row.search_text || '',
        updatedAt: row.updated_at,
      });
      const toppsSourceFromDb = row => row ? ({
        sourceId: row.source_id,
        fileName: row.file_name,
        originalPath: row.original_path,
        pdfUrl: row.pdf_url,
        pdfHash: row.pdf_hash,
        pageCount: row.page_count,
        textLength: row.text_length,
        rawText: row.raw_text,
        parsedSetId: row.parsed_set_id,
        importedAt: row.imported_at,
        updatedAt: row.updated_at,
      }) : null;
      const supabaseToppsMeta = async () => {
        const p = new URLSearchParams({ select: '*', id: 'eq.topps_checklists', limit: '1' });
        const { data } = await supabaseRest('topps_import_meta', p);
        const row = data?.[0] || {};
        return {
          importedAt: row.imported_at,
          status: row.status || 'ready',
          schemaVersion: row.schema_version || 1,
          setCount: row.set_count || 0,
          cardCount: row.card_count || 0,
          sourceCount: row.source_count || 0,
          storage: 'supabase',
        };
      };
      const supabaseToppsSets = async ({ q = '', sport = '', year = '', limit = 2000 } = {}) => {
        const p = new URLSearchParams({ select: '*', order: 'year.desc,product.asc', limit: String(limit) });
        if (q) p.set('search_text', 'ilike.' + dbLike(q));
        if (sport) p.set('sport', 'eq.' + sport);
        if (year) p.set('year', 'eq.' + year);
        const { data, total } = await supabaseRest('topps_sets', p, { count: true });
        return { sets: (data || []).map(toppsSetFromDb), total };
      };
      const supabaseToppsCards = async ({ filters = {}, limit = 100, offset = 0, id = '' } = {}) => {
        const p = new URLSearchParams({
          select: '*',
          order: 'section_sort.asc,section.asc,card_number_prefix.asc,card_number_sort.asc,card_number.asc,player.asc',
          limit: String(limit),
          offset: String(offset),
        });
        if (id) p.set('id', 'eq.' + id);
        if (filters.setId) p.set('set_id', 'eq.' + filters.setId);
        if (filters.year) p.set('year', 'eq.' + filters.year);
        if (filters.sport) p.set('sport', 'eq.' + filters.sport);
        if (filters.product) p.set('product', 'ilike.' + dbLike(filters.product));
        if (filters.team) p.set('team', 'ilike.' + dbLike(filters.team));
        if (filters.number) p.set('card_number', 'eq.' + filters.number);
        if (filters.flag) p.set(`flags->>${filters.flag}`, 'eq.true');
        if (filters.q) norm(filters.q).split(/\s+/).filter(Boolean).forEach(t => p.append('search_text', 'ilike.*' + t + '*'));
        const { data, total } = await supabaseRest('topps_checklist_cards', p, { count: true });
        return { cards: (data || []).map(toppsCardFromDb), total, complete: true, scannedChunks: 0, meta: { storage: 'supabase' } };
      };
      const getToppsCardById = async cardId => {
        const page = await supabaseToppsCards({ id: cardId, limit: 1 });
        return { card: page.cards[0] || null, storage: 'supabase' };
      };
      const getToppsSource = async sourceId => {
        if (!sourceId) return null;
        const p = new URLSearchParams({ select: '*', source_id: 'eq.' + sourceId, limit: '1' });
        const { data } = await supabaseRest('topps_pdf_sources', p);
        return data?.[0] ? toppsSourceFromDb(data[0]) : null;
      };
      const cardMatches = (card, filters) => {
        if (filters.setId && card.setId !== filters.setId) return false;
        if (filters.year && String(card.year || '') !== String(filters.year)) return false;
        if (filters.sport && String(card.sport || '').toLowerCase() !== String(filters.sport).toLowerCase()) return false;
        if (filters.product && !norm(card.product).includes(norm(filters.product))) return false;
        if (filters.team && !norm(card.team).includes(norm(filters.team))) return false;
        if (filters.number && String(card.cardNumber || '').toLowerCase() !== String(filters.number).toLowerCase()) return false;
        if (filters.flag && !card.flags?.[filters.flag]) return false;
        if (filters.q) {
          const hay = card.searchText || [card.year, card.brand, card.product, card.sport, card.section, card.cardNumber, card.player, card.subject, card.team, card.notes].join(' ').toLowerCase();
          if (!norm(filters.q).split(/\s+/).every(t => hay.includes(t))) return false;
        }
        return true;
      };
      const hasToppsFilters = filters => Object.values(filters).some(Boolean);
      const scanToppsCards = async ({ filters = {}, limit = 100, offset = 0, id = '' } = {}) => {
        const meta = await readJsonKv('topps_import_meta', {});
        const count = Number(await kv.get('topps_cards_chunk_count') || meta.chunkCount || 0);
        const out = [];
        let seen = 0;
        let scannedChunks = 0;
        const need = offset + limit;
        for (let i = 0; i < count; i++) {
          const chunk = await readJsonKv(`topps_cards_chunk:${i}`, []);
          scannedChunks++;
          for (const card of chunk) {
            const match = id ? card.id === id : cardMatches(card, filters);
            if (!match) continue;
            if (id) return { cards: [card], total: 1, scannedChunks, complete: true, meta };
            if (seen >= offset && out.length < limit) out.push(card);
            seen++;
            if (out.length >= limit) return { cards: out, total: hasToppsFilters(filters) ? seen : Number(meta.cardCount || seen), scannedChunks, complete: false, meta };
          }
        }
        return { cards: out, total: seen, scannedChunks, complete: true, meta };
      };
      const toppsKnownTeams = [
        'Arizona Diamondbacks','Atlanta Braves','Baltimore Orioles','Boston Red Sox','Chicago Cubs','Chicago White Sox','Cincinnati Reds','Cleveland Indians','Cleveland Guardians','Colorado Rockies','Detroit Tigers','Houston Astros','Kansas City Royals','Los Angeles Angels','Anaheim Angels','Los Angeles Dodgers','Miami Marlins','Florida Marlins','Milwaukee Brewers','Minnesota Twins','New York Mets','New York Yankees','Oakland Athletics','Philadelphia Phillies','Pittsburgh Pirates','San Diego Padres','San Francisco Giants','Seattle Mariners','St. Louis Cardinals','Tampa Bay Rays','Texas Rangers','Toronto Blue Jays','Washington Nationals',
        'Angels','Braves','Orioles','Red Sox','Cubs','White Sox','Reds','Indians','Guardians','Rockies','Tigers','Astros','Royals','Dodgers','Marlins','Brewers','Twins','Mets','Yankees','Athletics','Phillies','Pirates','Padres','Giants','Mariners','Cardinals','Rays','Rangers','Blue Jays','Nationals'
      ].sort((a, b) => b.length - a.length);
      const cleanToppsText = v => String(v || '').replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();
      const toppsPlayerNameOnly = card => {
        let name = cleanToppsText(card.player || card.subject || '').replace(/\b(Rookie|RC)\b/ig, '').replace(/\s+/g, ' ').trim();
        for (const team of toppsKnownTeams) {
          const re = new RegExp('\\s+' + team.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
          if (re.test(name)) return name.replace(re, '').trim();
        }
        return name;
      };
      const toppsPcCategory = card => {
        const s = String(card.sport || '').toLowerCase();
        if (s.includes('star wars')) return 'Star Wars Cards';
        if (s.includes('marvel')) return 'Marvel Cards';
        if (s.includes('garbage') || s.includes('gpk')) return 'Garbage Pail Cards';
        return 'Sports Cards';
      };
      const toppsPcQueries = card => {
        const player = toppsPlayerNameOnly(card);
        const num = cleanToppsText(card.cardNumber || '').replace(/^#/, '');
        const product = cleanToppsText(card.product || card.setName || '').replace(/\bchecklist\b/ig, '').replace(/\bbaseball\b/ig, '').trim();
        const year = cleanToppsText(card.year || '').split('-')[0];
        const flags = [card.flags?.rc ? 'RC' : '', card.flags?.auto ? 'auto' : '', card.flags?.relic ? 'relic' : ''].filter(Boolean).join(' ');
        return [
          [player, num ? '#' + num : '', flags].filter(Boolean).join(' '),
          [player, num, flags].filter(Boolean).join(' '),
          [player, num ? '#' + num : '', product, flags].filter(Boolean).join(' '),
          [year, 'Topps', product, player, num ? '#' + num : '', flags].filter(Boolean).join(' '),
        ].map(q => q.replace(/\s+/g, ' ').trim()).filter((q, i, arr) => q && arr.indexOf(q) === i);
      };
      const toppsPcScore = (match, card, query) => {
        const hay = cleanToppsText([match.productName, match['product-name'], match.consoleName, match['console-name'], match.genre].join(' ')).toLowerCase();
        const player = toppsPlayerNameOnly(card).toLowerCase();
        const num = cleanToppsText(card.cardNumber || '').replace(/^#/, '').toLowerCase();
        let score = 0;
        if (player && player.split(/\s+/).every(t => hay.includes(t))) score += 80;
        if (num && (hay.includes('#' + num) || new RegExp('(^|[^a-z0-9])' + num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i').test(hay))) score += 55;
        if (card.year && hay.includes(String(card.year).split('-')[0])) score += 18;
        if (/topps|bowman|allen|ginter|stadium|chrome|heritage|archives/i.test(hay)) score += 14;
        if (query && hay.includes(query.toLowerCase())) score += 10;
        if (/funko|pop\b/i.test(hay) && String(card.sport || '').toLowerCase() !== 'collectibles') score -= 200;
        if (String(card.sport || '').toLowerCase() === 'baseball' && !/(baseball|mlb|yankees|dodgers|red sox|cubs|braves|mets|angels|astros|cardinals|padres|giants|mariners|phillies|orioles|rangers|blue jays|twins|brewers|marlins|pirates|rays|reds|royals|tigers|nationals|athletics|guardians|indians|rockies|white sox)/i.test(hay)) score -= 40;
        return score;
      };
      const isBadToppsSet = set => {
        const name = cleanToppsText(set.product || set.setName || set.releaseName || '');
        if (!name) return true;
        if (/^checklists provided by topps reflect/i.test(name)) return true;
        if (/^configuration of that product/i.test(name)) return true;
        if (/actual contents and odds may vary/i.test(name)) return true;
        return false;
      };

      if (url.pathname.startsWith('/topps-checklists/import') && request.method === 'PUT') {
        return json({ ok: false, error: 'Worker KV Topps import is disabled. The Topps catalog lives in R2 -- use scripts/topps/merge-and-publish.mjs.' }, 410);
      }

      if (url.pathname === '/topps-checklists/import-start' && request.method === 'PUT') {
        if (!kv) return json({ ok: false, error: 'KV not configured for legacy KV import' }, 503);
        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.sets)) return json({ ok: false, error: 'sets[] required' }, 400);
        const now = new Date().toISOString();
        const sets = body.sets.map(s => ({ ...s, updatedAt: now }));
        const sources = (body.sources || []).map(s => {
          const source = { ...s };
          delete source.rawText;
          return { ...source, updatedAt: now };
        });
        const priorCount = Number(await kv.get('topps_cards_chunk_count') || 0);
        for (let i = 0; i < priorCount; i++) await kv.delete(`topps_cards_chunk:${i}`);
        await kv.put('topps_cards_chunk_count', '0');
        await kv.put('topps_sets_index', JSON.stringify(sets));
        await kv.put('topps_source_index', JSON.stringify(sources));
        await kv.put('topps_import_meta', JSON.stringify({
          importedAt: now,
          status: 'importing',
          schemaVersion: body.schemaVersion || 1,
          setCount: sets.length,
          cardCount: 0,
          expectedCardCount: body.expectedCardCount || 0,
          sourceCount: sources.length,
          chunkCount: 0,
        }));
        return json({ ok: true, setCount: sets.length, sourceCount: sources.length, clearedChunks: priorCount });
      }

      if (url.pathname === '/topps-checklists/import-cards-chunk' && request.method === 'PUT') {
        if (!kv) return json({ ok: false, error: 'KV not configured for legacy KV import' }, 503);
        const body = await request.json().catch(() => null);
        const chunkIndex = Number(body?.chunkIndex);
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Array.isArray(body.cards)) return json({ ok: false, error: 'chunkIndex and cards[] required' }, 400);
        const now = new Date().toISOString();
        const cards = body.cards.map(c => ({ ...c, updatedAt: now }));
        await kv.put(`topps_cards_chunk:${chunkIndex}`, JSON.stringify(cards));
        return json({ ok: true, chunkIndex, cardCount: cards.length });
      }

      if (url.pathname === '/topps-checklists/import-source' && request.method === 'PUT') {
        if (!kv) return json({ ok: false, error: 'KV not configured for legacy KV import' }, 503);
        const body = await request.json().catch(() => null);
        if (!body?.source?.sourceId) return json({ ok: false, error: 'source.sourceId required' }, 400);
        await kv.put(`topps_source:${body.source.sourceId}`, JSON.stringify({ ...body.source, updatedAt: new Date().toISOString() }));
        return json({ ok: true, sourceId: body.source.sourceId });
      }

      if (url.pathname === '/topps-checklists/import-complete' && request.method === 'PUT') {
        if (!kv) return json({ ok: false, error: 'KV not configured for legacy KV import' }, 503);
        const body = await request.json().catch(() => null);
        const chunkCount = Number(body?.chunkCount);
        if (!Number.isInteger(chunkCount) || chunkCount < 0) return json({ ok: false, error: 'chunkCount required' }, 400);
        const now = new Date().toISOString();
        await kv.put('topps_cards_chunk_count', String(chunkCount));
        await kv.put('topps_import_meta', JSON.stringify({
          importedAt: now,
          status: 'ready',
          schemaVersion: body.schemaVersion || 1,
          setCount: Number(body.setCount || 0),
          cardCount: Number(body.cardCount || 0),
          sourceCount: Number(body.sourceCount || 0),
          chunkCount,
        }));
        return json({ ok: true, setCount: Number(body.setCount || 0), cardCount: Number(body.cardCount || 0), sourceCount: Number(body.sourceCount || 0), chunkCount });
      }

      if (url.pathname === '/topps-checklists/import-json' && request.method === 'PUT') {
        if (!kv) return json({ ok: false, error: 'KV not configured for legacy KV import' }, 503);
        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.sets) || !Array.isArray(body.cards)) return json({ ok: false, error: 'sets[] and cards[] required' }, 400);
        const now = new Date().toISOString();
        const sets = body.sets.map(s => ({ ...s, updatedAt: now }));
        const cards = body.cards.map(c => ({ ...c, updatedAt: now }));
        const sources = (body.sources || []).map(s => {
          const source = { ...s };
          delete source.rawText;
          return { ...source, updatedAt: now };
        });

        await kv.put('topps_sets_index', JSON.stringify(sets));
        await kv.put('topps_source_index', JSON.stringify(sources));
        for (const source of body.sources || []) await kv.put(`topps_source:${source.sourceId}`, JSON.stringify(source));
        const priorCount = Number(await kv.get('topps_cards_chunk_count') || 0);
        for (let i = 0; i < priorCount; i++) await kv.delete(`topps_cards_chunk:${i}`);
        const chunkCount = Math.ceil(cards.length / TOPPS_CARD_CHUNK_SIZE);
        for (let i = 0; i < chunkCount; i++) {
          await kv.put(`topps_cards_chunk:${i}`, JSON.stringify(cards.slice(i * TOPPS_CARD_CHUNK_SIZE, (i + 1) * TOPPS_CARD_CHUNK_SIZE)));
        }
        await kv.put('topps_cards_chunk_count', String(chunkCount));
        await kv.put('topps_import_meta', JSON.stringify({ importedAt: now, schemaVersion: body.schemaVersion || 1, setCount: sets.length, cardCount: cards.length, sourceCount: sources.length, chunkCount }));
        return json({ ok: true, setCount: sets.length, cardCount: cards.length, sourceCount: sources.length, chunkCount });
      }

      if (url.pathname === '/topps-checklists/meta' && request.method === 'GET') {
        return json({ ok: true, meta: await supabaseToppsMeta() });
      }

      if (url.pathname === '/topps-checklists/sets' && request.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const sport = url.searchParams.get('sport') || '';
        const year = url.searchParams.get('year') || '';
        const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 2000)));
        const page = await supabaseToppsSets({ q, sport, year, limit });
        const sets = page.sets.filter(s => !isBadToppsSet(s));
        return json({ ok: true, total: page.total || sets.length, sets, hiddenBadSets: page.sets.length - sets.length, storage: 'supabase' });
      }

      if (url.pathname === '/topps-checklists/cards' && request.method === 'GET') {
        const filters = {
          q: url.searchParams.get('q') || '',
          setId: url.searchParams.get('setId') || '',
          year: url.searchParams.get('year') || '',
          sport: url.searchParams.get('sport') || '',
          product: url.searchParams.get('product') || '',
          team: url.searchParams.get('team') || '',
          number: url.searchParams.get('number') || '',
          flag: url.searchParams.get('flag') || '',
        };
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
        const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
        const page = await supabaseToppsCards({ filters, limit, offset });
        return json({ ok: true, total: page.total, cards: page.cards, limit, offset, complete: true, scannedChunks: 0, storage: 'supabase' });
      }

      const cardMatch = url.pathname.match(/^\/topps-checklists\/cards\/([^/]+)$/);
      if (cardMatch && request.method === 'GET') {
        const { card, storage } = await getToppsCardById(decodeURIComponent(cardMatch[1]));
        if (!card) return json({ ok: false, error: 'Card not found' }, 404);
        const source = await getToppsSource(card.sourceId);
        return json({ ok: true, card, source, storage });
      }

      const pcMatch = url.pathname.match(/^\/topps-checklists\/cards\/([^/]+)\/pricecharting$/);
      if (pcMatch && request.method === 'GET') {
        const cardId = decodeURIComponent(pcMatch[1]);
        const cacheKey = `topps_pc_match_v2:${cardId}`;
        const fresh = url.searchParams.get('fresh') === 'true';
        const cached = !fresh ? await readJsonKv(cacheKey, null) : null;
        if (cached && Date.now() - new Date(cached.cachedAt || 0).getTime() < 86400000) return json({ ok: true, cached: true, ...cached });

        const { card } = await getToppsCardById(cardId);
        if (!card) return json({ ok: false, error: 'Card not found' }, 404);
        const category = toppsPcCategory(card);
        const queries = toppsPcQueries(card);
        const seen = new Map();
        for (const q of queries) {
          const params = new URLSearchParams({ q, category });
          const upstream = await fetch(new URL('/pricing/pricecharting/search?' + params.toString(), url.origin), { headers: request.headers });
          const data = await upstream.json().catch(() => ({}));
          for (const match of data.matches || data.products || []) {
            const key = match.productId || match.id || match.productName || match['product-name'];
            if (!key) continue;
            const prior = seen.get(key) || {};
            const score = Math.max(Number(prior._toppsScore || -999), toppsPcScore(match, card, q));
            seen.set(key, { ...prior, ...match, _toppsScore: score, _toppsQuery: q });
          }
          const strong = [...seen.values()].some(m => Number(m._toppsScore || 0) >= 120);
          if (strong) break;
        }
        const matches = [...seen.values()].sort((a, b) => Number(b._toppsScore || 0) - Number(a._toppsScore || 0));
        const best = matches.find(m => Number(m._toppsScore || 0) >= 95) || null;
        const payload = { cardId, query: queries[0] || '', queries, category, playerName: toppsPlayerNameOnly(card), matches: matches.slice(0, 8), best, cachedAt: new Date().toISOString() };
        if (kv) await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: 86400 * 14 });
        return json({ ok: true, cached: false, ...payload });
      }

      return json({ ok: false, error: 'Unknown Topps checklist route' }, 404);
    }

    // ── SET BROWSER API ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/sets')) {
      const kv = env.LBA_KV;
      if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);

      // Admin check for mutations
      const requireAdmin = async () => {
        const token = env.ADMIN_TOKEN;
        if (!token) return false;
        const auth = request.headers.get('Authorization') || '';
        return secureSecretEqual(auth, `Bearer ${token}`);
      };

      // GET /sets — list all imported sets
      if (url.pathname === '/sets' && request.method === 'GET') {
        const raw = await kv.get('sets_index');
        const index = raw ? JSON.parse(raw) : [];
        return json({ ok: true, sets: index });
      }

      // POST /sets/import-topps-text — paste raw text from a Topps PDF checklist
      if (url.pathname === '/sets/import-topps-text' && request.method === 'POST') {
        if (!await requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
        const body = await request.json().catch(() => ({}));
        const { text, slug, name, sport = 'baseball', year, brand = '' } = body;
        if (!text || !slug || !name) return json({ ok: false, error: 'text, slug, name required' }, 400);
        const parsed = parseToppsChecklistText(text, { slug, name, sport, year, brand });
        await kv.put(`set:${slug}`, JSON.stringify(parsed));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year: year || '', brand: brand || '',
          setSize: parsed.set_size || 0, releaseDate: year || '',
          importedAt: new Date().toISOString(),
          baseCount: parsed.base_set?.cards?.length || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));
        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount, autoSetCount: meta.autoSetCount });
      }

      // POST /sets/import — fetch a Beckett checklist URL and parse it into KV
      if (url.pathname === '/sets/import' && request.method === 'POST') {
        if (!await requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const body = await request.json().catch(() => ({}));
        const { url: beckettUrl, slug, name, sport = 'baseball', year } = body;
        if (!beckettUrl || !slug || !name) {
          return json({ ok: false, error: 'url, slug, name required' }, 400);
        }

        // Fetch with browser-like headers to bypass bot detection
        const fetchRes = await fetch(beckettUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xhtml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.beckett.com/news/',
            'Cache-Control': 'no-cache',
          },
          redirect: 'follow',
        }).catch(e => null);

        if (!fetchRes || !fetchRes.ok) {
          return json({ ok: false, error: `Fetch failed: ${fetchRes?.status || 'network error'}` }, 502);
        }

        const html = await fetchRes.text();
        const parsed = parseBeckettChecklist(html, slug, name, sport, year);
        if (!parsed) return json({ ok: false, error: 'Could not parse checklist from page' }, 422);

        // Store full set data
        await kv.put(`set:${slug}`, JSON.stringify(parsed));

        // Update index
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year: year || parsed.release_date || '',
          setSize: parsed.set_size || 0,
          releaseDate: parsed.release_date || '',
          importedAt: new Date().toISOString(),
          baseCount: parsed.base_set?.count || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta;
        else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount });
      }

      // POST /sets/import-raw-url — fetch pre-parsed JSON from a URL (e.g. raw GitHub) and seed it
      if (url.pathname === '/sets/import-raw-url' && request.method === 'POST') {
        if (!await requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const body = await request.json().catch(() => null);
        if (!body?.url || !body?.slug || !body?.name) return json({ ok: false, error: 'url, slug, name required' }, 400);
        const res = await fetch(body.url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return json({ ok: false, error: `Fetch failed: ${res.status}` }, 502);
        const data = await res.json().catch(() => null);
        if (!data) return json({ ok: false, error: 'Invalid JSON at URL' }, 422);
        const payload = { ...data, slug: body.slug, name: body.name, sport: body.sport || data.sport || 'baseball', year: body.year || data.release_date || '' };
        await kv.put(`set:${body.slug}`, JSON.stringify(payload));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === body.slug);
        const meta = { slug: body.slug, name: body.name, sport: payload.sport, year: payload.year, setSize: data.set_size || 0, releaseDate: data.release_date || '', importedAt: new Date().toISOString(), baseCount: data.base_set?.count || data.base_set?.cards?.length || 0, insertSetCount: data.insert_sets?.length || 0, autoSetCount: data.autograph_sets?.length || 0 };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));
        return json({ ok: true, slug: body.slug, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount });
      }

      // PUT /sets/import-json — store pre-parsed JSON (for seeding)
      if (url.pathname === '/sets/import-json' && request.method === 'PUT') {
        if (!await requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const body = await request.json().catch(() => null);
        if (!body?.slug || !body?.name) return json({ ok: false, error: 'slug and name required' }, 400);
        const { slug, name, sport = 'baseball', year } = body;

        await kv.put(`set:${slug}`, JSON.stringify(body));

        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year: year || body.release_date || '',
          setSize: body.set_size || 0, releaseDate: body.release_date || '',
          importedAt: new Date().toISOString(),
          baseCount: body.base_set?.count || 0,
          insertSetCount: body.insert_sets?.length || 0,
          autoSetCount: body.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta;
        else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, seeded: true, baseCount: meta.baseCount });
      }

      // GET /sets/:slug — full set data
      const slugMatch = url.pathname.match(/^\/sets\/([^/]+)$/);
      if (slugMatch && request.method === 'GET') {
        const raw = await kv.get(`set:${slugMatch[1]}`);
        if (!raw) return json({ ok: false, error: 'Set not found' }, 404);
        return new Response(raw, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      // GET /sets/:slug/cards?q=QUERY&number=N&team=TEAM&section=base|inserts|autos
      const cardsMatch = url.pathname.match(/^\/sets\/([^/]+)\/cards$/);
      if (cardsMatch && request.method === 'GET') {
        const raw = await kv.get(`set:${cardsMatch[1]}`);
        if (!raw) return json({ ok: false, error: 'Set not found' }, 404);
        const setData = JSON.parse(raw);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const numFilter = url.searchParams.get('number') || '';
        const teamFilter = (url.searchParams.get('team') || '').toLowerCase();
        const section = url.searchParams.get('section') || 'base';

        let cards = [];
        if (section === 'base') {
          cards = setData.base_set?.cards || [];
        } else if (section === 'inserts') {
          cards = (setData.insert_sets || []).flatMap(s =>
            s.cards.map(c => ({ ...c, setName: s.name }))
          );
        } else if (section === 'autos') {
          cards = (setData.autograph_sets || []).flatMap(s =>
            s.cards.map(c => ({ ...c, setName: s.name }))
          );
        } else if (section === 'mem') {
          cards = (setData.memorabilia_sets || []).flatMap(s =>
            s.cards.map(c => ({ ...c, setName: s.name }))
          );
        }

        if (q) cards = cards.filter(c =>
          String(c.player || '').toLowerCase().includes(q) ||
          String(c.team || '').toLowerCase().includes(q) ||
          String(c.number || '').toLowerCase().includes(q) ||
          String(c.setName || '').toLowerCase().includes(q)
        );
        if (numFilter) cards = cards.filter(c => String(c.number) === numFilter);
        if (teamFilter) cards = cards.filter(c => (c.team || '').toLowerCase().includes(teamFilter));

        return json({ ok: true, section, total: cards.length, cards: cards.slice(0, 200) });
      }

      // GET /sets/:slug/card/:number/price — price lookup via PriceCharting
      const priceMatch = url.pathname.match(/^\/sets\/([^/]+)\/card\/([^/]+)\/price$/);
      if (priceMatch && request.method === 'GET') {
        const [, setSlug, cardNum] = priceMatch;
        const raw = await kv.get(`set:${setSlug}`);
        if (!raw) return json({ ok: false, error: 'Set not found' }, 404);
        const setData = JSON.parse(raw);
        const card = (setData.base_set?.cards || []).find(c => String(c.number) === cardNum);
        if (!card) return json({ ok: false, error: 'Card not found' }, 404);

        const token = env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY;
        if (!token) return json({ ok: false, error: 'PRICECHARTING_TOKEN not set' }, 501);

        const q = encodeURIComponent(`${card.player} ${setData.set}`);
        const pcRes = await fetch(`https://www.pricecharting.com/api/products?q=${q}&status=price&token=${token}`);
        if (!pcRes.ok) return json({ ok: false, error: 'PriceCharting error' }, 502);
        const pcData = await pcRes.json();
        const products = (pcData.products || []).slice(0, 5);

        return json({ ok: true, card, products });
      }

      // DELETE /sets/:slug — remove a set
      const delMatch = url.pathname.match(/^\/sets\/([^/]+)$/);
      if (delMatch && request.method === 'DELETE') {
        if (!await requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const s = delMatch[1];
        await kv.delete(`set:${s}`);
        const idxRaw = await kv.get('sets_index');
        const index = (idxRaw ? JSON.parse(idxRaw) : []).filter(x => x.slug !== s);
        await kv.put('sets_index', JSON.stringify(index));
        return json({ ok: true, deleted: s });
      }
    }

    if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) return env.ASSETS.fetch(request);
    return json({ error: 'Not found' }, 404);
    } catch(e) {
      return json({ ok: false, error: e?.message || 'Internal error' }, 500);
    }
  },
};

// ── BECKETT HTML PARSER ───────────────────────────────────────────────────────
function parseBeckettChecklist(html, slug, name, sport, year) {
  // Extract article content div
  const contentMatch = html.match(/class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+id="comments|<\/main|<footer)/i);
  if (!contentMatch) return null;
  const content = contentMatch[1];

  // ── Extract box contents from HTML <li> items under "What to expect" headings ──
  const box_contents = {};
  const boxSectionRe = /What to expect in (?:a |an )?([^:<]+?)(?:\s+box)?[:<]/gi;
  let bm;
  while ((bm = boxSectionRe.exec(content)) !== null) {
    const boxType = bm[1].trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    // grab the <ul> or <ol> that follows this heading
    const after = content.slice(bm.index + bm[0].length, bm.index + bm[0].length + 3000);
    const listMatch = after.match(/<[uo]l[^>]*>([\s\S]*?)<\/[uo]l>/i);
    if (listMatch) {
      const items = [];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(listMatch[1])) !== null) {
        const txt = li[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
        if (txt) items.push(txt);
      }
      if (items.length) box_contents[boxType] = items;
    }
  }

  // ── Strip HTML and build line array ──
  const decodeEntities = s => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&[a-z]+;/g, ' ');

  const text = content
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(li|p|h[1-6]|div|ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n').map(l => decodeEntities(l).trim()).filter(Boolean);

  const lines = text;

  // ── Product info (cards/packs/boxes per format) ──
  const product_info = { cards_per_pack: {}, packs_per_box: {}, boxes_per_case: {} };
  const infoLine = lines.find(l => /cards per pack/i.test(l));
  if (infoLine) {
    const parseFormatLine = (label) => {
      const re = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
      const m = infoLine.match(re) || lines.join('\n').match(re);
      if (!m) return {};
      const obj = {};
      m[1].split(/[;,]/).forEach(part => {
        const pm = part.trim().match(/^(.+?)\s*[–\-:]\s*(\d+)/);
        if (pm) obj[pm[1].trim()] = parseInt(pm[2]);
      });
      return obj;
    };
    product_info.cards_per_pack = parseFormatLine('Cards per pack');
    product_info.packs_per_box  = parseFormatLine('Packs per box');
    product_info.boxes_per_case = parseFormatLine('Boxes per case');
  }

  // ── Release date & set size ──
  const fullText = lines.join(' ');
  const releaseDateMatch = fullText.match(/[Rr]elease date[:\s]+([A-Za-z]+ \d+,?\s*\d{4})/);
  const releaseDate = releaseDateMatch ? releaseDateMatch[1].replace(/\s+/g, ' ').trim() : (year ? String(year) : '');
  const setSizeMatch = fullText.match(/[Ss]et size[:\s]+(\d+)/);
  const setSize = setSizeMatch ? parseInt(setSizeMatch[1]) : 0;

  // ── Card parsing helpers ──
  const TEAMS = new Set([
    'New York Yankees','Toronto Blue Jays','Minnesota Twins','New York Mets','Chicago Cubs',
    'Arizona Diamondbacks','San Francisco Giants','San Diego Padres','Milwaukee Brewers',
    'Colorado Rockies','Detroit Tigers','Boston Red Sox','Tampa Bay Rays','Baltimore Orioles',
    'Washington Nationals','Cleveland Guardians','St. Louis Cardinals','Houston Astros',
    'Kansas City Royals','Miami Marlins','Los Angeles Dodgers','Athletics','Angels',
    'Chicago White Sox','Seattle Mariners','Atlanta Braves','Philadelphia Phillies',
    'Cincinnati Reds','Pittsburgh Pirates','Texas Rangers','Los Angeles Angels',
    'Oakland Athletics','Tampa Bay Devil Rays','Montreal Expos','Other',
  ]);
  const MONTHS = new Set(['January','February','March','April','May','June','July','August','September','October','November','December']);
  const CARD_RE   = /^(\d+)\s+(.+?),\s+(.+?)(?:\s+\((.+?)\))?$/;
  // Prefix cards: e.g. "75YA-RC Roger Clemens, Boston Red Sox" or "BSA-AB Alec Burleson, St. Louis Cardinals"
  const PREFIX_RE = /^([A-Z0-9]{1,6}-[A-Z0-9]{1,6}[a-z]?)\s+(.+?),\s+(.+?)$/;
  const BASE_NO_TEAM_RE = /^(\d+)\s+(.+?)(?:\s+(RC))?$/;

  function tryBase(line, maxNum = 400) {
    const m = line.match(CARD_RE);
    if (!m) return null;
    const num = parseInt(m[1]);
    if (num > maxNum || num < 1) return null;
    const player = m[2].trim(), team = m[3].trim(), note = (m[4] || '').trim();
    if (!TEAMS.has(team) && ![...TEAMS].some(t => team.includes(t))) return null;
    if (MONTHS.has(player) || /^\d{4}$/.test(player)) return null;
    return { number: num, player, team, note };
  }

  function tryPrefixed(line) {
    const m = line.match(PREFIX_RE);
    if (!m) return null;
    const team = m[3].trim();
    if (MONTHS.has(m[2].trim())) return null;
    return { number: m[1], player: m[2].trim(), team };
  }

  function tryBaseNoTeam(line, maxNum = 400) {
    const m = line.match(BASE_NO_TEAM_RE);
    if (!m) return null;
    const num = parseInt(m[1]);
    if (num > maxNum || num < 1) return null;
    const player = m[2].trim();
    if (MONTHS.has(player) || /^\d{4}$/.test(player) || player.length < 3) return null;
    return { number: num, player, rc: m[3] === 'RC' };
  }

  // ── Find section boundaries ──
  let baseStart = -1, varsStart = lines.length, autoStart = lines.length;
  let memStart = lines.length, insStart = lines.length, teamStart = lines.length;

  const SEC = { base: /^base set checklist$/i, vars: /[–\-]\s*variations/i, auto: /[–\-]\s*autographs/i, mem: /[–\-]\s*memorabilia/i, ins: /[–\-]\s*inserts/i, team: /^team sets$/i };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SEC.base.test(l) && baseStart < 0) baseStart = i;
    if (SEC.vars.test(l) && i > baseStart && baseStart >= 0) varsStart = Math.min(varsStart, i);
    if (SEC.auto.test(l)) autoStart = Math.min(autoStart, i);
    if (SEC.mem.test(l)) memStart = Math.min(memStart, i);
    if (SEC.ins.test(l)) insStart = Math.min(insStart, i);
    if (SEC.team.test(l)) teamStart = Math.min(teamStart, i);
  }

  if (baseStart < 0) return null;

  // If sections are out of the expected order, reorder them
  // (Beckett sometimes puts inserts before autos)
  const sectionOrder = [
    ['auto', autoStart], ['mem', memStart], ['ins', insStart], ['team', teamStart]
  ].filter(s => s[1] < lines.length).sort((a, b) => a[1] - b[1]);

  // ── Parse parallels (with odds) ──
  const parallels = [];
  let inPar = false;
  for (let i = baseStart; i < varsStart; i++) {
    const l = lines[i];
    if (/^parallels$/i.test(l)) { inPar = true; continue; }
    if (inPar) {
      if (/^\d+ /.test(l) && CARD_RE.test(l)) break;
      if (l && !/^shop/i.test(l) && !/^download/i.test(l)) parallels.push(l);
    }
  }

  // ── Split lines where Beckett concatenates multiple cards without separators ──
  // e.g. "1 Aaron Judge, New York Yankees2 Shohei Ohtani, Los Angeles Dodgers"
  function splitConcatenated(line) {
    if (line.length < 40) return [line];
    // Split where a letter is immediately followed by 1-3 digits + space + capital letter
    const parts = line.split(/(?<=[A-Za-z])(?=\d{1,3}\s+[A-Z])/);
    return parts.map(s => s.trim()).filter(Boolean);
  }

  // ── Parse base cards ──
  const baseSeen = new Set();
  const baseCards = [];
  for (let i = baseStart; i < varsStart; i++) {
    for (const sl of splitConcatenated(lines[i])) {
      const c = tryBase(sl, setSize || 400);
      if (c) {
        const key = `${c.number}:${c.player}`;
        if (!baseSeen.has(key)) { baseSeen.add(key); baseCards.push(c); }
      }
    }
  }
  baseCards.sort((a, b) => a.number - b.number || a.player.localeCompare(b.player));

  // ── Generic insert/auto/mem section parser ──
  function parseSets(start, end) {
    const sets = [];
    let cur = null;
    const skip = /^(shop|download|on ebay|checklist)/i;
    for (let i = start; i < end; i++) {
      for (const l of splitConcatenated(lines[i])) {
      if (skip.test(l)) continue;
      // Section headers on Beckett look like "Set Name\nN cards"
      const nxt = lines[i + 1] || '';
      const isHeader = /^\d+ cards?$/.test(nxt) && l.length > 2 && !/^[A-Z0-9]{1,6}-[A-Z0-9]/.test(l) && !SEC.base.test(l) && !SEC.auto.test(l) && !SEC.mem.test(l) && !SEC.ins.test(l) && !SEC.team.test(l);
      if (isHeader) {
        if (cur) sets.push(cur);
        cur = { name: l, count: parseInt(nxt), parallels: [], cards: [] };
        i++;
        // Collect parallels between header and first card
        while (i + 1 < end) {
          i++;
          const pl = lines[i];
          if (!pl || skip.test(pl)) continue;
          if (tryPrefixed(pl) || tryBase(pl, 9999)) { i--; break; }
          if (/^\d+ cards?$/.test(lines[i + 1] || '')) { i--; break; }
          if (!/^parallels$/i.test(pl)) cur.parallels.push(pl);
        }
        continue;
      }
      if (!cur) continue;
      const pc = tryPrefixed(l);
      if (pc) { cur.cards.push(pc); continue; }
      const bc = tryBase(l, 9999);
      if (bc) { cur.cards.push({ number: String(bc.number), player: bc.player, team: bc.team, note: bc.note }); continue; }
      } // end splitConcatenated loop
    }
    if (cur) sets.push(cur);
    return sets.filter(s => s.cards.length > 0);
  }

  // Determine section order to correctly assign auto/mem/ins boundaries
  const secMap = { auto: autoStart, mem: memStart, ins: insStart, team: teamStart };
  const ordered = Object.entries(secMap).sort((a, b) => a[1] - b[1]);
  const nextBoundary = (key) => {
    const idx = ordered.findIndex(e => e[0] === key);
    return idx >= 0 && idx + 1 < ordered.length ? ordered[idx + 1][1] : lines.length;
  };

  const autoSets = parseSets(autoStart, nextBoundary('auto'));
  const memSets  = parseSets(memStart,  nextBoundary('mem'));
  const insSets  = parseSets(insStart,  nextBoundary('ins'));

  // ── Parse team sets (object keyed by team name) ──
  const team_sets = {};
  if (teamStart < lines.length) {
    let curTeam = null;
    for (let i = teamStart + 1; i < lines.length; i++) {
      const l = lines[i];
      // Team header line — usually matches "<Set> Checklist – <Team Name>"
      const teamHeader = l.match(/–\s+(.+)$/) || (TEAMS.has(l) ? [null, l] : null);
      if (teamHeader && TEAMS.has(teamHeader[1].trim())) {
        curTeam = teamHeader[1].trim();
        if (!team_sets[curTeam]) team_sets[curTeam] = { base: [] };
        continue;
      }
      if (!curTeam) continue;
      const c = tryBaseNoTeam(l);
      if (c) team_sets[curTeam].base.push(c);
    }
  }

  return {
    slug, set: name, sport,
    release_date: releaseDate,
    set_size: setSize || (baseCards.length > 0 ? Math.max(...baseCards.map(c => c.number)) : 0),
    product_info,
    box_contents,
    parallels,
    base_set: { count: baseCards.length, cards: baseCards },
    insert_sets: insSets,
    autograph_sets: autoSets,
    memorabilia_sets: memSets,
    team_sets,
  };
}

// ── TOPPS CATALOG ─────────────────────────────────────────────────────────────
// beckettUrl: Beckett checklist HTML page — parsed with existing parseBeckettChecklist()
// These are structured HTML pages, far more reliable than PDFs
const TOPPS_CATALOG = [
  // ── Baseball 2026 ──
  { name: '2026 Topps Chrome Baseball', sport: 'baseball', year: '2026', brand: 'Chrome', slug: '2026-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-chrome-baseball-cards/' },
  { name: '2026 Topps Series 1 Baseball', sport: 'baseball', year: '2026', brand: 'Topps', slug: '2026-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-series-1-baseball-cards/' },
  { name: '2026 Topps Series 2 Baseball', sport: 'baseball', year: '2026', brand: 'Topps', slug: '2026-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-series-2-baseball-cards/' },
  { name: '2026 Topps Heritage Baseball', sport: 'baseball', year: '2026', brand: 'Heritage', slug: '2026-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-heritage-baseball-cards/' },
  { name: '2026 Topps Finest Baseball', sport: 'baseball', year: '2026', brand: 'Finest', slug: '2026-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-finest-baseball-cards/' },
  { name: '2026 Bowman Baseball', sport: 'baseball', year: '2026', brand: 'Bowman', slug: '2026-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-bowman-baseball-cards/' },
  { name: '2026 Bowman Chrome Baseball', sport: 'baseball', year: '2026', brand: 'Bowman Chrome', slug: '2026-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-bowman-chrome-baseball-cards/' },
  // ── Baseball 2025 ──
  { name: '2025 Topps Chrome Baseball', sport: 'baseball', year: '2025', brand: 'Chrome', slug: '2025-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-baseball-cards/' },
  { name: '2025 Topps Series 1 Baseball', sport: 'baseball', year: '2025', brand: 'Topps', slug: '2025-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-series-1-baseball-cards/' },
  { name: '2025 Topps Series 2 Baseball', sport: 'baseball', year: '2025', brand: 'Topps', slug: '2025-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-series-2-baseball-cards/' },
  { name: '2025 Topps Heritage Baseball', sport: 'baseball', year: '2025', brand: 'Heritage', slug: '2025-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-heritage-baseball-cards/' },
  { name: '2025 Topps Finest Baseball', sport: 'baseball', year: '2025', brand: 'Finest', slug: '2025-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-finest-baseball-cards/' },
  { name: '2025 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2025', brand: 'Allen & Ginter', slug: '2025-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-allen-ginter-baseball-cards/' },
  { name: '2025 Topps Stadium Club Baseball', sport: 'baseball', year: '2025', brand: 'Stadium Club', slug: '2025-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-stadium-club-baseball-cards/' },
  { name: '2025 Topps Update Baseball', sport: 'baseball', year: '2025', brand: 'Topps', slug: '2025-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-update-series-baseball-cards/' },
  { name: '2025 Topps Archives Baseball', sport: 'baseball', year: '2025', brand: 'Archives', slug: '2025-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-archives-baseball-cards/' },
  { name: '2025 Bowman Baseball', sport: 'baseball', year: '2025', brand: 'Bowman', slug: '2025-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-baseball-cards/' },
  { name: "2025 Bowman's Best Baseball", sport: 'baseball', year: '2025', brand: "Bowman's Best", slug: '2025-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2025-bowmans-best-baseball-cards/" },
  { name: '2025 Bowman Chrome Baseball', sport: 'baseball', year: '2025', brand: 'Bowman Chrome', slug: '2025-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-chrome-baseball-cards/' },
  { name: '2025 Bowman Draft Baseball', sport: 'baseball', year: '2025', brand: 'Bowman Draft', slug: '2025-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-draft-baseball-cards/' },
  // ── Baseball 2024 ──
  { name: '2024 Topps Chrome Baseball', sport: 'baseball', year: '2024', brand: 'Chrome', slug: '2024-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-chrome-baseball-cards/' },
  { name: '2024 Topps Series 1 Baseball', sport: 'baseball', year: '2024', brand: 'Topps', slug: '2024-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-series-1-baseball-cards/' },
  { name: '2024 Topps Series 2 Baseball', sport: 'baseball', year: '2024', brand: 'Topps', slug: '2024-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-series-2-baseball-cards/' },
  { name: '2024 Topps Update Baseball', sport: 'baseball', year: '2024', brand: 'Topps', slug: '2024-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-update-series-baseball-cards/' },
  { name: '2024 Topps Heritage Baseball', sport: 'baseball', year: '2024', brand: 'Heritage', slug: '2024-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-heritage-baseball-cards/' },
  { name: '2024 Topps Finest Baseball', sport: 'baseball', year: '2024', brand: 'Finest', slug: '2024-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-finest-baseball-cards/' },
  { name: '2024 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2024', brand: 'Allen & Ginter', slug: '2024-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-allen-ginter-baseball-cards/' },
  { name: '2024 Topps Stadium Club Baseball', sport: 'baseball', year: '2024', brand: 'Stadium Club', slug: '2024-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-stadium-club-baseball-cards/' },
  { name: '2024 Topps Archives Baseball', sport: 'baseball', year: '2024', brand: 'Archives', slug: '2024-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-archives-baseball-cards/' },
  { name: '2024 Bowman Baseball', sport: 'baseball', year: '2024', brand: 'Bowman', slug: '2024-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-bowman-baseball-cards/' },
  { name: '2024 Bowman Chrome Baseball', sport: 'baseball', year: '2024', brand: 'Bowman Chrome', slug: '2024-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-bowman-chrome-baseball-cards/' },
  { name: '2024 Bowman Draft Baseball', sport: 'baseball', year: '2024', brand: 'Bowman Draft', slug: '2024-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-bowman-draft-baseball-cards/' },
  // ── Baseball 2023 ──
  { name: '2023 Topps Chrome Baseball', sport: 'baseball', year: '2023', brand: 'Chrome', slug: '2023-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-chrome-baseball-cards/' },
  { name: '2023 Topps Series 1 Baseball', sport: 'baseball', year: '2023', brand: 'Topps', slug: '2023-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-series-1-baseball-cards/' },
  { name: '2023 Topps Series 2 Baseball', sport: 'baseball', year: '2023', brand: 'Topps', slug: '2023-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-series-2-baseball-cards/' },
  { name: '2023 Topps Update Baseball', sport: 'baseball', year: '2023', brand: 'Topps', slug: '2023-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-update-series-baseball-cards/' },
  { name: '2023 Topps Heritage Baseball', sport: 'baseball', year: '2023', brand: 'Heritage', slug: '2023-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-heritage-baseball-cards/' },
  { name: '2023 Topps Museum Collection Baseball', sport: 'baseball', year: '2023', brand: 'Museum Collection', slug: '2023-topps-museum-collection-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-museum-collection-baseball-cards/' },
  { name: '2023 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2023', brand: 'Allen & Ginter', slug: '2023-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-allen-ginter-baseball-cards/' },
  { name: '2023 Topps Stadium Club Baseball', sport: 'baseball', year: '2023', brand: 'Stadium Club', slug: '2023-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-stadium-club-baseball-cards/' },
  { name: '2023 Topps Archives Baseball', sport: 'baseball', year: '2023', brand: 'Archives', slug: '2023-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-archives-baseball-cards/' },
  { name: '2023 Topps Finest Baseball', sport: 'baseball', year: '2023', brand: 'Finest', slug: '2023-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-finest-baseball-cards/' },
  { name: '2023 Topps Tribute Baseball', sport: 'baseball', year: '2023', brand: 'Tribute', slug: '2023-topps-tribute-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-tribute-baseball-cards/' },
  { name: '2023 Topps Gold Label Baseball', sport: 'baseball', year: '2023', brand: 'Gold Label', slug: '2023-topps-gold-label-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-gold-label-baseball-cards/' },
  { name: '2023 Topps Gallery Baseball', sport: 'baseball', year: '2023', brand: 'Gallery', slug: '2023-topps-gallery-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-gallery-baseball-cards/' },
  { name: '2023 Topps Big League Baseball', sport: 'baseball', year: '2023', brand: 'Big League', slug: '2023-topps-big-league-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-big-league-baseball-cards/' },
  { name: '2023 Topps Opening Day Baseball', sport: 'baseball', year: '2023', brand: 'Opening Day', slug: '2023-topps-opening-day-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-opening-day-baseball-cards/' },
  { name: '2023 Topps Holiday Baseball', sport: 'baseball', year: '2023', brand: 'Holiday', slug: '2023-topps-holiday-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-holiday-baseball-cards/' },
  { name: '2023 Bowman Baseball', sport: 'baseball', year: '2023', brand: 'Bowman', slug: '2023-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-baseball-cards/' },
  { name: "2023 Bowman's Best Baseball", sport: 'baseball', year: '2023', brand: "Bowman's Best", slug: '2023-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2023-bowmans-best-baseball-cards/" },
  { name: '2023 Bowman Chrome Baseball', sport: 'baseball', year: '2023', brand: 'Bowman Chrome', slug: '2023-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-chrome-baseball-cards/' },
  { name: '2023 Bowman Draft Baseball', sport: 'baseball', year: '2023', brand: 'Bowman Draft', slug: '2023-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-draft-baseball-cards/' },
  // ── Baseball 2022 ──
  { name: '2022 Topps Chrome Baseball', sport: 'baseball', year: '2022', brand: 'Chrome', slug: '2022-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-chrome-baseball-cards/' },
  { name: '2022 Topps Series 1 Baseball', sport: 'baseball', year: '2022', brand: 'Topps', slug: '2022-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-series-1-baseball-cards/' },
  { name: '2022 Topps Series 2 Baseball', sport: 'baseball', year: '2022', brand: 'Topps', slug: '2022-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-series-2-baseball-cards/' },
  { name: '2022 Topps Update Baseball', sport: 'baseball', year: '2022', brand: 'Topps', slug: '2022-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-update-series-baseball-cards/' },
  { name: '2022 Topps Heritage Baseball', sport: 'baseball', year: '2022', brand: 'Heritage', slug: '2022-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-heritage-baseball-cards/' },
  { name: '2022 Topps Museum Collection Baseball', sport: 'baseball', year: '2022', brand: 'Museum Collection', slug: '2022-topps-museum-collection-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-museum-collection-baseball-cards/' },
  { name: '2022 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2022', brand: 'Allen & Ginter', slug: '2022-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-allen-ginter-baseball-cards/' },
  { name: '2022 Topps Stadium Club Baseball', sport: 'baseball', year: '2022', brand: 'Stadium Club', slug: '2022-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-stadium-club-baseball-cards/' },
  { name: '2022 Topps Archives Baseball', sport: 'baseball', year: '2022', brand: 'Archives', slug: '2022-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-archives-baseball-cards/' },
  { name: '2022 Topps Finest Baseball', sport: 'baseball', year: '2022', brand: 'Finest', slug: '2022-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-finest-baseball-cards/' },
  { name: '2022 Topps Tribute Baseball', sport: 'baseball', year: '2022', brand: 'Tribute', slug: '2022-topps-tribute-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-tribute-baseball-cards/' },
  { name: '2022 Topps Gold Label Baseball', sport: 'baseball', year: '2022', brand: 'Gold Label', slug: '2022-topps-gold-label-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-gold-label-baseball-cards/' },
  { name: '2022 Topps Gallery Baseball', sport: 'baseball', year: '2022', brand: 'Gallery', slug: '2022-topps-gallery-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-gallery-baseball-cards/' },
  { name: '2022 Topps Big League Baseball', sport: 'baseball', year: '2022', brand: 'Big League', slug: '2022-topps-big-league-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-big-league-baseball-cards/' },
  { name: '2022 Topps Opening Day Baseball', sport: 'baseball', year: '2022', brand: 'Opening Day', slug: '2022-topps-opening-day-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-opening-day-baseball-cards/' },
  { name: '2022 Topps Holiday Baseball', sport: 'baseball', year: '2022', brand: 'Holiday', slug: '2022-topps-holiday-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-topps-holiday-baseball-cards/' },
  { name: '2022 Bowman Baseball', sport: 'baseball', year: '2022', brand: 'Bowman', slug: '2022-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-bowman-baseball-cards/' },
  { name: "2022 Bowman's Best Baseball", sport: 'baseball', year: '2022', brand: "Bowman's Best", slug: '2022-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2022-bowmans-best-baseball-cards/" },
  { name: '2022 Bowman Chrome Baseball', sport: 'baseball', year: '2022', brand: 'Bowman Chrome', slug: '2022-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-bowman-chrome-baseball-cards/' },
  { name: '2022 Bowman Draft Baseball', sport: 'baseball', year: '2022', brand: 'Bowman Draft', slug: '2022-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2022-bowman-draft-baseball-cards/' },
  // ── Baseball 2021 ──
  { name: '2021 Topps Chrome Baseball', sport: 'baseball', year: '2021', brand: 'Chrome', slug: '2021-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-chrome-baseball-cards/' },
  { name: '2021 Topps Series 1 Baseball', sport: 'baseball', year: '2021', brand: 'Topps', slug: '2021-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-series-1-baseball-cards/' },
  { name: '2021 Topps Series 2 Baseball', sport: 'baseball', year: '2021', brand: 'Topps', slug: '2021-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-series-2-baseball-cards/' },
  { name: '2021 Topps Update Baseball', sport: 'baseball', year: '2021', brand: 'Topps', slug: '2021-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-update-series-baseball-cards/' },
  { name: '2021 Topps Heritage Baseball', sport: 'baseball', year: '2021', brand: 'Heritage', slug: '2021-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-heritage-baseball-cards/' },
  { name: '2021 Topps Museum Collection Baseball', sport: 'baseball', year: '2021', brand: 'Museum Collection', slug: '2021-topps-museum-collection-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-museum-collection-baseball-cards/' },
  { name: '2021 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2021', brand: 'Allen & Ginter', slug: '2021-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-allen-ginter-baseball-cards/' },
  { name: '2021 Topps Stadium Club Baseball', sport: 'baseball', year: '2021', brand: 'Stadium Club', slug: '2021-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-stadium-club-baseball-cards/' },
  { name: '2021 Topps Archives Baseball', sport: 'baseball', year: '2021', brand: 'Archives', slug: '2021-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-archives-baseball-cards/' },
  { name: '2021 Topps Finest Baseball', sport: 'baseball', year: '2021', brand: 'Finest', slug: '2021-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-finest-baseball-cards/' },
  { name: '2021 Topps Tribute Baseball', sport: 'baseball', year: '2021', brand: 'Tribute', slug: '2021-topps-tribute-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-tribute-baseball-cards/' },
  { name: '2021 Topps Gold Label Baseball', sport: 'baseball', year: '2021', brand: 'Gold Label', slug: '2021-topps-gold-label-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-gold-label-baseball-cards/' },
  { name: '2021 Topps Gallery Baseball', sport: 'baseball', year: '2021', brand: 'Gallery', slug: '2021-topps-gallery-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-gallery-baseball-cards/' },
  { name: '2021 Topps Big League Baseball', sport: 'baseball', year: '2021', brand: 'Big League', slug: '2021-topps-big-league-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-big-league-baseball-cards/' },
  { name: '2021 Topps Opening Day Baseball', sport: 'baseball', year: '2021', brand: 'Opening Day', slug: '2021-topps-opening-day-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-opening-day-baseball-cards/' },
  { name: '2021 Topps Holiday Baseball', sport: 'baseball', year: '2021', brand: 'Holiday', slug: '2021-topps-holiday-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-topps-holiday-baseball-cards/' },
  { name: '2021 Bowman Baseball', sport: 'baseball', year: '2021', brand: 'Bowman', slug: '2021-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-bowman-baseball-cards/' },
  { name: "2021 Bowman's Best Baseball", sport: 'baseball', year: '2021', brand: "Bowman's Best", slug: '2021-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2021-bowmans-best-baseball-cards/" },
  { name: '2021 Bowman Chrome Baseball', sport: 'baseball', year: '2021', brand: 'Bowman Chrome', slug: '2021-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-bowman-chrome-baseball-cards/' },
  { name: '2021 Bowman Draft Baseball', sport: 'baseball', year: '2021', brand: 'Bowman Draft', slug: '2021-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2021-bowman-draft-baseball-cards/' },
  // ── Premium brands 2024-2025 (Museum, Tribute, Five Star) ──
  { name: '2025 Topps Museum Collection Baseball', sport: 'baseball', year: '2025', brand: 'Museum Collection', slug: '2025-topps-museum-collection-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-museum-collection-baseball-cards/' },
  { name: '2024 Topps Museum Collection Baseball', sport: 'baseball', year: '2024', brand: 'Museum Collection', slug: '2024-topps-museum-collection-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-museum-collection-baseball-cards/' },
  { name: '2025 Topps Tribute Baseball', sport: 'baseball', year: '2025', brand: 'Tribute', slug: '2025-topps-tribute-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-tribute-baseball-cards/' },
  { name: '2024 Topps Tribute Baseball', sport: 'baseball', year: '2024', brand: 'Tribute', slug: '2024-topps-tribute-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-tribute-baseball-cards/' },
  { name: '2025 Topps Five Star Baseball', sport: 'baseball', year: '2025', brand: 'Five Star', slug: '2025-topps-five-star-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-five-star-baseball-cards/' },
  { name: '2024 Topps Five Star Baseball', sport: 'baseball', year: '2024', brand: 'Five Star', slug: '2024-topps-five-star-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-five-star-baseball-cards/' },
  { name: '2025 Topps Gold Label Baseball', sport: 'baseball', year: '2025', brand: 'Gold Label', slug: '2025-topps-gold-label-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-gold-label-baseball-cards/' },
  { name: '2024 Topps Gold Label Baseball', sport: 'baseball', year: '2024', brand: 'Gold Label', slug: '2024-topps-gold-label-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-gold-label-baseball-cards/' },
  { name: '2025 Topps Gallery Baseball', sport: 'baseball', year: '2025', brand: 'Gallery', slug: '2025-topps-gallery-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-gallery-baseball-cards/' },
  { name: '2024 Topps Gallery Baseball', sport: 'baseball', year: '2024', brand: 'Gallery', slug: '2024-topps-gallery-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-gallery-baseball-cards/' },
  { name: '2025 Topps Big League Baseball', sport: 'baseball', year: '2025', brand: 'Big League', slug: '2025-topps-big-league-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-big-league-baseball-cards/' },
  { name: '2024 Topps Big League Baseball', sport: 'baseball', year: '2024', brand: 'Big League', slug: '2024-topps-big-league-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-big-league-baseball-cards/' },
  { name: '2025 Topps Opening Day Baseball', sport: 'baseball', year: '2025', brand: 'Opening Day', slug: '2025-topps-opening-day-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-opening-day-baseball-cards/' },
  { name: '2024 Topps Opening Day Baseball', sport: 'baseball', year: '2024', brand: 'Opening Day', slug: '2024-topps-opening-day-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-opening-day-baseball-cards/' },
  { name: '2025 Topps Holiday Baseball', sport: 'baseball', year: '2025', brand: 'Holiday', slug: '2025-topps-holiday-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-holiday-baseball-cards/' },
  { name: '2024 Topps Holiday Baseball', sport: 'baseball', year: '2024', brand: 'Holiday', slug: '2024-topps-holiday-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-holiday-baseball-cards/' },
  { name: "2025 Bowman's Best Baseball", sport: 'baseball', year: '2025', brand: "Bowman's Best", slug: '2025-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2025-bowmans-best-baseball-cards/" },
  { name: "2024 Bowman's Best Baseball", sport: 'baseball', year: '2024', brand: "Bowman's Best", slug: '2024-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2024-bowmans-best-baseball-cards/" },
  // ── Football premium ──
  { name: '2025 Topps Chrome Black Football', sport: 'football', year: '2025', brand: 'Chrome Black', slug: '2025-topps-chrome-black-football-extra',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-black-football-cards/' },
  { name: '2023 Topps Chrome Football', sport: 'football', year: '2023', brand: 'Chrome', slug: '2023-topps-chrome-football',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-chrome-football-cards/' },
  { name: '2023 Bowman Chrome University Football', sport: 'football', year: '2023', brand: 'Bowman Chrome', slug: '2023-bowman-chrome-university-football',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-chrome-university-football-cards/' },
  // ── Basketball ──
  { name: '2025-26 Topps Chrome Basketball', sport: 'basketball', year: '2025', brand: 'Chrome', slug: '2025-26-topps-chrome-basketball',
    beckettUrl: 'https://www.beckett.com/news/2025-26-topps-chrome-basketball-cards/' },
  { name: '2024-25 Topps Chrome Basketball', sport: 'basketball', year: '2024', brand: 'Chrome', slug: '2024-25-topps-chrome-basketball',
    beckettUrl: 'https://www.beckett.com/news/2024-25-topps-chrome-basketball-cards/' },
  { name: '2023-24 Topps Chrome Basketball', sport: 'basketball', year: '2023', brand: 'Chrome', slug: '2023-24-topps-chrome-basketball',
    beckettUrl: 'https://www.beckett.com/news/2023-24-topps-chrome-basketball-cards/' },
  // ── Football ──
  { name: '2025 Topps Chrome Football', sport: 'football', year: '2025', brand: 'Chrome', slug: '2025-topps-chrome-football',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-football-cards/' },
  { name: '2024 Topps Chrome Football', sport: 'football', year: '2024', brand: 'Chrome', slug: '2024-topps-chrome-football',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-chrome-football-cards/' },
  { name: '2025 Topps Chrome Black Football', sport: 'football', year: '2025', brand: 'Chrome Black', slug: '2025-topps-chrome-black-football',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-black-football-cards/' },
  { name: '2025 Bowman Chrome University Football', sport: 'football', year: '2025', brand: 'Bowman Chrome', slug: '2025-bowman-chrome-university-football',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-chrome-university-football-cards/' },
  // ── Soccer ──
  { name: '2025-26 Topps Chrome UEFA Champions League', sport: 'soccer', year: '2025', brand: 'Chrome', slug: '2025-26-topps-chrome-ucl',
    beckettUrl: 'https://www.beckett.com/news/2025-26-topps-chrome-uefa-champions-league-cards/' },
  { name: '2025 Topps Chrome MLS', sport: 'soccer', year: '2025', brand: 'Chrome', slug: '2025-topps-chrome-mls',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-mls-cards/' },
  { name: '2024-25 Topps Chrome UEFA Club Competitions', sport: 'soccer', year: '2024', brand: 'Chrome', slug: '2024-25-topps-chrome-ucc',
    beckettUrl: 'https://www.beckett.com/news/2024-25-topps-chrome-uefa-club-competitions-cards/' },
  // ── Hockey ──
  { name: '2025-26 Topps Chrome Hockey', sport: 'hockey', year: '2025', brand: 'Chrome', slug: '2025-26-topps-chrome-hockey',
    beckettUrl: 'https://www.beckett.com/news/2025-26-topps-chrome-hockey-cards/' },
  { name: '2024-25 Topps Chrome Hockey', sport: 'hockey', year: '2024', brand: 'Chrome', slug: '2024-25-topps-chrome-hockey',
    beckettUrl: 'https://www.beckett.com/news/2024-25-topps-chrome-hockey-cards/' },
];

// ── TOPPS PDF TEXT PARSER ─────────────────────────────────────────────────────
function parseToppsChecklistText(text, meta) {
  const { slug, name, sport = 'baseball', year = '', brand = '' } = meta;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const result = {
    slug, set: name, name, sport, year, brand,
    release_date: year,
    set_size: 0,
    parallels: [],
    base_set: { count: 0, cards: [] },
    insert_sets: [],
    autograph_sets: [],
    memorabilia_sets: [],
  };

  // Section detection
  const SEC_BASE = /^BASE\s*(CARDS?|SET)?$/i;
  const SEC_INSERT = /^INSERTS?(\s+CARDS?|\s+SETS?)?$/i;
  const SEC_AUTO = /^AUTOGRAPH(S|ED)?(\s+CARDS?|\s+SETS?)?$/i;
  const SEC_RELIC = /^(RELIC|RELICS|MEMORABILIA|MEM)(\s+CARDS?|\s+SETS?)?$/i;
  const SEC_AUTO_RELIC = /^(AUTOGRAPH(ED)?|AUTO)\s+(RELIC|MEM)(S|ORABI[LA]+)?(\s+CARDS?)?$/i;

  // Skip sections (variations, short prints etc.)
  const SKIP_SECTION = /^(LIGHTBOARD|IMAGE VARIATION|SUPER SHORT PRINT|SHORT PRINT|PARALLEL|CHROME REFRACTOR VARIATION)/i;

  // Card line: optional prefix, then number, then name, then team (separated by 2+ spaces)
  // Examples: "1  Shohei Ohtani  Los Angeles Dodgers®"
  //           "RA-SS  Roki Sasaki  Seattle Mariners®  [Rookie]"
  //           "UV-1  Player Name  Team Name"
  const cardLine = (l) => {
    // Split on 2+ spaces or tabs
    const parts = l.split(/\s{2,}|\t+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    // First part: number (pure digits) or prefixed (XX-N or XX-XX)
    const numPart = parts[0];
    const isNum = /^\d+$/.test(numPart);
    const isPrefixed = /^[A-Z0-9]+-[A-Z0-9]+$/i.test(numPart);
    if (!isNum && !isPrefixed) return null;
    // Second part should look like a name (not all-caps multi-word → that's a header)
    const player = parts[1];
    if (!player || /^[A-Z\s&]{4,}$/.test(player)) return null; // all-caps = probably a header
    const team = parts[2] ? parts[2].replace(/[®™]/g, '').trim() : '';
    const rc = parts.some(p => /^\[?rookie\]?$/i.test(p));
    const note = parts.slice(3).filter(p => !/^\[?rookie\]?$/i.test(p)).join(' ') || '';
    return { number: numPart, player, team, rc, note: note || undefined };
  };

  let section = 'base';
  let inSkip = false;
  let currentSubset = null;  // { name, cards[] } in insert_sets or autograph_sets
  let currentCollection = null; // 'inserts' | 'autos' | 'mem' | 'auto_mem'

  const pushSubset = () => {
    if (!currentSubset) return;
    if (currentSubset.cards.length === 0) return;
    if (currentCollection === 'inserts') result.insert_sets.push(currentSubset);
    else if (currentCollection === 'autos') result.autograph_sets.push(currentSubset);
    else if (currentCollection === 'mem' || currentCollection === 'auto_mem') result.memorabilia_sets.push(currentSubset);
    currentSubset = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    // Major section headers
    if (SEC_BASE.test(l)) { pushSubset(); section = 'base'; inSkip = false; continue; }
    if (SEC_AUTO_RELIC.test(l)) { pushSubset(); section = 'auto_mem'; currentCollection = 'auto_mem'; inSkip = false; continue; }
    if (SEC_AUTO.test(l)) { pushSubset(); section = 'auto'; currentCollection = 'autos'; inSkip = false; continue; }
    if (SEC_RELIC.test(l)) { pushSubset(); section = 'mem'; currentCollection = 'mem'; inSkip = false; continue; }
    if (SEC_INSERT.test(l)) { pushSubset(); section = 'insert'; currentCollection = 'inserts'; inSkip = false; continue; }

    // Skip variation sub-sections
    if (SKIP_SECTION.test(l)) { inSkip = true; continue; }
    if (inSkip) {
      // Exit skip when we hit a card line or a new major section
      const c = cardLine(l);
      if (c) { inSkip = false; } else continue;
    }

    // Sub-section header in non-base sections (all-caps, no number prefix)
    if (section !== 'base' && /^[A-Z][A-Z\s\-&'/]{3,}$/.test(l) && !cardLine(l)) {
      pushSubset();
      currentSubset = { name: l, cards: [] };
      continue;
    }

    const card = cardLine(l);
    if (!card) continue;

    if (section === 'base') {
      const num = parseInt(card.number, 10);
      result.base_set.cards.push({ number: isNaN(num) ? card.number : num, player: card.player, team: card.team, rc: card.rc || undefined, note: card.note || undefined });
    } else {
      if (!currentSubset) {
        // Cards before any named subset — create a generic subset
        const defaultName = section === 'auto' ? 'Autographs' : section === 'mem' ? 'Relics' : section === 'auto_mem' ? 'Autograph Relics' : 'Inserts';
        currentSubset = { name: defaultName, cards: [] };
      }
      currentSubset.cards.push({ number: card.number, player: card.player, team: card.team, rc: card.rc || undefined, note: card.note || undefined });
    }
  }
  pushSubset();

  result.base_set.count = result.base_set.cards.length;
  result.set_size = result.base_set.cards.length;
  return result;
}

// ── TOPPS CHECKLISTS PAGE SCRAPER ─────────────────────────────────────────────
// Returns { ok, sets, status, error } instead of collapsing every failure to
// null/undefined -- a Worker fetch to a third-party site can fail for very
// different reasons (network error, bot-blocked, page moved, empty result),
// and callers need to tell those apart instead of guessing.
async function fetchToppsChecklistCatalogDetailed() {
  let res;
  try {
    res = await fetch('https://www.topps.com/pages/checklists', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'Network error reaching topps.com: ' + (e?.message || e) };
  }
  if (!res.ok) return { ok: false, status: res.status, error: `topps.com returned HTTP ${res.status}` };
  const html = await res.text();
  const sets = parseToppsChecklistsHtml(html);
  if (!sets.length) return { ok: false, status: res.status, error: 'Page loaded but no checklist links were found (topps.com may have changed its page markup)', htmlLength: html.length };
  return { ok: true, sets };
}

async function fetchToppsChecklistCatalog() {
  const result = await fetchToppsChecklistCatalogDetailed();
  return result.ok ? result.sets : null;
}

function parseToppsChecklistsHtml(html) {
  const sets = [];
  // Remove script/style blocks
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // Look for <a href="..."> tags — Topps links to PDFs (their CDN) or product pages
  const linkRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(clean)) !== null) {
    let url = m[1].trim();
    const rawName = m[2].replace(/<[^>]+>/g, '').replace(/[®™]/g, '').trim();
    if (!rawName || rawName.length < 8) continue;
    // Only take links that look like checklists (PDF, or Shopify files, or have year in name)
    const looksLikeChecklist = url.includes('.pdf') || url.includes('/files/') ||
      url.includes('checklist') || (/\d{4}/.test(rawName) && rawName.length > 10);
    if (!looksLikeChecklist) continue;
    // Skip nav/footer links
    if (/^(help|account|sign|cart|search|all-products|explore)/i.test(rawName)) continue;

    if (url.startsWith('/')) url = 'https://www.topps.com' + url;
    if (!url.startsWith('http')) continue;

    const { year, sport, brand } = guessSetMeta(rawName);
    const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    sets.push({ name: rawName, url, slug, sport, year, brand });
  }

  // Deduplicate by slug
  const seen = new Set();
  return sets.filter(s => { if (seen.has(s.slug)) return false; seen.add(s.slug); return true; });
}

function guessSetMeta(name) {
  const n = name.toLowerCase();
  const yearM = name.match(/(\d{4})/);
  const year = yearM ? yearM[1] : '';

  let sport = 'baseball';
  if (/basketball|nba/i.test(n)) sport = 'basketball';
  else if (/football|nfl|gridiron/i.test(n)) sport = 'football';
  else if (/soccer|mls|ucl|uefa|laliga|bundesliga|premier/i.test(n)) sport = 'soccer';
  else if (/hockey|nhl/i.test(n)) sport = 'hockey';
  else if (/star wars|marvel|disney|entertainment|non-sport/i.test(n)) sport = 'non-sport';

  let brand = 'Topps';
  if (/bowman chrome/i.test(n)) brand = 'Bowman Chrome';
  else if (/bowman's best/i.test(n)) brand = "Bowman's Best";
  else if (/bowman draft/i.test(n)) brand = 'Bowman Draft';
  else if (/bowman/i.test(n)) brand = 'Bowman';
  else if (/chrome.*black|black.*chrome/i.test(n)) brand = 'Chrome Black';
  else if (/cosmic chrome/i.test(n)) brand = 'Cosmic Chrome';
  else if (/chrome/i.test(n)) brand = 'Chrome';
  else if (/heritage/i.test(n)) brand = 'Heritage';
  else if (/finest/i.test(n)) brand = 'Finest';
  else if (/allen.*ginter|ginter/i.test(n)) brand = 'Allen & Ginter';
  else if (/stadium club/i.test(n)) brand = 'Stadium Club';
  else if (/archives/i.test(n)) brand = 'Archives';
  else if (/update/i.test(n)) brand = 'Topps Update';
  else if (/brooklyn/i.test(n)) brand = 'Brooklyn Collection';
  else if (/star wars|marvel/i.test(n)) brand = 'Entertainment';

  return { year, sport, brand };
}

// ── PDF TEXT EXTRACTOR ────────────────────────────────────────────────────────
async function decompressRaw(data) {
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(data);
    writer.close();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } catch (_) {
    // Try with zlib wrapper (2-byte zlib header)
    try {
      const ds2 = new DecompressionStream('deflate');
      const writer2 = ds2.writable.getWriter();
      const reader2 = ds2.readable.getReader();
      writer2.write(data);
      writer2.close();
      const chunks2 = [];
      while (true) {
        const { done, value } = await reader2.read();
        if (done) break;
        chunks2.push(value);
      }
      const total2 = chunks2.reduce((a, c) => a + c.length, 0);
      const out2 = new Uint8Array(total2);
      let off2 = 0;
      for (const c of chunks2) { out2.set(c, off2); off2 += c.length; }
      return out2;
    } catch (_2) { return null; }
  }
}

function pdfUnescapeStr(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

function pdfHexToStr(hex) {
  let s = '';
  // Handle UTF-16BE (common in PDFs with BOM FEFF)
  if (hex.startsWith('feff') || hex.startsWith('FEFF')) {
    for (let i = 4; i < hex.length; i += 4) {
      s += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16));
    }
    return s;
  }
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return s;
}

function extractTextFromContentStream(content) {
  const lines = [];
  const btEtRe = /BT([\s\S]*?)ET/g;
  let m;
  while ((m = btEtRe.exec(content)) !== null) {
    const block = m[1];
    const partRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|TJ)|\[([\s\S]*?)\]\s*TJ/g;
    let pm;
    while ((pm = partRe.exec(block)) !== null) {
      if (pm[1] !== undefined) {
        lines.push(pdfUnescapeStr(pm[1]));
      } else if (pm[2]) {
        const arr = pm[2];
        const parts = [];
        const innerRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)|<([0-9a-fA-F]+)>/g;
        let im;
        while ((im = innerRe.exec(arr)) !== null) {
          if (im[1] !== undefined) parts.push(pdfUnescapeStr(im[1]));
          else if (im[2]) parts.push(pdfHexToStr(im[2]));
        }
        if (parts.length) lines.push(parts.join(''));
      }
    }
    lines.push(''); // paragraph break between BT/ET blocks
  }
  return lines.filter(Boolean).join('\n');
}

async function extractPdfText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  // Build latin-1 string for regex parsing
  let raw = '';
  for (let i = 0; i < Math.min(bytes.length, 20 * 1024 * 1024); i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const allText = [];

  // Find all objects to check for streams
  const objRe = /(\d+\s+\d+\s+obj[\s\S]*?)endobj/g;
  let om;
  while ((om = objRe.exec(raw)) !== null) {
    const obj = om[1];
    const streamMatch = obj.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (!streamMatch) continue;

    const isFlate = /FlateDecode/i.test(obj) || /\/Fl\b/.test(obj);
    const isText = !/\/Subtype\s*\/Image/i.test(obj) && !/\/XObject/i.test(obj);
    if (!isText) continue;

    let content;
    if (isFlate) {
      const streamStr = streamMatch[1];
      const streamBytes = new Uint8Array(streamStr.length);
      for (let i = 0; i < streamStr.length; i++) streamBytes[i] = streamStr.charCodeAt(i) & 0xff;
      const decompressed = await decompressRaw(streamBytes);
      if (!decompressed) continue;
      content = new TextDecoder('latin1').decode(decompressed);
    } else {
      content = streamMatch[1];
    }

    const text = extractTextFromContentStream(content);
    if (text && text.trim().length > 10) allText.push(text);
  }

  // Also try direct BT/ET extraction on raw (for uncompressed PDFs)
  if (allText.length === 0) {
    const directText = extractTextFromContentStream(raw);
    if (directText.trim()) allText.push(directText);
  }

  return allText.join('\n');
}
