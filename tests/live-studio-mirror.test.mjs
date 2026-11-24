import fs from 'node:fs';
import assert from 'node:assert/strict';
// Store, 2026-11-24: "Can you make it so you can read it?" -- the studio's dungeon copied to Supabase every 10 minutes.
const { studioMirror, mirrorLiveStudio } = await import('../scripts/live-studio-mirror.mjs');
const state = { settings: { chestLoad: '[{"id":"a","t":"x","f":1}]', showUnlocks: '100: Free pack', beastsFace: '1'.repeat(144) }, stats: { showId: 's', gross: 50, dungeon: { floor: 2, plan: [{ floor: 2 }] } }, stage: { now: { title: 'Book A' }, next: [{ title: 'Book B' }] }, pics: ['big'], fisterFace: 'data:...', revision: 9 };
const m = studioMirror(state);
assert.equal(m.dungeon.floor, 2); assert.equal(m.settings.showUnlocks, '100: Free pack'); assert.equal(m.settings.beastsFace, undefined);
assert.deepEqual(m.stage, { now: 'Book A', next: ['Book B'] }); assert.ok(!('pics' in m) && !JSON.stringify(m).includes('data:'), 'no photos');
const calls = [];
const env = { MANA_LIVE_STUDIO: { getByName: id => ({ snapshot: async () => state }) } };
const r = await mirrorLiveStudio(env, '0f9dd4bc-42a7-487e-a972-2905d24513e9', async (p, i) => { calls.push([p, i]); return {}; });
assert.ok(r.ok && calls[0][0] === 'live_studio_snapshots?on_conflict=store_id' && JSON.parse(calls[0][1].body).snapshot.dungeon.floor === 2);
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(w.includes("await mirrorLiveStudio(env, whatnotStoreId(env),"), 'runs with the 10-minute Whatnot run');
console.log('Live Studio mirror: passed');
