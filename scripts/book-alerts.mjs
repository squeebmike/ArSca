import { comicKey, bookStatus } from './comic-articles.mjs';

const API = 'https://still-resonance-4f87.swarnerauto.workers.dev';
const SITE = 'https://themanapocket.com';
const TABLE = 'book_alert_subscriptions';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['preorder_open','preorder_cutoff','in_stock']);
const enc = encodeURIComponent;
const iso = n => new Date(n).toISOString();

// The verified Auth email is the ownership boundary, never a client email.
export async function handleAccountBookAlerts(request,env,url,deps) {
  const auth = await deps.requireAuthenticatedUser(request,env);
  if (auth.error) return auth.error;
  if (!auth.user.email || !auth.user.email_confirmed_at) return deps.json({ok:false,error:'Verify your account email to manage book alerts.'},403);
  const email = auth.user.email.trim().toLowerCase();
  const scope = `store_id=eq.${enc(deps.storeId)}&email=eq.${enc(email)}`;
  if (request.method === 'GET') {
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) return deps.json({ok:false,error:'Invalid page.'},400);
    const rows = await db(env,deps,`${TABLE}?${scope}&select=id,book,event,status,created_at,sent_at&order=created_at.desc,id.asc&limit=51&offset=${offset}`);
    const response = deps.json({ok:true,alerts:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null});
    response.headers.set('Cache-Control','private, no-store');
    return response;
  }
  if (request.method === 'PATCH') {
    const limited = await deps.readJsonWithLimit(request,1024);
    if (limited.error) return limited.error;
    const id = String(limited.data?.id || '');
    if (!UUID.test(id)) return deps.json({ok:false,error:'Invalid alert.'},400);
    const rows = await db(env,deps,`${TABLE}?${scope}&id=eq.${enc(id)}&status=in.(active,checking,sending)`,{
      method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'unsubscribed',lease_token:null,lease_until:null}),
    });
    return deps.json({ok:!!rows?.length,...(!rows?.length?{error:'Alert unavailable or already stopped.'}:{})},rows?.length?200:404);
  }
  return deps.json({ok:false,error:'Method not allowed.'},405);
}

export function validateBookAlert(body, storeId) {
  const book = String(body.book || '').trim();
  const email = String(body.contactEmail || '').trim().toLowerCase();
  if (body.storeId !== storeId) throw new Error('This store is not available.');
  if (body.consent !== true) throw new Error('Please agree to receive this book alert.');
  if (book.length < 2 || book.length > 200 || /[\r\n<>]/.test(book) || !comicKey(book).series) throw new Error('Choose a valid book title.');
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!EVENTS.has(body.event)) throw new Error('Choose an available alert.');
  const key = comicKey(book);
  return { store_id: storeId, book, book_key: `${key.series}#${key.issue}`, email, event: body.event };
}

async function db(env, deps, path, options) {
  const result = await deps.supabaseAdminFetch(env, path, options);
  if (result.response && !result.response.ok) throw new Error('Book alert database unavailable');
  return result.data;
}
async function settings(env, deps, storeId) {
  const rows = await db(env, deps, `store_settings?store_id=eq.${enc(storeId)}&select=receipt_settings&limit=1`);
  return rows?.[0]?.receipt_settings;
}
async function optedOut(env, deps, row) {
  const contacts = await db(env, deps, `email_notify_contacts?store_id=eq.${enc(row.store_id)}&email=eq.${enc(row.email)}&select=opted_out&limit=1`);
  if (!Array.isArray(contacts)) throw new Error('Email preferences unavailable');
  return contacts.some(c => c.opted_out);
}

export async function handleBookAlertRequest(request, env, url, deps) {
  if (url.pathname === '/public/book-alerts' && request.method === 'POST') {
    const limited = await deps.readJsonWithLimit(request,4096);
    if (limited.error) return limited.error;
    let row;
    try { row = validateBookAlert(limited.data || {}, deps.storeId); }
    catch (e) { return deps.json({ok:false,error:e.message},400); }
    const rate = await deps.enforceUsageLimit(env,`book-alert:${request.headers.get('CF-Connecting-IP') || 'unknown'}`,5,300);
    if (rate) return rate;
    try {
      if ((await settings(env,deps,row.store_id))?.storefrontEnabled !== true) return deps.json({ok:false,error:'Storefront is unavailable.'},503);
      if (!deps.emailReady(env)) return deps.json({ok:false,error:'Email alerts are temporarily unavailable.'},503);
      // Never override a prior global opt-out from an unauthenticated form.
      // Return the same receipt so this endpoint cannot enumerate preferences.
      if (!await optedOut(env,deps,row)) {
        await db(env,deps,`${TABLE}?on_conflict=store_id,email,book_key,event`,{
          method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(row),
        });
      }
      return deps.json({ok:true,message:'Request received. If eligible, you will receive one email when this update is available. Previous email opt-outs remain in effect.'});
    } catch (e) {
      console.error('Book alert signup unavailable');
      return deps.json({ok:false,error:'Your alert could not be saved. Please try again.'},503);
    }
  }
  if (url.pathname === '/public/book-alerts/unsubscribe') {
    const token = url.searchParams.get('token') || '';
    if (!UUID.test(token)) return new Response('Invalid unsubscribe link.',{status:400});
    if (request.method === 'POST') {
      await db(env,deps,`${TABLE}?unsubscribe_token=eq.${enc(token)}`,{method:'PATCH',body:JSON.stringify({status:'unsubscribed',lease_token:null,lease_until:null})});
      return unsubscribePage('This book alert has been stopped.','');
    }
    if (request.method === 'GET') return unsubscribePage('Stop this book alert?',`<form method="post"><button>Unsubscribe from this book alert</button></form>`);
    return new Response('Method not allowed',{status:405});
  }
  return null;
}
function unsubscribePage(title,body) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Book alerts | The Mana Pocket</title></head><body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:20px"><h1>${title}</h1>${body}<p><a href="${SITE}/comics/search">Back to comics</a></p></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}

