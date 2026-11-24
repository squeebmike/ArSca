// SAVED DUNGEON SETUPS (store, 2026-11-24: "I want to be able to have you set up the dungeons. Like I tell you what's in
// each chest each floor, tell you boss and stretch goals etc. You set it up. And then it's in the Whatnot show tab
// saved"). A setup is the whole week's plan, ready before the show:
//   { floors: [{ floor, boss?, room?, reward?, chests: [{ t, i?: { title, image, price } }] }],
//     stretch: [{ at, text }],           -- show stretch goals ($ of the show's sales -> what happens)
//     chestGoals?, giveawayChests? }
// Saved in Supabase (dungeon_setups) by the dashboard or by Claude; the remote's LOAD puts it into Live Studio:
// floor rewards, stretch goals and each floor's own chests go into the settings, bosses and rooms onto their floors.
import { BOSS_ORDER } from './live-studio-bosses.mjs';
import { ROOMS } from './live-studio-dungeon.mjs';

const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const httpsImg = v => (/^https:\/\/[^\s"'<>]{1,600}$/.test(String(v || '')) ? String(v) : '');

export function cleanSetupPlan(p = {}) {
  const floors = (Array.isArray(p.floors) ? p.floors : []).map(f => {
    const floor = Math.round(Number(f?.floor)); if (!(floor >= 1 && floor <= 99)) return null;
    const chests = (Array.isArray(f.chests) ? f.chests : []).slice(0, 3).map(c => {
      const t = txt(c?.t ?? c?.text, 120); if (!t) return null;
      const i = c.i || c.item; const item = i && txt(i.title, 90) ? { title: txt(i.title, 90), image: httpsImg(i.image), price: Math.max(0, Math.round(Number(i.price) * 100) / 100 || 0) } : null;
      return { t, ...(item ? { i: item } : {}) };
    }).filter(Boolean);
    return { floor, ...(BOSS_ORDER.includes(f.boss) ? { boss: f.boss } : {}), ...(ROOMS.some(r => r.id === f.room) ? { room: f.room } : {}), ...(txt(f.reward, 120) ? { reward: txt(f.reward, 120) } : {}), chests };
  }).filter(Boolean).sort((a, b) => a.floor - b.floor).filter((f, k, a) => k === 0 || a[k - 1].floor !== f.floor).slice(0, 7);
  const stretch = (Array.isArray(p.stretch) ? p.stretch : []).map(x => ({ at: Math.round(Number(x?.at)), text: txt(x?.text, 120) })).filter(x => x.at > 0 && x.at < 1e6 && x.text).sort((a, b) => a.at - b.at).slice(0, 12);
  const out = { floors, stretch };
  if (typeof p.chestGoals === 'string' && p.chestGoals.trim()) out.chestGoals = p.chestGoals.slice(0, 1200);
  if (Number.isInteger(p.giveawayChests) && p.giveawayChests >= 0 && p.giveawayChests <= 3) out.giveawayChests = p.giveawayChests;
  return out;
}

// What LOAD writes into the Live Studio settings (the bosses and rooms go floor by floor through dungeon-adjust).
export function setupSettings(plan, idOf = (f, k) => 'f' + f + 'c' + (k + 1)) {
  const p = cleanSetupPlan(plan), out = {
    floorRewards: p.floors.filter(f => f.reward).map(f => f.floor + ': ' + f.reward).join('\n'),
    showUnlocks: p.stretch.map(x => x.at + ': ' + x.text).join('\n'),
    chestLoad: JSON.stringify(p.floors.flatMap(f => f.chests.map((c, k) => ({ id: idOf(f.floor, k), t: c.t, f: f.floor, ...(c.i ? { i: c.i } : {}) })))),
  };
  if (out.chestLoad === '[]') out.chestLoad = '';
  if (p.chestGoals != null) out.chestGoals = p.chestGoals;
  if (p.giveawayChests != null) out.giveawayChests = p.giveawayChests;
  return out;
}

// Worker routes: GET /store/dungeon-setups (list), POST (save), DELETE ?id=.
export async function handleDungeonSetups(request, env, url, { json, requireStoreUser, db }) {
  if (url.pathname !== '/store/dungeon-setups') return null;
  const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
  const auth = await requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']);
  if (auth.error) return auth.error;
  const s = encodeURIComponent(storeId);
  if (request.method === 'GET') {
    const { data } = await db(`dungeon_setups?store_id=eq.${s}&select=id,name,show_id,show_title,plan,updated_at&order=updated_at.desc&limit=50`);
    return json({ ok: true, setups: data || [] });
  }
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const name = txt(body.name, 80); if (!name) return json({ ok: false, error: 'Give the setup a name' }, 400);
    const id = /^[a-z0-9-]{4,40}$/i.test(String(body.id || '')) ? String(body.id) : 'dg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const row = { id, store_id: storeId, name, show_id: txt(body.show_id, 80) || null, show_title: txt(body.show_title, 120) || null, plan: cleanSetupPlan(body.plan), updated_at: new Date().toISOString() };
    await db(`dungeon_setups?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
    return json({ ok: true, setup: row });
  }
  if (request.method === 'DELETE') {
    const id = String(url.searchParams.get('id') || ''); if (!/^[a-z0-9-]{4,40}$/i.test(id)) return json({ ok: false, error: 'Setup id required' }, 400);
    await db(`dungeon_setups?id=eq.${encodeURIComponent(id)}&store_id=eq.${s}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return json({ ok: true });
  }
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
