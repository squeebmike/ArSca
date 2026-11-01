// Morning health summary (store, 2026-11-01: "do the morning health
// summary"). One email at 7 AM Pacific saying whether the overnight jobs ran:
// comic/sports and Pokemon price updates, Whatnot, eBay sale checks, plus
// yesterday's sales and orders waiting. Problems come first.
//
// Why: PriceCharting refused every price update (HTTP 429) for about 12 hours
// on 2026-10-31/11-01 and nobody noticed until asked.

export const MORNING_HOUR = 7; // Pacific
const HOUR = 3600000;
const usd = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const ago = (at, now) => { const m = Math.round((now - Date.parse(at)) / 60000); return !Number.isFinite(m) ? 'never' : m < 90 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
const pacificTime = at => new Date(at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

// A job's "last ran / last problem" note (KV job-health:<name>). Written when
// the state changes, or at most hourly, so a job every 10 minutes costs ~24
// writes a day.
export function nextJobHealth(before, error, now = Date.now(), detail = null) {
  const ok = !error;
  const prev = before && typeof before === 'object' ? before : null;
  const next = { at: new Date(now).toISOString(), ok, ...(ok ? {} : { error: String(error).slice(0, 200) }), ...(detail ? { detail } : {}),
    lastOkAt: ok ? new Date(now).toISOString() : prev?.lastOkAt || null,
    failingSince: ok ? null : (prev && !prev.ok && prev.failingSince) || new Date(now).toISOString() };
  const write = !prev || prev.ok !== ok || (!ok && prev.error !== next.error) || now - Date.parse(prev.at || 0) >= 50 * 60000;
  return { write, value: next };
}

// data: { now, storeName, priceRuns:[{started_at,result}], whatnotLast, whatnotRuns,
//   health:{ebay, pokemon}, payments:[{provider,method,amount}], openWebOrders, reviewWaiting, day }
export function buildMorningHealth(data) {
  const now = data.now ?? Date.now();
  const problems = [], lines = [];

  // Comic + sports prices (PriceCharting).
  const runs = (data.priceRuns || []).filter(r => r?.result && !r.result.skipped);
  const sum = k => runs.reduce((n, r) => n + (Number(r.result[k]) || 0), 0);
  const refused = runs.filter(r => r.result.stopReason);
  const latest = runs.slice().sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  lines.push('COMIC + SPORTS PRICES (PriceCharting)');
  if (!runs.length) { lines.push('  No runs in the last 24 hours.'); problems.push('Comic/sports price updates did not run in the last 24 hours.'); }
  else {
    lines.push(`  ${runs.length} runs · ${sum('checked')} checked · ${sum('applied')} updated · ${sum('review')} waiting for review · ${sum('coverPrice')} given a cover-price default`);
    if (latest) lines.push(`  ${Number(latest.result.left) || 0} still to check today`);
    if (refused.length) {
      const why = String(refused[0].result.stopReason || '').replace(/^PriceCharting unavailable:\s*/, '');
      lines.push(`  Stopped early on ${refused.length} of ${runs.length} runs: ${why}`);
      if (refused.length >= Math.max(2, runs.length / 2)) problems.push(`PriceCharting refused most comic/sports price updates (${refused.length} of ${runs.length} runs): ${why}.`);
    }
    const needs = runs.reduce((n, r) => n + (Number(r.result.needsPrice) || 0), 0);
    if (needs) lines.push(`  ${needs} comic${needs === 1 ? '' : 's'} with no price and no cover price -- set one in the dashboard`);
  }
  if (data.reviewWaiting) lines.push(`  ${data.reviewWaiting} price change${data.reviewWaiting === 1 ? '' : 's'} waiting in PRICE SYNC`);

  // Pokemon prices.
  const poke = data.health?.pokemon;
  lines.push('', 'POKEMON PRICES (PokemonPriceTracker)');
  if (!poke) lines.push('  No run recorded yet.');
  else {
    const d = poke.detail || {};
    lines.push(`  Last ran ${ago(poke.at, now)}${d.checked != null ? ` · ${d.checked} checked in that batch` : ''}${d.note ? ' · ' + d.note : ''}`);
    if (!poke.ok) { lines.push('  Problem: ' + poke.error); problems.push('Pokemon price updates: ' + poke.error); }
  }

  // Whatnot.
  lines.push('', 'WHATNOT');
  const wl = data.whatnotLast;
  if (!data.whatnotConnected) lines.push('  Not connected.');
  else if (!wl?.at) { lines.push('  No sync recorded.'); problems.push('Whatnot sync has not run.'); }
  else {
    const late = now - Date.parse(wl.at) > 40 * 60000;
    lines.push(`  Last sync ${ago(wl.at, now)}${late ? ' -- it runs every 10 minutes' : ''}`);
    if (late) problems.push(`Whatnot sync last ran ${ago(wl.at, now)} (it runs every 10 minutes).`);
    const errs = [wl.listingsError, wl.ordersError, wl.showsError, wl.shipmentsError].filter(Boolean);
    if (errs.length) { lines.push('  Problem: ' + errs[0]); problems.push('Whatnot sync: ' + errs[0]); }
    const recorded = (data.whatnotRuns || []).reduce((n, r) => n + ((r.result?.orders || []).length), 0);
    if (recorded) lines.push(`  ${recorded} order${recorded === 1 ? '' : 's'} recorded by the sync in the last 24 hours`);
  }

  // eBay.
  const eb = data.health?.ebay;
  lines.push('', 'EBAY SALE CHECKS');
  if (!eb) lines.push('  No check recorded yet.');
  else {
    const late = now - Date.parse(eb.at) > 2 * HOUR && eb.ok;
    lines.push(`  Last check ${ago(eb.at, now)}${eb.ok ? '' : ' -- failing' + (eb.failingSince ? ' since ' + pacificTime(eb.failingSince) : '')}`);
    if (!eb.ok) { lines.push('  Problem: ' + eb.error); problems.push('eBay sale checks: ' + eb.error); }
    else if (late) problems.push(`eBay sale checks last ran ${ago(eb.at, now)} (they run every 10 minutes).`);
  }

  // Yesterday's sales.
  lines.push('', `SALES ${data.day ? '(' + data.day + ')' : 'YESTERDAY'}`);
  const byChannel = {};
  for (const p of data.payments || []) {
    const ch = String(p.provider || p.method || 'other').toLowerCase();
    const label = { whatnot: 'Whatnot', ebay: 'eBay', stripe: 'Website / card', cash: 'Cash', card: 'Card', shopify: 'Shopify' }[ch] || ch;
    (byChannel[label] ||= { n: 0, total: 0 }); byChannel[label].n++; byChannel[label].total += Number(p.amount) || 0;
  }
  const chans = Object.entries(byChannel).sort((a, b) => b[1].total - a[1].total);
  if (!chans.length) lines.push('  No sales recorded.');
  else {
    for (const [label, v] of chans) lines.push(`  ${label}: ${v.n} · ${usd(v.total)}`);
    lines.push(`  Total: ${usd(chans.reduce((n, [, v]) => n + v.total, 0))}`);
  }

  // Orders waiting.
  lines.push('', 'ORDERS WAITING');
  lines.push(`  Website orders not fulfilled: ${data.openWebOrders || 0}`);
  if ((data.oldWebOrders || 0) > 0) problems.push(`${data.oldWebOrders} paid website order${data.oldWebOrders === 1 ? '' : 's'} over 2 days old and not fulfilled.`);

  const head = problems.length ? `${problems.length} thing${problems.length === 1 ? '' : 's'} need a look` : 'All good';
  const subject = `Morning check: ${head}${data.storeName ? ' -- ' + data.storeName : ''}`;
  const body = [
    problems.length ? 'NEEDS A LOOK' : 'Everything ran overnight.',
    ...problems.map(p => '  • ' + p),
    '',
    ...lines,
    '',
    `Sent ${pacificTime(now)} Pacific by the store's server.`,
  ].join('\n');
  return { subject, body, problems };
}