export function alertDue(event,status,now=Date.now()) {
  if (event === 'in_stock') return status.state === 'in_stock';
  if (status.state !== 'preorder') return false;
  const until = Date.parse(status.cutoff)-now;
  return until > 0 && (event === 'preorder_open' || (event === 'preorder_cutoff' && until <= 48*3600000));
}
export function alertMessage(row,status,address) {
  const label = row.event === 'in_stock' ? 'is in stock' : row.event === 'preorder_open' ? 'is open for preorder' : 'has a preorder cutoff coming up';
  const target = new URL(status.href,SITE);
  if (target.origin !== SITE || !/^\/(item|preorder)\//.test(target.pathname)) throw new Error('Invalid book destination');
  const deadline = row.event !== 'in_stock' && status.cutoff
    ? '\nOrder by '+new Date(status.cutoff).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'})+'.' : '';
  return {subject:`${row.book} ${label}`,text:`${row.book} ${label}.${deadline}\n\nSee covers, current availability and ordering options:\n${target.href}\n\nYou asked The Mana Pocket for this one-time book alert. Availability can change; this email does not reserve a copy.\n\n${address}\nStop this book alert: ${API}/public/book-alerts/unsubscribe?token=${enc(row.unsubscribe_token)}`};
}

async function updateClaim(env,deps,row,values,status='checking') {
  return db(env,deps,`${TABLE}?id=eq.${enc(row.id)}&lease_token=eq.${enc(row.lease_token)}&status=eq.${status}`,{
    method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(values),
  });
}

export async function runBookAlerts(env,deps,now=Date.now()) {
  if (!deps.emailReady(env)) return {disabled:true};
  const rows = await db(env,deps,'rpc/claim_book_alerts',{method:'POST',body:JSON.stringify({batch_size:100})});
  const totals = {checked:0,sent:0,deferred:0,uncertain:0};
  // Bounded work; the database orders by next check so later subscriptions
  // cannot be starved by titles that have not opened yet.
  for (const row of rows || []) {
    let sending = false;
    try {
      const config = await settings(env,deps,row.store_id);
      if (await optedOut(env,deps,row)) {
        await updateClaim(env,deps,row,{status:'unsubscribed',lease_until:null});
        continue;
      }
      if (config?.storefrontEnabled !== true) throw new Error('Store unavailable');
      const status = await bookStatus(env,{...deps,storeId:row.store_id,strict:true},row.book,now);
      totals.checked++;
      if (!alertDue(row.event,status,now)) {
        await updateClaim(env,deps,row,{status:'active',next_check_at:iso(now+6*3600000),lease_until:null,last_error:null});
        continue;
      }
      const origin = config.shippingOrigin;
      if (!deps.completeShippoOrigin(origin)) throw new Error('Sender address unavailable');
      const address = `${origin.name || 'The Mana Pocket'}, ${origin.street1}${origin.street2 ? ', '+origin.street2 : ''}, ${origin.city}, ${origin.state} ${origin.zip}`;
      if (!UUID.test(row.unsubscribe_token)) throw new Error('Unsubscribe unavailable');
      const message = alertMessage(row,status,address);
      // Recheck opt-out immediately before the atomic send claim. A cancelled
      // or reclaimed subscription cannot pass this compare-and-set.
      if (await optedOut(env,deps,row)) {
        await updateClaim(env,deps,row,{status:'unsubscribed',lease_until:null});
        continue;
      }
      const claimed = await updateClaim(env,deps,row,{status:'sending',last_error:null});
      if (!claimed?.length) continue;
      sending = true;
      await deps.sendEmail(env,row.email,message.subject,message.text);
      await updateClaim(env,deps,row,{status:'sent',sent_at:iso(now),lease_until:null},'sending');
      totals.sent++;
    } catch (e) {
      // Do not log customer email, tokens, or provider payloads.
      console.error('Book alert check failed',{id:row.id,phase:sending?'delivery':'check'});
      if (sending) {
        totals.uncertain++;
        await updateClaim(env,deps,row,{last_error:'Delivery needs review; not retried automatically.'},'sending').catch(()=>{});
      } else {
        totals.deferred++;
        await updateClaim(env,deps,row,{status:'active',next_check_at:iso(now+6*3600000),lease_until:null,last_error:'Check unavailable; will retry.'}).catch(()=>{});
      }
    }
  }
  console.log('Book alert sweep',totals);
  return totals;
}
