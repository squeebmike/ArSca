// ── Buy signal ──
// Store ask: "a buy it or not thing ... it explains why it's a buy or pass,
// and then a quick buy or not next to prices. Can it help us not buy bad
// cards?" This answers a dealer's question, not a collector's: if we pay
// this today, can we resell it for more, soon, after fees? It reads only
// facts -- the card's own price history (the same series its chart draws),
// how many sell, what we already hold and what we've sold -- and every rule
// is a plain threshold below, so a verdict always comes with its reasons.
// Nothing here predicts prices; it flags the buys that usually go wrong
// (chasing a spike, catching a card still falling, slow sellers, thin
// margins, piling up stock). backtestBuySignal() checks the rules against
// history: PASS cards should do worse over the next 30 days than BUY cards.
(function(root){
  'use strict';

  const RULES = {
    minPoints: 12,          // fewer price points than this -> not enough data
    minSpanDays: 21,        // history must cover at least this many days
    spikePct: 30,           // up this much in 14 days = hype, wait
    fallingPct: -10,        // down this much in 30 days ...
    newLowDays: 3,          // ... and set a 30-day low this recently = still falling
    softFallPct: -4,        // a milder 30-day slide = pay a little less
    bottomFromHighPct: -8,  // down this far from the 30-day high ...
    bottomQuietDays: 7,     // ... with no new low for this long = fall has stalled
    volatileCv: 0.15,       // 30-day price swings above this = pay less
    slowPerWeek: 3,         // fewer sales a week than this = slow seller
    deadPerWeek: 0.75,      // fewer than this = very hard to resell
    stockSoft: 1,           // already holding this many = pay less
    stockHard: 4,           // holding this many = pass
    feePct: 13.25,          // marketplace fees on resale
    feeFixed: 0.40,
    minProfit: 3,           // what a resale must clear at our price
    stepPct: 5,             // extra discount (points of buy %) per soft flag
    minBuyPct: 15,          // never suggest less than this % of market
  };

  const DAY = 86400000;
  const round2 = n => Math.round(Number(n || 0) * 100) / 100;
  const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : 0);

  function toTime(v){
    if(v == null || v === '') return NaN;
    if(typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if(/^\d+$/.test(String(v))) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
    return new Date(v).getTime();
  }

  // One point per day (the last one), oldest first, prices > 0.
  function cleanPoints(points){
    const byDay = new Map();
    for(const p of Array.isArray(points) ? points : []){
      const raw = Array.isArray(p) ? { date:p[0], price:p[1], volume:p[2] } : (p || {});
      const t = toTime(raw.date ?? raw.timestamp ?? raw.t ?? raw.recordedAt);
      const price = Number(raw.price ?? raw.market ?? raw.marketPrice ?? raw.value ?? raw.p ?? raw.avg ?? 0);
      if(!Number.isFinite(t) || !(price > 0)) continue;
      const day = Math.floor(t / DAY);
      const volume = Number(raw.volume ?? raw.sales ?? raw.count ?? raw.v);
      byDay.set(day, { day, t:day * DAY, price, volume:Number.isFinite(volume) && volume >= 0 ? volume : null });
    }
    return [...byDay.values()].sort((a, b) => a.day - b.day);
  }

  // Price on or just before `day` (null if history doesn't reach back that far).
  function priceAt(pts, day){
    let found = null;
    for(const p of pts){ if(p.day <= day) found = p; else break; }
    return found ? found.price : null;
  }

  function metricsFor(pts, market){
    const last = pts[pts.length - 1];
    const today = last.day;
    const price = market > 0 ? market : last.price;
    const back = d => priceAt(pts, today - d);
    const w30 = pts.filter(p => p.day > today - 30);
    const prices30 = w30.map(p => p.price);
    const hi30 = Math.max(...prices30), lo30 = Math.min(...prices30);
    const lowPoint = [...w30].reverse().find(p => p.price === lo30);
    const mean30 = prices30.reduce((a, b) => a + b, 0) / prices30.length;
    const sd30 = Math.sqrt(prices30.reduce((a, b) => a + (b - mean30) ** 2, 0) / prices30.length);
    const vols = w30.map(p => p.volume).filter(v => v != null);
    const p7 = back(7), p14 = back(14), p30 = back(30), p90 = back(90);
    return {
      price, last:last.price, asOfDay:today,
      chg7:p7 ? pct(last.price, p7) : null,
      chg14:p14 ? pct(last.price, p14) : null,
      chg30:p30 ? pct(last.price, p30) : null,
      chg90:p90 ? pct(last.price, p90) : null,
      hi30, lo30, offHigh30:pct(last.price, hi30),
      daysSinceLow:lowPoint ? today - lowPoint.day : null,
      cv30:mean30 > 0 ? sd30 / mean30 : 0,
      // Daily sales volume, when the source reports it (TCGplayer via
      // PokemonPriceTracker does). Scaled from the days we actually have.
      perWeek:vols.length >= 7 ? vols.reduce((a, b) => a + b, 0) / vols.length * 7 : null,
      points:pts.length, spanDays:today - pts[0].day,
    };
  }

  const money = n => '$' + round2(n).toFixed(2);
  const fmtPct = n => (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%';
  const absPct = n => Math.abs(Number(n)).toFixed(1) + '%';

  // inputs: { points, market, buyPct, stockQty, ourSales:{soldCount,avgDays,avgProfit}, wants, rules }
  function evaluateBuySignal(input = {}){
    const R = { ...RULES, ...(input.rules || {}) };
    const pts = cleanPoints(input.points);
    const buyPct = Math.max(1, Math.min(100, Number(input.buyPct) || 60));
    const stockQty = Math.max(0, Number(input.stockQty) || 0);
    const market = Number(input.market) || (pts.length ? pts[pts.length - 1].price : 0);
    const reasons = [], flags = [];
    const say = (tone, text) => reasons.push({ tone, text });
    if(!(market > 0)) return { verdict:'NO_DATA', label:'NO PRICE', maxPrice:0, reasons:[{ tone:'info', text:'No market price to judge from.' }], flags, metrics:null };

    // Margin: what a resale clears at our normal buy price.
    const resaleNet = market * (1 - R.feePct / 100) - R.feeFixed;
    const normalPrice = market * buyPct / 100;
    const profitAtNormal = resaleNet - normalPrice;

    const enough = pts.length >= R.minPoints && (pts[pts.length - 1].day - pts[0].day) >= R.minSpanDays;
    const m = enough ? metricsFor(pts, market) : null;
    let extra = 0, hard = false;

    if(m){
      // Hype: a fast run-up usually gives some back.
      if(m.chg14 != null && m.chg14 >= R.spikePct){
        hard = true; flags.push('spike');
        say('bad', `Up ${absPct(m.chg14)} in 14 days -- buying into a spike. Wait for it to cool off.`);
      }
      // Still falling: down a lot and still making new lows.
      const stillFalling = m.chg30 != null && m.chg30 <= R.fallingPct && m.daysSinceLow != null && m.daysSinceLow <= R.newLowDays;
      // Bottoming: well off the high, but no new low for a while.
      const bottoming = !stillFalling && m.offHigh30 <= R.bottomFromHighPct && m.daysSinceLow != null && m.daysSinceLow >= R.bottomQuietDays && (m.chg7 == null || m.chg7 >= -1);
      if(stillFalling){
        flags.push('falling'); extra += Math.min(20, Math.max(R.stepPct, Math.abs(m.chg30)));
        say('bad', `Down ${absPct(m.chg30)} in 30 days and set a new 30-day low ${m.daysSinceLow === 0 ? 'today' : m.daysSinceLow + ' day' + (m.daysSinceLow === 1 ? '' : 's') + ' ago'} -- still falling. Only buy priced for where it's heading.`);
      } else if(bottoming){
        flags.push('bottoming');
        say('good', `${absPct(m.offHigh30)} below its 30-day high, but no new low in ${m.daysSinceLow} days -- the fall looks like it has stalled.`);
      } else if(m.chg30 != null && m.chg30 <= R.softFallPct){
        flags.push('sliding'); extra += R.stepPct;
        say('warn', `Down ${absPct(m.chg30)} in 30 days.`);
      }
      if(m.chg30 != null && m.chg30 > R.softFallPct && m.chg30 < R.spikePct && !flags.includes('spike')){
        if(m.chg30 >= 5) say('good', `Up ${absPct(m.chg30)} in 30 days without a spike.`);
        else if(!flags.includes('sliding')) say('good', `Steady: ${fmtPct(m.chg30)} over 30 days.`);
      }
      if(m.cv30 >= R.volatileCv){
        flags.push('volatile'); extra += R.stepPct;
        say('warn', `Price swings a lot (about ±${Math.round(m.cv30 * 100)}% over 30 days) -- leave room.`);
      }
      if(m.perWeek != null){
        if(m.perWeek < R.deadPerWeek){
          hard = true; flags.push('dead');
          say('bad', `Barely sells: about ${m.perWeek.toFixed(1)} a week on TCGplayer. Hard to flip.`);
        } else if(m.perWeek < R.slowPerWeek){
          flags.push('slow'); extra += R.stepPct;
          say('warn', `Slow seller: about ${m.perWeek.toFixed(1)} a week.`);
        } else {
          say('good', `Sells about ${Math.round(m.perWeek)} a week -- easy to move.`);
        }
      }
    } else {
      say('info', `Not enough price history to read the trend (${pts.length} point${pts.length === 1 ? '' : 's'}). Judge by margin and your own sales.`);
    }

    // What we already hold and what we've sold before.
    if(stockQty >= R.stockHard){
      hard = true; flags.push('overstocked');
      say('bad', `You already have ${stockQty} in stock.`);
    } else if(stockQty >= R.stockSoft){
      flags.push('stocked'); extra += R.stepPct;
      say('warn', `You already have ${stockQty} in stock.`);
    }
    const ours = input.ourSales || null;
    if(ours && Number(ours.soldCount) > 0){
      const days = ours.avgDays != null ? `, in about ${Math.max(1, Math.round(ours.avgDays))} days on average` : '';
      say('good', `You've sold ${ours.soldCount} of these before${days}.`);
    }
    if(Number(input.wants) > 0) say('good', `${input.wants} customer want${input.wants === 1 ? '' : 's'} on the want list.`);

    // Thin margin: fees and time eat a cheap card.
    if(profitAtNormal < R.minProfit){
      flags.push('thin');
      say(resaleNet - market * R.minBuyPct / 100 < R.minProfit ? 'bad' : 'warn', `Resale clears about ${money(resaleNet)} after fees -- under ${money(R.minProfit)} profit at ${buyPct}%. Bulk it or pass.`);
    }

    const pctUsed = Math.max(R.minBuyPct, buyPct - extra);
    let maxPrice = market * pctUsed / 100;
    maxPrice = Math.min(maxPrice, resaleNet - R.minProfit);
    maxPrice = Math.max(0, Math.floor(maxPrice * 4) / 4); // to the quarter
    if(maxPrice <= 0 && !hard) { hard = true; if(!flags.includes('thin')) flags.push('thin'); }

    let verdict;
    if(hard) verdict = 'PASS';
    else if(extra > 0 || flags.includes('thin')) verdict = 'BUY_LOW';
    else verdict = m ? 'BUY' : 'BUY_LOW';
    const label = verdict === 'PASS' ? 'PASS' : verdict === 'BUY' ? 'BUY' : `BUY LOW · max ${money(maxPrice)}`;
    const sellHint = m && m.chg14 != null && m.chg14 >= R.spikePct ? 'If you have this in stock, now is a good time to sell.' : '';
    return { verdict, label, maxPrice:verdict === 'PASS' ? 0 : maxPrice, buyPctUsed:pctUsed, resaleNet:round2(resaleNet), reasons, flags, sellHint, metrics:m, confident:!!m && m.points >= 20 };
  }

  // Backtest: run the rules at past dates across many cards and see what
  // the price did over the next `horizonDays`. Good rules show PASS cards
  // doing worse (lower average change, more big drops) than BUY cards.
  function backtestBuySignal(cards = [], { buyPct = 60, horizonDays = 30, stepDays = 7, warmupDays = 35 } = {}){
    const byVerdict = {};
    let samples = 0;
    for(const card of cards){
      const pts = cleanPoints(card.points || card);
      if(pts.length < RULES.minPoints) continue;
      const first = pts[0].day, end = pts[pts.length - 1].day;
      for(let day = first + warmupDays; day + horizonDays <= end; day += stepDays){
        const past = pts.filter(p => p.day <= day);
        const now = past[past.length - 1];
        const future = priceAt(pts, day + horizonDays);
        if(!now || !future) continue;
        const sig = evaluateBuySignal({ points:past, market:now.price, buyPct });
        if(sig.verdict === 'NO_DATA') continue;
        const ahead = pts.filter(p => p.day > day && p.day <= day + horizonDays);
        const worst = ahead.length ? Math.min(...ahead.map(p => p.price)) : future;
        const b = byVerdict[sig.verdict] ||= { count:0, sumChange:0, drops10:0, gains10:0, sumWorst:0 };
        const change = pct(future, now.price);
        b.count++; b.sumChange += change; b.sumWorst += pct(worst, now.price);
        if(change <= -10) b.drops10++;
        if(change >= 10) b.gains10++;
        samples++;
      }
    }
    const rows = Object.entries(byVerdict).map(([verdict, b]) => ({
      verdict, count:b.count,
      avgChange:round2(b.sumChange / b.count),
      avgWorst:round2(b.sumWorst / b.count),
      dropped10:round2(b.drops10 / b.count * 100),
      gained10:round2(b.gains10 / b.count * 100),
    })).sort((a, b) => ['BUY', 'BUY_LOW', 'PASS'].indexOf(a.verdict) - ['BUY', 'BUY_LOW', 'PASS'].indexOf(b.verdict));
    const buy = rows.find(r => r.verdict === 'BUY'), pass = rows.find(r => r.verdict === 'PASS');
    const passWorse = !!(buy && pass && pass.avgChange < buy.avgChange && pass.dropped10 >= buy.dropped10);
    return { samples, cards:cards.length, horizonDays, rows, passWorse };
  }

  const api = { RULES, cleanPoints, evaluateBuySignal, backtestBuySignal };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ArsCaBuySignal = api;
})(typeof window !== 'undefined' ? window : globalThis);
