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
  const parsed=await deps.readJsonWithLimit(request,['/live-studio/stage','/live-studio/pics','/live-studio/machine'].includes(url.pathname)?65536:8192);
  if (parsed.error) return parsed.error;
  const body=parsed.data || {};
  // A chest that opened: its item goes into the Whatnot show as a $1-start
  // auction (the host still taps start in the app -- Whatnot doesn't let
  // apps start an auction). Never holds up the reply.
  const withChest = async r => { if (r?.chestItem?.id && r.showId && deps.chestToWhatnot) await deps.chestToWhatnot(storeId, r.chestItem, r.showId).then(x => { r.chestWhatnot = x; }).catch(e => { r.chestWhatnot = { error: String(e?.message || e).slice(0, 120) }; }); return r; };
  try {
    if (url.pathname==='/live-studio/settings') {
      const result=await room.update(body.settings,body.revision);
      return deps.json({ok:!result.conflict,...result},result.conflict?409:200);
    }
    // A ByteRider_97 reaction: { kind:'mascot', state, text }.
    if (url.pathname==='/live-studio/effect') return deps.json({ok:true,...await room.trigger(body.kind, body.kind==='mascot'?{mascotState:String(body.state||''),say:String(body.text||'').slice(0,200)}:{})});
    if (url.pathname==='/live-studio/overlay-link') return deps.json({ok:true,...await room.rotateOverlay()});
    if (url.pathname==='/live-studio/revoke') return deps.json(await room.revokeOverlay());
    if (url.pathname==='/live-studio/stage') return deps.json({ok:true,...await room.setStage(body.stage)});
    if (url.pathname==='/live-studio/pics') return deps.json({ok:true,...await room.setPics(body.pics)});
    if (url.pathname==='/live-studio/machine') return deps.json({ok:true,...await room.setMachine(body)});
    // The Shed Dungeon: a follow / share / bookmark tapped in, or a fix.
    if (url.pathname==='/live-studio/camera') return deps.json({ok:true,...room.camera(body)});
    if (url.pathname==='/live-studio/dungeon-tap') return deps.json({ok:true,...await withChest(await room.dungeonTap(String(body.kind||'')))});
    if (url.pathname==='/live-studio/dungeon-adjust') return deps.json({ok:true,...await withChest(await room.dungeonAdjust({...(body.mana!==undefined?{mana:body.mana}:{}),...(body.floor!==undefined?{floor:body.floor}:{}),...(body.door!==undefined?{door:body.door}:{}),resetWeek:body.resetWeek===true}))});
    // Chat picks: open a vote, tap the winner, or close it.
    if (url.pathname==='/live-studio/vote-open') return deps.json({ok:true,...await room.openVote(String(body.kind||''))});
    if (url.pathname==='/live-studio/vote-pick') return deps.json({ok:true,...await withChest(await room.pickVote(Number(body.index),String(body.who||'')))});
    if (url.pathname==='/live-studio/vote-close') return deps.json({ok:true,...await room.closeVote()});
    if (url.pathname==='/live-studio/trivia') return deps.json({ok:true,...await room.askTrivia({question:String(body.question||''),answer:String(body.answer||'')})});
    if (url.pathname==='/live-studio/floor-name') return deps.json({ok:true,...await room.nameFloor(String(body.name||''))});
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
    return deps.json({ok:false,error:/^(Invalid|Unknown|Sign must|Use a three|A Whatnot show|"|Stage|Settings|Vote)/.test(why)?why:'Invalid control values or service unavailable'},400);
  }
  return deps.json({ok:false,error:'Not found'},404);
}
