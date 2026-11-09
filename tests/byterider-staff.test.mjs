import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runStaffAsk, STAFF_TOOLS, cleanHistory, staffSystemPrompt } from '../scripts/byterider-staff.mjs';
// Store, 2026-11-09: "Does ByteRider_97 work in the dashboard to tell us stuff
// based on all the data we have?" -- staff ByteRider looks things up.

// The tool loop: he asks for data, gets it, then answers.
const bodies = [], lookups = [];
let round = 0;
const claude = async body => {
  bodies.push(JSON.parse(JSON.stringify(body)));
  round++;
  if (round === 1) return { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'sales_summary', input: { group_by: 'channel' } }, { type: 'tool_use', id: 't2', name: 'drop_tables', input: {} }] };
  return { content: [{ type: 'text', text: 'Cash led with $2,715.' }] };
};
const data = async (tool, args) => (lookups.push([tool, args]), { rows: [{ channel: 'cash', amount: 2715 }] });
const out = await runStaffAsk({ question: 'sales by channel this month?', today: '2026-11-09' }, { claude, data });
assert.equal(out.answer, 'Cash led with $2,715.');
assert.deepEqual(lookups, [['sales_summary', { group_by: 'channel' }]], 'only known tools are looked up');
assert.deepEqual(out.used, ['sales_summary']);
const results = bodies[1].messages.at(-1).content;
assert.equal(results.length, 2, 'every tool_use gets a result');
assert.match(results[1].content, /unknown tool/);
assert.ok(bodies[0].tools.length === STAFF_TOOLS.length);

// Never loops forever: the last round has no tools, so he must answer.
let n = 0;
const always = async body => (n++, body.tools ? { content: [{ type: 'tool_use', id: 'x' + n, name: 'cash_bag', input: {} }] } : { content: [{ type: 'text', text: 'Done.' }] });
assert.equal((await runStaffAsk({ question: 'loop?' }, { claude: always, data: async () => ({}) })).answer, 'Done.');
assert.equal(n, 6);

// Empty question; history trimmed and must start with the user.
assert.equal((await runStaffAsk({ question: '  ' }, { claude, data })).ok, false);
assert.equal(cleanHistory(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }))).length, 8);
assert.match(staffSystemPrompt({ today: '2026-11-09' }), /Never guess a number/);
assert.match(staffSystemPrompt(), /Never share customer contact details/);

// Worker: owner/admin only, its own spend cap, the read-only database lookup.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const route = w.slice(w.indexOf("url.pathname === '/staff/byterider/ask'"), w.indexOf("// The public Pokémon Set Guide's set list"));
assert.match(route, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/);
assert.match(route, /'byterider-staff-spend:' \+ month/);
assert.match(route, /rpc\/byterider_staff_data/);
assert.match(route, /p_store: storeId/);
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/byterider-staff\.mjs/);

// The lookup is for the server's key only, and only reads.
const sql = fs.readFileSync('supabase-migrations/2026-11-09-byterider-staff-data.sql', 'utf8');
assert.match(sql, /revoke all on function public\.byterider_staff_data\(uuid, text, jsonb\) from public, anon, authenticated;/);
assert.match(sql, /language plpgsql stable security definer/);
assert.doesNotMatch(sql, /\b(insert into|update \w+ set|delete from)\b/i);
for (const t of STAFF_TOOLS) assert.ok(sql.includes(`p_tool = '${t.name}'`), t.name + ' exists in the lookup');
assert.doesNotMatch(sql.slice(sql.indexOf("'customer_wants'")), /w\.phone|customer_name/);

// Dashboard: tapping his corner screen opens the staff chat.
const dash = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.ok(dash.includes("storeWorkerFetch('/staff/byterider/ask'"));
assert.ok(dash.includes('openStaffByteRider(); };'));
assert.ok(!/innerHTML/.test(dash.slice(dash.indexOf('function openStaffByteRider'), dash.indexOf('window.openStaffByteRider'))), 'answers are text, never HTML');
console.log('Staff ByteRider: data lookups, owner/admin only, own cap, dashboard chat passed');
