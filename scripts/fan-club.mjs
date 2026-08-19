// Free "get notified" list for Walk-Off Publishing's in-progress original
// comics (ShatterKid, Bone Grice). /fan-club used to have three paid-pledge
// forms (Supporter $5/mo, Patron $15/mo, one-time pledge) with no backend
// route and no frontend handler behind any of them -- nobody who clicked
// "Join as Supporter" ever actually joined anything. This replaces all
// three with one free email signup.
//
// This is CAN-SPAM territory, not Twilio/A2P (no phone number is
// collected) -- the one hard requirement that matters here is a working
// unsubscribe link on anything ever sent to this list, which is what
// unsubscribe_token exists for.

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function subscribe(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const storeId = text(limited.data?.storeId, 80);
  const email = text(limited.data?.email, 254).toLowerCase();
  if (!storeId || !EMAIL_RE.test(email)) return deps.json({ ok:false, error:'Enter a valid email address.' }, 400);
  const rateError = await deps.enforceUsageLimit(env, `fan-club-subscribe:${storeId}`, 50, 3600);
  if (rateError) return rateError;
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data:existing } = await db(`fan_club_subscribers?store_id=eq.${encodeURIComponent(storeId)}&email=eq.${encodeURIComponent(email)}&limit=1`);
  if (existing?.length) {
    if (existing[0].unsubscribed) {
      await db(`fan_club_subscribers?id=eq.${encodeURIComponent(existing[0].id)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ unsubscribed:false, unsubscribed_at:null, subscribed_at:new Date().toISOString() }) });
    }
    return deps.json({ ok:true, alreadySubscribed:true });
  }
  await db('fan_club_subscribers', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ store_id:storeId, email, source:'fan-club-page' }) });
  return deps.json({ ok:true, alreadySubscribed:false });
}

async function unsubscribe(request, env, deps, url) {
  const token = text(url.searchParams.get('token'), 80);
  if (!token) return new Response('Missing unsubscribe token.', { status:400 });
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data:rows } = await db(`fan_club_subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}&limit=1`);
  const row = rows?.[0];
  if (!row) return new Response('That unsubscribe link is no longer valid.', { status:404 });
  await db(`fan_club_subscribers?id=eq.${encodeURIComponent(row.id)}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ unsubscribed:true, unsubscribed_at:new Date().toISOString() }) });
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="font-family:-apple-system,sans-serif;background:#0b0d10;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center">' +
    '<div><h1 style="margin-bottom:8px">You’re unsubscribed</h1><p style="opacity:.7">You will not receive any more fan club emails from The Mana Pocket.</p></div></body></html>',
    { status:200, headers:{ 'Content-Type':'text/html;charset=utf-8' } },
  );
}

export async function handleFanClubRequest(request, env, url, deps) {
  const path = url.pathname;
  if (path === '/public/fan-club/subscribe' && request.method === 'POST') return subscribe(request, env, deps);
  if (path === '/public/fan-club/unsubscribe' && request.method === 'GET') return unsubscribe(request, env, deps, url);
  return deps.json({ ok:false, error:'Fan club route not found' }, 404);
}
