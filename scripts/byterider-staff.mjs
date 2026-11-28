// Staff ByteRider: the dashboard's own ByteRider (owner/admin only). He
// answers from the store's data by looking things up -- small summaries from
// one read-only database lookup (byterider_staff_data) -- instead of having
// everything pasted in. Never reachable from the public website.
export const STAFF_LIMITS = { question: 600, turns: 8, rounds: 6, perUserHour: 60, images: 10, imageChars: 1400000 };
export const STAFF_MONTHLY_CAP_USD = 10;

const range = { from: { type: 'string', description: 'YYYY-MM-DD, default 30 days ago' }, to: { type: 'string', description: 'YYYY-MM-DD, default today' } };
export const STAFF_TOOLS = [
  { name: 'inventory_search', description: 'Find items in stock (or presale) by words: name, set, player, card number, publisher. Gives qty, price, market, cost, condition, date added. Most expensive first.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', description: 'e.g. Pokemon TCG, Comic, Sports, Magic' }, include_sold: { type: 'boolean' }, limit: { type: 'integer', maximum: 40 } } } },
  { name: 'inventory_summary', description: 'Listings, units, retail value and cost value of stock by category and status (in_stock, presale).',
    input_schema: { type: 'object', properties: { category: { type: 'string' } } } },
  { name: 'sales_summary', description: 'Completed sales in a date range. group_by channel (payment method: cash, Whatnot, eBay, venmo, card, trade_credit...), category, day or item (revenue, cost, profit). Also totals.',
    input_schema: { type: 'object', properties: { ...range, group_by: { type: 'string', enum: ['channel', 'category', 'day', 'item'] }, category: { type: 'string' }, query: { type: 'string', description: 'item title words (category/day/item only)' }, limit: { type: 'integer', maximum: 40 } } } },
  { name: 'stale_inventory', description: 'In-stock items older than N days with no sale in that time, biggest shelf value first.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 7 }, category: { type: 'string' }, limit: { type: 'integer', maximum: 40 } } } },
  { name: 'foc_preorders', description: 'Upcoming and recent FOC cycles with website preorder counts, totals and the most preordered books.', input_schema: { type: 'object', properties: {} } },
  { name: 'comic_search', description: 'Comics in the distributor catalog by title words: on-sale date, FOC date, publisher, price, synopsis.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 20 } }, required: ['query'] } },
  { name: 'shows', description: 'Recent and planned Whatnot shows: items, sold, revenue, cost, peak viewers.', input_schema: { type: 'object', properties: { limit: { type: 'integer', maximum: 10 } } } },
  { name: 'expenses', description: 'Store expenses by category in a date range.', input_schema: { type: 'object', properties: range } },
  { name: 'cash_bag', description: 'The last few cash drawers / cash bags: open or closed, starting, expected, counted, over/short.', input_schema: { type: 'object', properties: {} } },
  { name: 'buys', description: 'Recent collection buys and website buylist submissions.', input_schema: { type: 'object', properties: {} } },
  { name: 'customer_wants', description: 'What customers asked the store to find (want list), newest first; no names or phone numbers.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 40 } } } },
  // 2026-11-28 (store: "if I give you photos of books, can you put it in the cart? ... show you someone's order"):
  // these three run in the Worker, not the database lookup.
  { name: 'find_items', description: 'Find sellable items in stock by words (title, issue number, cover/variant, set). Returns each match with its id (needed for suggest_actions), name, qty and price. Use this to match books or cards seen in a photo.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 15 } }, required: ['query'] } },
  { name: 'orders', description: 'Open and recent orders from the orders board (eBay, Whatnot, website): number, buyer first name, date, total, status (ready, waiting on books, shipped...), items and whether each is in. Filter by words (buyer, order number, title) and/or status.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['ebay', 'whatnot', 'website'] }, limit: { type: 'integer', maximum: 25 } } } },
  { name: 'suggest_actions', description: 'Offer buttons the staff member taps to make a change -- nothing happens until they tap. Kinds: cart (put in-stock items, by id from find_items, into a NEW empty register cart), show (add items by id to the next Whatnot show), shipped (mark an eBay or Whatnot order shipped, by its board id), dungeon (save a dungeon setup to the saved setups list; they LOAD it themselves). Call once with every button for this answer.',
    input_schema: { type: 'object', properties: { actions: { type: 'array', maxItems: 6, items: { type: 'object', properties: {
      kind: { type: 'string', enum: ['cart', 'show', 'shipped', 'dungeon'] }, label: { type: 'string', description: 'Button text, short' },
      item_ids: { type: 'array', items: { type: 'string' }, maxItems: 25 }, channel: { type: 'string', enum: ['ebay', 'whatnot'] }, order_id: { type: 'string' },
      setup: { type: 'object', description: 'For dungeon: { name, plan: { floors: [{ floor, boss?, reward?, chests: [{ t, i?: { title, price, image? } }] }], stretch: [{ at, text }] } }' } }, required: ['kind', 'label'] } } }, required: ['actions'] } },
];
const TOOL_NAMES = new Set(STAFF_TOOLS.map(t => t.name));
const LOCAL_TOOLS = new Set(['find_items', 'orders']);
const UUID = /^[0-9a-f-]{36}$/i;
// The buttons, checked: only these kinds, only real-looking ids, nothing else passed on.
export function cleanActions(list = []) {
  const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 6)) {
    const label = clean(a?.label).slice(0, 60);
    if (!label) continue;
    if (a.kind === 'cart' || a.kind === 'show') {
      const ids = [...new Set((a.item_ids || []).map(String).filter(id => UUID.test(id)))].slice(0, 25);
      if (ids.length) out.push({ kind: a.kind, label, itemIds: ids });
    } else if (a.kind === 'shipped') {
      const id = clean(a.order_id).slice(0, 80);
      if (['ebay', 'whatnot'].includes(a.channel) && id) out.push({ kind: 'shipped', label, channel: a.channel, orderId: id });
    } else if (a.kind === 'dungeon' && a.setup && typeof a.setup === 'object') {
      const name = clean(a.setup.name).slice(0, 80) || 'ByteRider setup';
      if (a.setup.plan && typeof a.setup.plan === 'object') out.push({ kind: 'dungeon', label, setup: { name, plan: a.setup.plan } });
    }
  }
  return out;
}
// Photos: base64 JPEG/PNG/WebP, at most STAFF_LIMITS.images, each under imageChars.
export function cleanImages(images = []) {
  return (Array.isArray(images) ? images : []).slice(0, STAFF_LIMITS.images)
    .filter(m => m && ['image/jpeg', 'image/png', 'image/webp'].includes(m.media_type) && typeof m.data === 'string' && m.data.length > 100 && m.data.length <= STAFF_LIMITS.imageChars && /^[A-Za-z0-9+/=]+$/.test(m.data))
    .map(m => ({ type: 'image', source: { type: 'base64', media_type: m.media_type, data: m.data } }));
}

export function staffSystemPrompt({ today, storeName = 'the store' } = {}) {
  return [
    `You are ByteRider_97, ${storeName}'s staff assistant inside the store dashboard, talking to the owner or an admin. Today is ${today}.`,
    'Keep the 90s video-game mascot attitude, but be brief and exact: staff are often on a phone. Plain text, short lines, no markdown tables.',
    'Answer from the store data by calling the lookup tools. Never guess a number: if the tools did not return it, say you could not find it.',
    'Money is in US dollars. Profit = revenue minus cost; say when cost is missing (0) for items, since that overstates profit.',
    'Channels are payment methods: cash, card, Stripe Card, venmo, paypal, cashapp, Whatnot, eBay, website preorders, trade_credit and loyalty_redeem (store credit and points, not new money).',
    'Photos: you may get up to 10 photos (books, cards, a screenshot of an order). Name each thing you can read in them (title, issue #, cover/variant), look each up with find_items (or orders for an order screenshot), and say which are in stock and the price, and which you could not find.',
    'You cannot change anything yourself. To help, offer buttons with suggest_actions -- the staff member taps to do it: cart (put found items into a new empty register cart; for photos of books, offer this with every in-stock match), show (add items to the next Whatnot show), shipped (mark an eBay/Whatnot order shipped), dungeon (save a dungeon setup they can LOAD). Only use ids that find_items or orders returned. For anything else (prices, stock counts), say where in the dashboard to do it.',
    'Daily brief, when asked: yesterday\'s sales by channel, orders ready to ship and waiting on books, this week\'s FOC, and stock that has not moved -- a few short lines each.',
    'Dungeon setups: floors 1-7, up to 3 chests a floor (free giveaways and $1 starts of books in stock), a reward per floor, stretch goals at $100/$250/$500. Never anything that reads as chance (no random, mystery, raffle, lottery, gamble).',
    'Never share customer contact details.',
  ].join('\n');
}

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
export function cleanHistory(history = []) {
  return (Array.isArray(history) ? history : []).slice(-STAFF_LIMITS.turns)
    .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: clean(m?.content).slice(0, 1500) }))
    .filter(m => m.content);
}

