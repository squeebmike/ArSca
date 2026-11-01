export async function handleLiveStudio(request,env,deps,url) {
  const originalJson=deps.json;
  deps={...deps,json:(data,status=200)=>originalJson(data,status,{'Cache-Control':'no-store'})};
  if (!env.MANA_LIVE_STUDIO) return deps.json({ok:false,error:'Live Studio is not deployed yet'},503);
  const storeId=String(url.searchParams.get('store_id') || '');
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return deps.json({ok:false,error:'Valid store ID required'},400);
  const room=env.MANA_LIVE_STUDIO.getByName(storeId);
  // This socket accepts only an overlay credential as its first frame. It never accepts controls.
  if (url.pathname==='/live-studio/socket' && request.method==='GET') return room.fetch(request);
  const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin','manager']);
  if (auth.error) return auth.error;
  if (url.pathname==='/live-studio/state' && request.method==='GET') return deps.json({ok:true,...await room.snapshot()});
  // The live show, or the next scheduled one, to fill in the show ID.
  if (url.pathname==='/live-studio/current-show' && request.method==='GET') {
    if (!deps.currentShow) return deps.json({ok:false,error:'Whatnot is not connected'},503);
    try { return deps.json({ok:true,show:await deps.currentShow(storeId)}); } catch { return deps.json({ok:false,error:'Could not reach Whatnot'},502); }
  }
  if (request.method!=='POST') return deps.json({ok:false,error:'Not found'},404);
  // A prepped show's whole lineup (up to 60) fits.
  const parsed=await deps.readJsonWithLimit(request,url.pathname==='/live-studio/stage'?65536:8192);
  if (parsed.error) return parsed.error;
  const body=parsed.data || {};
  try {
    if (url.pathname==='/live-studio/settings') {
      const result=await room.update(body.settings,body.revision);
      return deps.json({ok:!result.conflict,...result},result.conflict?409:200);
    }
    if (url.pathname==='/live-studio/effect') return deps.json({ok:true,...await room.trigger(body.kind)});
    if (url.pathname==='/live-studio/overlay-link') return deps.json({ok:true,...await room.rotateOverlay()});
    if (url.pathname==='/live-studio/revoke') return deps.json(await room.revokeOverlay());
    if (url.pathname==='/live-studio/stage') return deps.json({ok:true,...await room.setStage(body.stage)});
    if (url.pathname==='/live-studio/stats-reset') return deps.json({ok:true,...await room.resetStats()});
    // Totals from Whatnot's own order list for the selected show.
    if (url.pathname==='/live-studio/stats-sync') {
      if (!deps.showOrders) return deps.json({ok:false,error:'Whatnot is not connected'},503);
      const state=await room.snapshot();
      if (!state.settings.showId) return deps.json({ok:false,error:'Pick the show first (USE LIVE / NEXT SHOW)'},400);
      const orders=await deps.showOrders(storeId,state.settings.showId);
      return deps.json({ok:true,...await room.syncStats(orders)});
    }

  } catch (e) {
    // A setting the store can fix (a word Whatnot wouldn't allow, a sign off the screen) says what's wrong.
    const why=String(e?.message||'');
    return deps.json({ok:false,error:/^(Invalid|Unknown|Sign must|Use a three|A Whatnot show|"|Stage|Settings)/.test(why)?why:'Invalid control values or service unavailable'},400);
  }
  return deps.json({ok:false,error:'Not found'},404);
}
