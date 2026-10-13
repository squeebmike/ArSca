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
    softFallPct: -4,        // a milder 30-day slide = value it at its average
    bottomFromHighPct: -8,  // down this far from the 30-day high ...
    bottomQuietDays: 7,     // ... with no new low for this long = fall has stalled
    volatileCv: 0.15,       // 30-day price swings above this = more margin
    fastPerWeek: 10,        // this many sales a week or more = fast seller
    slowPerWeek: 3,         // fewer than this = slow seller
    deadPerWeek: 0.75,      // fewer than this = very hard to resell
    stockSoft: 1,           // already holding this many = more margin
    stockHard: 4,           // holding this many = pass
    // Mostly sold in-store: card-processing fees, no marketplace cut.
    feePct: 3,
    feeFixed: 0,
    // Profit we keep on the resale, by how fast it sells. Liquid Pokemon
    // can go to 80% of resale (20% margin).
    marginFastPokemon: 20,
    marginFast: 25,
    marginAvg: 35,
    marginSlow: 45,
    marginStocked: 5,       // added when we already hold some
    minProfit: 3,           // never less than this per card
    minWalkAway: 1,         // a target under this isn't worth the time: bulk it
    fallCarryPct: 50,       // a card still falling is valued as if it keeps
                            // sliding at this share of last month's pace
    openPct: 88,            // first offer, as % of the walk-away price
    // Trade credit, as % of resale, for a FAST seller; slower sellers drop
    // by the same points their cash margin rises (Pokemon trades at 80).
    tradePctPokemon: 80,
    tradePctOther: 75,
    // New sets usually keep easing for a few months while supply floods in.
    newSetDays: 90,
    marginNewSet: 5,
    // What sells here (store-demand.js): pay a little more for what moves,
    // a little less for what sits or is already piled up.
    marginHotHere: -5,
    marginSlowHere: 5,
    minMargin: 10,
    // Grading upside: raw NM + grading cost vs eBay PSA 9 / PSA 10 sales.
    gradingCost: 25,
    gradePsa9Cover: 1.05,   // PSA 9 alone covers raw + grading, with a little room
    gradePsa10Multiple: 2,  // and PSA 10 is at least 2x what it'd cost to get there
    gradeMinSales: 3,       // enough PSA 10 sales to trust that price
    ownSalesMin: 2,         // recent sales of our own before we trust their price
    ownSalesCap: 1.15,      // and never value above this x market
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
      hi30, lo30, avg30:mean30, offHigh30:pct(last.price, hi30),
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

  // What a card will most likely resell for: our own recent sale price when
  // we have enough of it, else today's market -- valued at its 30-day
  // average after a spike or a slide, and at its recent low while it's
  // still falling.
  function expectedResale(market, m, ours, R, flags){
    const own = Number(ours?.recentAvgSale || 0), ownCount = Number(ours?.recentSold || 0);
    if(own > 0 && ownCount >= R.ownSalesMin && !flags.includes('falling') && !flags.includes('spike')){
      const v = Math.min(own, market * R.ownSalesCap);
      return { value:v, basis:`your last ${ownCount} sale${ownCount === 1 ? '' : 's'} (avg ${money(own)})${v < own ? `, capped at ${Math.round(R.ownSalesCap * 100)}% of market` : ''}` };
    }
    if(m && flags.includes('falling')){
      const more = Math.min(30, Math.abs(m.chg30 || 0)) * R.fallCarryPct / 100;
      return { value:Math.min(market, m.lo30) * (1 - more / 100), basis:`${money(Math.min(market, m.lo30))} less another ${more.toFixed(0)}% -- still falling, so valued as if it keeps sliding at half last month's pace` };
    }
    if(m && (flags.includes('spike') || flags.includes('sliding') || flags.includes('volatile')) && m.avg30 < market) return { value:m.avg30, basis:`its 30-day average (${money(m.avg30)}), not today's ${money(market)}` };
    return { value:market, basis:`today's market (${money(market)})` };
  }

  // inputs: { points, market, category, stockQty, ourSales:{soldCount,avgDays,recentSold,recentAvgSale},
  //   wants, storeDemand:{rating,label,sentence}, setReleaseDate, grading:{psa9,psa10,count10,raw}, rules }
  function evaluateBuySignal(input = {}){
    const R = { ...RULES, ...(input.rules || {}) };
    const pts = cleanPoints(input.points);
    const stockQty = Math.max(0, Number(input.stockQty) || 0);
    const isPokemon = /pok[eé]mon/i.test(String(input.category || ''));
    const market = Number(input.market) || (pts.length ? pts[pts.length - 1].price : 0);
    const reasons = [], flags = [];
    const say = (tone, text) => reasons.push({ tone, text });
    if(!(market > 0)) return { verdict:'NO_DATA', label:'NO PRICE', maxPrice:0, openPrice:0, tradeMax:0, reasons:[{ tone:'info', text:'No market price to judge from.' }], flags, math:[], metrics:null };

    const enough = pts.length >= R.minPoints && (pts[pts.length - 1].day - pts[0].day) >= R.minSpanDays;
    const m = enough ? metricsFor(pts, market) : null;
    let hard = false;

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
        flags.push('falling');
        say('bad', `Down ${absPct(m.chg30)} in 30 days and set a new 30-day low ${m.daysSinceLow === 0 ? 'today' : m.daysSinceLow + ' day' + (m.daysSinceLow === 1 ? '' : 's') + ' ago'} -- still falling. Priced for where it's heading.`);
      } else if(bottoming){
        flags.push('bottoming');
        say('good', `${absPct(m.offHigh30)} below its 30-day high, but no new low in ${m.daysSinceLow} days -- the fall looks like it has stalled.`);
      } else if(m.chg30 != null && m.chg30 <= R.softFallPct){
        flags.push('sliding');
        say('warn', `Down ${absPct(m.chg30)} in 30 days.`);
      }
      if(m.chg30 != null && m.chg30 > R.softFallPct && m.chg30 < R.spikePct && !flags.includes('spike')){
        if(m.chg30 >= 5) say('good', `Up ${absPct(m.chg30)} in 30 days without a spike.`);
        else if(!flags.includes('sliding')) say('good', `Steady: ${fmtPct(m.chg30)} over 30 days.`);
      }
      if(m.cv30 >= R.volatileCv){
        flags.push('volatile');
        say('warn', `Price swings a lot (about ±${Math.round(m.cv30 * 100)}% over 30 days) -- more margin.`);
      }
      if(m.perWeek != null){
        if(m.perWeek < R.deadPerWeek){
          hard = true; flags.push('dead');
          say('bad', `Barely sells: about ${m.perWeek.toFixed(1)} a week on TCGplayer. Hard to flip.`);
        } else if(m.perWeek < R.slowPerWeek){
          flags.push('slow');
          say('warn', `Slow seller: about ${m.perWeek.toFixed(1)} a week on TCGplayer.`);
        } else {
          if(m.perWeek >= R.fastPerWeek) flags.push('fast');
          say('good', `Sells about ${Math.round(m.perWeek)} a week on TCGplayer -- ${m.perWeek >= R.fastPerWeek ? 'easy' : 'steady'} to move.`);
        }
      }
    } else {
      say('info', `Not enough price history to read the trend (${pts.length} point${pts.length === 1 ? '' : 's'}). Judged on margin and your own sales.`);
    }

    // What we already hold and what we've sold before.
    if(stockQty >= R.stockHard){
      hard = true; flags.push('overstocked');
      say('bad', `You already have ${stockQty} in stock.`);
    } else if(stockQty >= R.stockSoft){
      flags.push('stocked');
      say('warn', `You already have ${stockQty} in stock.`);
    }
    const ours = input.ourSales || null;
    if(ours && Number(ours.soldCount) > 0){
      const days = ours.avgDays != null ? `, in about ${Math.max(1, Math.round(ours.avgDays))} days on average` : '';
      say('good', `You've sold ${ours.soldCount} of these before${days}.`);
    }
    if(Number(input.wants) > 0) say('good', `${input.wants} customer want${input.wants === 1 ? '' : 's'} on the want list.`);

    // What sells here, from our own sales by set / character / player / series.
    const demand = input.storeDemand && input.storeDemand.rating ? input.storeDemand : null;
    if(demand){
      if(demand.rating === 'hot'){ flags.push('hotHere'); say('good', `Sells well here: ${demand.sentence}`); }
      else if(demand.rating === 'slow'){ flags.push('slowHere'); say('warn', `Slow here: ${demand.sentence}`); }
      else if(demand.rating === 'plenty'){ flags.push('plentyHere'); say('warn', `You have plenty: ${demand.sentence}`); }
      else if(demand.sentence) say('info', demand.sentence);
    }
    // New set: released recently (dated against the price history's last
    // day, so a backtest judges it as it was then).
    const asOf = m ? m.asOfDay * DAY : Date.now();
    const released = input.setReleaseDate ? toTime(input.setReleaseDate) : NaN;
    const setAgeDays = Number.isFinite(released) ? Math.floor((asOf - released) / DAY) : null;
    if(setAgeDays != null && setAgeDays >= 0 && setAgeDays < R.newSetDays){
      flags.push('newSet');
      const weeks = Math.max(1, Math.round(setAgeDays / 7));
      say('warn', `Set came out ${weeks} week${weeks === 1 ? '' : 's'} ago -- new sets usually keep easing for a few months while supply floods in.`);
    }

    // Target price = expected resale - fees - the margin we keep.
    const resale = expectedResale(market, m, ours, R, flags);
    const resaleNet = Math.max(0, resale.value * (1 - R.feePct / 100) - R.feeFixed);
    const speed = flags.includes('slow') || flags.includes('volatile') || !m ? 'slow'
      : flags.includes('fast') ? 'fast' : 'avg';
    let marginPct = speed === 'slow' ? R.marginSlow : speed === 'fast' ? (isPokemon ? R.marginFastPokemon : R.marginFast) : R.marginAvg;
    if(!m) marginPct = R.marginAvg; // no history: average, not punished
    const marginWhy = !m ? 'no sales data, so the standard margin'
      : speed === 'fast' ? `sells fast${isPokemon ? ', liquid Pokémon' : ''}` : speed === 'slow' ? (flags.includes('slow') ? 'slow seller' : 'price swings a lot') : 'sells at an average pace';
    const adjust = [];
    // Shown as pay %: a margin bump of +5 reads "-5% since you have some".
    const bump = (on, pts, why) => { if(on && pts){ marginPct += pts; adjust.push(`${pts > 0 ? '-' : '+'}${Math.abs(pts)}% ${why}`); } };
    bump(flags.includes('stocked'), R.marginStocked, 'since you have some');
    bump(flags.includes('newSet'), R.marginNewSet, 'new set');
    bump(flags.includes('hotHere'), R.marginHotHere, 'sells well here');
    bump(flags.includes('slowHere') || flags.includes('plentyHere'), R.marginSlowHere, flags.includes('plentyHere') ? 'you have plenty' : 'slow here');
    marginPct = Math.max(R.minMargin, Math.min(90, marginPct));
    const marginNote = [marginWhy, ...adjust].join(', ');
    let walkAway = Math.min(resaleNet * (1 - marginPct / 100), resaleNet - R.minProfit);
    walkAway = Math.max(0, Math.floor(walkAway * 4) / 4); // to the quarter
    const openPrice = Math.max(0, Math.floor(walkAway * R.openPct / 100 * 4) / 4);
    // Trade credit: its own % for a fast seller, lowered by the same points
    // the cash margin goes up for slower or stocked cards -- and never less
    // than the cash walk-away price.
    const fastMargin = isPokemon ? R.marginFastPokemon : R.marginFast;
    const tradePctUsed = Math.max(10, Math.min(95, (isPokemon ? R.tradePctPokemon : R.tradePctOther) - Math.max(0, marginPct - fastMargin)));
    const tradeMax = Math.max(0, Math.floor(Math.max(walkAway, resale.value * tradePctUsed / 100) * 4) / 4);
    if(walkAway < R.minWalkAway){
      hard = true; flags.push('thin');
      say('bad', `Resale nets about ${money(resaleNet)} -- after ${money(R.minProfit)} profit there's ${walkAway > 0 ? 'only ' + money(walkAway) : 'nothing'} left to pay. Bulk it or pass.`);
    } else if(resaleNet - walkAway <= R.minProfit + 0.25 && resaleNet * (1 - marginPct / 100) > walkAway){
      flags.push('thin');
      say('warn', `Cheap card: the ${money(R.minProfit)} minimum profit sets the price, not the margin.`);
    }
    // Grading upside (raw cards only): never changes the price, just says
    // when a slab is worth a look.
    let grading = null;
    const gr = input.grading || null;
    if(gr && Number(gr.psa10) > 0){
      const cost = market + R.gradingCost;
      const psa9 = Number(gr.psa9) || 0, psa10 = Number(gr.psa10), n10 = Number(gr.count10) || 0;
      if(psa10 >= cost * R.gradePsa10Multiple && psa9 >= cost * R.gradePsa9Cover && n10 >= R.gradeMinSales){
        flags.push('grade');
        grading = { psa9, psa10, cost:round2(cost), upside10:round2(psa10 - cost) };
        say('good', `Grading candidate: PSA 10 sells about ${money(psa10)}${psa9 ? `, PSA 9 about ${money(psa9)}` : ''} -- vs ${money(market)} raw + ${money(R.gradingCost)} grading. Check centering and surface before counting on it.`);
      }
    }
    const math = [
      `Resale: ${resale.basis}`,
      R.feePct || R.feeFixed ? `After ${R.feePct}% card fees${R.feeFixed ? ` + ${money(R.feeFixed)}` : ''}: ${money(resaleNet)}` : `No fees (in-store): ${money(resaleNet)}`,
      `Pay up to ${100 - marginPct}% (${marginNote}): walk away above ${money(walkAway)}`,
      `Open at ${money(openPrice)} · trade credit up to ${money(tradeMax)} (${Math.round(tradePctUsed)}% of resale)`,
    ];

    let verdict;
    if(hard) verdict = 'PASS';
    else if(flags.some(f => ['falling','sliding','volatile','slow','stocked','thin','newSet','slowHere','plentyHere'].includes(f)) || !m) verdict = 'BUY_LOW';
    else verdict = 'BUY';
    const label = verdict === 'PASS' ? 'PASS' : `${verdict === 'BUY' ? 'BUY' : 'BUY LOW'} · ≤ ${money(walkAway)}`;
    const sellHint = m && m.chg14 != null && m.chg14 >= R.spikePct ? 'If you have this in stock, now is a good time to sell.' : '';
    const pass = verdict === 'PASS';
    return { verdict, label, maxPrice:pass ? 0 : walkAway, openPrice:pass ? 0 : openPrice, tradeMax:pass ? 0 : tradeMax, tradePctUsed,
      resale:round2(resale.value), resaleBasis:resale.basis, resaleNet:round2(resaleNet), marginPct, speed,
      reasons, flags, math:pass ? [] : math, sellHint, metrics:m, grading, setAgeDays, confident:!!m && m.points >= 20 };
  }

  // Backtest: run the rules at past dates across many cards and see what
  // the price did over the next `horizonDays`. Good rules show PASS cards
  // doing worse (lower average change, more big drops) than BUY cards.
  function backtestBuySignal(cards = [], { category = '', horizonDays = 30, stepDays = 7, warmupDays = 35 } = {}){
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
        const sig = evaluateBuySignal({ points:past, market:now.price, category:card.category || category, setReleaseDate:card.setReleaseDate || '' });
        if(sig.verdict === 'NO_DATA') continue;
        const ahead = pts.filter(p => p.day > day && p.day <= day + horizonDays);
        const worst = ahead.length ? Math.min(...ahead.map(p => p.price)) : future;
        const b = byVerdict[sig.verdict] ||= { count:0, sumChange:0, drops10:0, gains10:0, sumWorst:0, priced:0, heldUp:0 };
        const change = pct(future, now.price);
        b.count++; b.sumChange += change; b.sumWorst += pct(worst, now.price);
        // Bought at the walk-away price: would selling 30 days later still
        // clear the minimum profit after fees?
        if(sig.maxPrice > 0){ b.priced++; if(future * (1 - RULES.feePct / 100) - RULES.feeFixed - sig.maxPrice >= RULES.minProfit) b.heldUp++; }
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
      heldUp:b.priced ? round2(b.heldUp / b.priced * 100) : null,
    })).sort((a, b) => ['BUY', 'BUY_LOW', 'PASS'].indexOf(a.verdict) - ['BUY', 'BUY_LOW', 'PASS'].indexOf(b.verdict));
    const buy = rows.find(r => r.verdict === 'BUY'), pass = rows.find(r => r.verdict === 'PASS');
    const passWorse = !!(buy && pass && pass.avgChange < buy.avgChange && pass.dropped10 >= buy.dropped10);
    return { samples, cards:cards.length, horizonDays, rows, passWorse };
  }

  const api = { RULES, cleanPoints, evaluateBuySignal, backtestBuySignal };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ArsCaBuySignal = api;
})(typeof window !== 'undefined' ? window : globalThis);