// deps.claude(body) -> the Messages API reply JSON; deps.data(tool, args) -> the lookup's JSON.
export async function runStaffAsk({ question, history = [], images = [], today = new Date().toISOString().slice(0, 10), storeName } = {}, deps = {}) {
  const pics = cleanImages(images);
  const q = clean(question).slice(0, STAFF_LIMITS.question) || (pics.length ? 'What is in these photos? Find each in stock.' : '');
  if (!q) return { ok: false, error: 'Ask me something!' };
  const messages = [...cleanHistory(history), { role: 'user', content: pics.length ? [...pics, { type: 'text', text: q }] : q }];
  let actions = [];
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const used = [];
  for (let round = 0; round <= STAFF_LIMITS.rounds; round++) {
    const last = round === STAFF_LIMITS.rounds;
    const reply = await deps.claude({ system: staffSystemPrompt({ today, storeName }), messages, ...(last ? {} : { tools: STAFF_TOOLS }) });
    const content = Array.isArray(reply?.content) ? reply.content : [];
    const calls = content.filter(c => c.type === 'tool_use');
    if (!calls.length || last) {
      const answer = content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
      return { ok: true, answer: answer || 'Hmm, I came up empty on that one.', used, actions };
    }
    messages.push({ role: 'assistant', content });
    const results = [];
    for (const call of calls.slice(0, 4)) {
      let out;
      const args = call.input && typeof call.input === 'object' ? call.input : {};
      if (!TOOL_NAMES.has(call.name)) out = { error: 'unknown tool' };
      else if (call.name === 'suggest_actions') {
        used.push(call.name);
        actions = cleanActions(args.actions);
        out = { shown: actions.length, note: 'Buttons are shown under your answer; nothing changes until they tap one.' };
      } else {
        used.push(call.name);
        const run = LOCAL_TOOLS.has(call.name) ? deps.local : deps.data;
        out = run ? await run(call.name, args).catch(e => ({ error: String(e?.message || e).slice(0, 200) })) : { error: 'not available' };
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out ?? null).slice(0, 12000) });
    }
    // Any tool_use beyond the 4 still needs an answer.
    for (const call of calls.slice(4)) results.push({ type: 'tool_result', tool_use_id: call.id, content: '{"error":"too many lookups at once"}' });
    messages.push({ role: 'user', content: results });
  }
  return { ok: true, answer: 'Hmm, I came up empty on that one.', used, actions };
}
