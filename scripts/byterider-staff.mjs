// Staff ByteRider: the dashboard's own ByteRider (owner/admin only). He
// answers from the store's data by looking things up -- small summaries from
// one read-only database lookup (byterider_staff_data) -- instead of having
// everything pasted in. Never reachable from the public website.
export const STAFF_LIMITS = { question: 600, turns: 8, rounds: 5, perUserHour: 60 };
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
];
const TOOL_NAMES = new Set(STAFF_TOOLS.map(t => t.name));

export function staffSystemPrompt({ today, storeName = 'the store' } = {}) {
  return [
    `You are ByteRider_97, ${storeName}'s staff assistant inside the store dashboard, talking to the owner or an admin. Today is ${today}.`,
    'Keep the 90s video-game mascot attitude, but be brief and exact: staff are often on a phone. Plain text, short lines, no markdown tables.',
    'Answer from the store data by calling the lookup tools. Never guess a number: if the tools did not return it, say you could not find it.',
    'Money is in US dollars. Profit = revenue minus cost; say when cost is missing (0) for items, since that overstates profit.',
    'Channels are payment methods: cash, card, Stripe Card, venmo, paypal, cashapp, Whatnot, eBay, website preorders, trade_credit and loyalty_redeem (store credit and points, not new money).',
    'You can only read. If asked to change something (prices, stock, orders), say where in the dashboard to do it.',
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
export async function runStaffAsk({ question, history = [], today = new Date().toISOString().slice(0, 10), storeName } = {}, deps = {}) {
  const q = clean(question).slice(0, STAFF_LIMITS.question);
  if (!q) return { ok: false, error: 'Ask me something!' };
  const messages = [...cleanHistory(history), { role: 'user', content: q }];
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const used = [];
  for (let round = 0; round <= STAFF_LIMITS.rounds; round++) {
    const last = round === STAFF_LIMITS.rounds;
    const reply = await deps.claude({ system: staffSystemPrompt({ today, storeName }), messages, ...(last ? {} : { tools: STAFF_TOOLS }) });
    const content = Array.isArray(reply?.content) ? reply.content : [];
    const calls = content.filter(c => c.type === 'tool_use');
    if (!calls.length || last) {
      const answer = content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
      return { ok: true, answer: answer || 'Hmm, I came up empty on that one.', used };
    }
    messages.push({ role: 'assistant', content });
    const results = [];
    for (const call of calls.slice(0, 4)) {
      let out;
      if (!TOOL_NAMES.has(call.name)) out = { error: 'unknown tool' };
      else {
        used.push(call.name);
        out = await deps.data(call.name, call.input && typeof call.input === 'object' ? call.input : {}).catch(e => ({ error: String(e?.message || e).slice(0, 200) }));
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out ?? null).slice(0, 12000) });
    }
    // Any tool_use beyond the 4 still needs an answer.
    for (const call of calls.slice(4)) results.push({ type: 'tool_result', tool_use_id: call.id, content: '{"error":"too many lookups at once"}' });
    messages.push({ role: 'user', content: results });
  }
  return { ok: true, answer: 'Hmm, I came up empty on that one.', used };
}
