// A read-only copy of what's in the Live Studio right now (store, 2026-11-24: "Can you make it so you can read it?" --
// the dungeon's floors, bosses, chests and stretch goals live only inside the studio on Cloudflare). Every 10 minutes,
// with the Whatnot run, the studio's state is copied to Supabase (live_studio_snapshots) so it can be looked up there.
// Copy only: nothing reads it back into the studio. Big or private bits (photos, the overlay token, buyer names) stay out.
export function studioMirror(state = {}) {
  const st = state.stats || {}, s = { ...(state.settings || {}) };
  delete s.beastsFace; delete s.beastsBuddy;
  const d = st.dungeon || null;
  return {
    settings: s,
    dungeon: d,
    show: { showId: st.showId || '', gross: st.gross || 0, sold: st.sold || 0, biggest: st.biggest || 0 },
    stage: { now: state.stage?.now?.title || null, next: (state.stage?.next || []).map(i => i?.title).filter(Boolean).slice(0, 60) },
  };
}
export async function mirrorLiveStudio(env, storeId, db) {
  if (!env.MANA_LIVE_STUDIO || !/^[0-9a-f-]{36}$/i.test(String(storeId || ''))) return { skipped: true };
  const state = await env.MANA_LIVE_STUDIO.getByName(storeId).snapshot();
  await db('live_studio_snapshots?on_conflict=store_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ store_id: storeId, snapshot: studioMirror(state), updated_at: new Date().toISOString() }) });
  return { ok: true };
}
