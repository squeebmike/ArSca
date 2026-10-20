import assert from 'node:assert/strict';
import fs from 'node:fs';

// After a compare, staff answer REAL / FAKE / NOT SURE; the compare's scores
// are saved with the answer so its thresholds can be tuned from real cards.
const compare = fs.readFileSync('scripts/card-compare.js', 'utf8');
assert.match(compare, /data-cc="feedback" data-answer="real">✓ REAL</);
assert.match(compare, /data-cc="feedback" data-answer="fake">✗ FAKE</);
assert.match(compare, /data-cc="feedback" data-answer="unsure">\? NOT SURE</);
assert.match(compare, /storeWorkerFetch\('\/card-compare\/feedback', \{ method:'POST'/);
assert.match(compare, /S\.result = analyzeCard\(S\.ref, S\.aligned\);\n\s*S\.feedback = null;/, 'a new line-up asks again');

const migration = fs.readFileSync('supabase-migrations/2026-10-20-card-compare-feedback.sql', 'utf8');
assert.match(migration, /grant select, insert, update, delete on public\.card_compare_feedback to service_role;/);
assert.match(migration, /alter table public\.card_compare_feedback enable row level security;/);

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const inserts = [];
globalThis.fetch = async (input, init = {}) => {
  const url = decodeURIComponent(String(input));
  const ok = d => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id:'u1', email:'staff@example.com' });
  if (url.includes('store_members')) return ok([{ role:'owner' }]);
  if (url.includes('/rest/v1/card_compare_feedback') && init.method === 'POST') { inserts.push(JSON.parse(init.body)); return new Response(null, { status:201 }); }
  return ok([]);
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const env = { SUPABASE_URL:'https://database.example', SUPABASE_SERVICE_ROLE_KEY:'test-only' };
  const post = body => api.fetch(new Request('https://api.example/card-compare/feedback', { method:'POST', headers:{ Authorization:'Bearer t', 'X-Store-Id':'store-1', 'Content-Type':'application/json' }, body:JSON.stringify(body) }), env, { waitUntil(){} });
  const res = await post({ storeId:'store-1', answer:'fake', card:{ name:'Charizard', set:'Base', number:'4' }, verdict:'red', overall:0.62, zones:[{ key:'text', match:0.41, sharpness:0.7, inkWeight:1.5, colorDiff:12, severity:2 }], appVersion:'v' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].answer, 'fake'); assert.equal(inserts[0].store_id, 'store-1'); assert.equal(inserts[0].created_by, 'u1');
  assert.equal(inserts[0].zones[0].inkWeight, 1.5); assert.equal(inserts[0].card.name, 'Charizard');
  const bad = await post({ storeId:'store-1', answer:'maybe' });
  assert.equal(bad.status, 400);
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('Card compare feedback checks passed');
