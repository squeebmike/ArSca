export async function handleLiveStudio(request,env,deps,url) {
  if (!env.MANA_LIVE_STUDIO) return deps.json({ok:false,error:'Live Studio is not deployed yet'},503);
  const storeId=String(url.searchParams.get('store_id') || '');
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return deps.json({ok:false,error:'Valid store ID required'},400);
  const room=env.MANA_LIVE_STUDIO.getByName(storeId);
  // This socket accepts only an overlay credential as its first frame. It never accepts controls.
  if (url.pathname==='/live-studio/socket' && request.method==='GET') return room.fetch(request);
  const auth=await deps.requireStoreUser(request,env,storeId,['owner','admin','manager']);
  if (auth.error) return auth.error;
  if (url.pathname==='/live-studio/state' && request.method==='GET') return deps.json({ok:true,...await room.snapshot()});
  if (request.method!=='POST') return deps.json({ok:false,error:'Not found'},404);
  const parsed=await deps.readJsonWithLimit(request,8192);
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
  } catch { return deps.json({ok:false,error:'Invalid control values or service unavailable'},400); }
  return deps.json({ok:false,error:'Not found'},404);
}
