export const onlineRoomHtml=`<section class="dl-panel" id="dl-online"><h2>Play friends on other devices</h2><p>Create a private room and send its guest link to your opponent. Choose two players or a four-player Commander pod. Each guest gets a separate single-use link and loads their own deck. Hands and libraries stay private; the host plays first. Rooms expire after four hours.</p><div class="dl-actions"><label for="dl-room-mode">Online table <select id="dl-room-mode"><option value="rules">Rules checked · supported cards</option><option value="table">Freeform · apply card rules yourselves</option></select></label><label>Players <select id="dl-room-capacity"><option value="2">2 players</option><option value="4">4 players · Commander freeform</option></select></label><button id="dl-create-room" class="primary">Create private room</button><button id="dl-upload-room" hidden>Submit my loaded deck</button><button id="dl-leave-room" hidden>Leave room on this device</button></div><label id="dl-invite-label" hidden>Guest invite links · one line per guest<textarea id="dl-invite-link" readonly rows="3"></textarea><button id="dl-copy-invite">Copy guest link</button></label><p id="dl-room-status" class="dl-status" role="status">For solo practice, use the simulated opponent above. To join a friend, open their guest link.</p><p class="dl-note">Rules-checked rooms enforce the same supported card pool as solo play. Freeform rooms work like a shared tabletop: each player moves their own cards and applies effects manually. Online play sends card identifiers and actions to the match server; room data is stored for up to four hours. No public matchmaking or chat. Leaving does not concede; reopen this page on this device to reconnect.</p></section>`;

export const onlineRoomClient=String.raw`
let online=null,onlineBusy=false,pollTimer=null,onlineRequest=false;
const roomStatus=t=>$('dl-room-status').textContent=t;
const roomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
function rowsForRoom(){if(!decks[0]||decks[0].input!==$('dl-list-0').value||selectedFormat()==='commander'&&decks[0].commanderInput!==$('dl-commander-0').value.trim())throw Error('Load your current deck first.');return decks[0].rows.map(c=>({id:c.id,quantity:c.quantity,section:c.deckSection||'main'}));}
function rememberRoom(){try{sessionStorage.setItem('mp-deck-room-active',JSON.stringify(online));localStorage.setItem('mp-deck-room-last',JSON.stringify(online));}catch{roomStatus('Room is connected, but browser storage is unavailable. Keep this tab open to retain your seat.');}}
async function roomRequest(path,body,key=online?.key){
 const r=await fetch('/deck-lab/rooms'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(key?{Authorization:'Bearer '+key}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(35000)});
 const data=await r.json();if(!r.ok){const e=Error(data.error||'Room service unavailable.');e.status=r.status;throw e;}return data;
}
function displayRoom(data){
 if(!online||data.revision<online.revision)return;online.revision=data.revision;online.names=data.names;online.seat=data.seat;online.mode=data.mode;online.capacity=data.capacity||2;$('dl-format').value=data.format||'casual';$('dl-format').disabled=true;$('dl-room-capacity').value=String(data.capacity||2);$('dl-room-capacity').disabled=true;updateFormatUi();rememberRoom();
 if(online.inviteLink){$('dl-invite-link').value=online.inviteLink;$('dl-invite-label').hidden=false;}
 $('dl-leave-room').hidden=false;$('dl-upload-room').hidden=!!data.state||!!data.ready?.[online.seat];$('deck-lab').classList.add('dl-online-connected');
 $('dl-name-0').value=data.names[0];$('dl-name-1').value=data.names[1];
 $('dl-rematch').hidden=true;$('dl-undo').hidden=true;
 if(data.state){const firstMatch=!state;state=data.state;$('dl-match').hidden=false;if(firstMatch)$('deck-lab').classList.add('dl-playing');render();roomStatus('Connected · '+(data.mode==='rules'?'server checks supported rules':'shared freeform table')+' · '+(data.state.result?'match ended':'your seat: '+(data.seat===0?'host':'guest '+data.seat))+'.');}
 else{state=null;$('dl-match').hidden=true;$('deck-lab').classList.remove('dl-playing');roomStatus(data.joined?'All players joined. '+(data.ready?.[data.seat]?'Waiting for all '+(data.capacity||2)+' decks ('+data.ready.filter(Boolean).length+' ready).':'Load your deck in the first panel, then choose Submit my loaded deck.'):'Room: '+data.joinedCount+'/'+(data.capacity||2)+' players joined. Send each guest a different invite line. Load and submit your deck if needed.');}
}
async function syncRoom(force=false){
 if(!online||onlineBusy||onlineRequest||document.hidden&&!force)return;onlineRequest=true;
 try{const data=await roomRequest('/'+online.room+'/state');if(force||data.revision!==online.revision)displayRoom(data);else if(state)roomStatus('Connected · last sync '+new Date().toLocaleTimeString()+'.');}
 catch(e){$('dl-leave-room').hidden=false;roomStatus((e.status===410?'Room expired. ':'Connection interrupted. ')+e.message+' Your seat is kept for reconnecting.');if(e.status===410){clearInterval(pollTimer);pollTimer=null;}}
 finally{onlineRequest=false;}
}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(()=>syncRoom(),2500);}
const localAct=act;act=function(fn){
 if(!online)return localAct(fn);if(onlineBusy)return;let action;try{action=fn();if(!action?.type)throw Error('That local action is unavailable in an online room.');}catch(e){$('dl-feedback').textContent=e.message;return;}
 return sendRoomAction(action);
};
async function sendRoomAction(action){
 if(!online||onlineBusy)return;onlineBusy=true;
 try{const data=await roomRequest('/'+online.room+'/action',{revision:online.revision,action});bottom=[];attacks=[];blocking={};intent=null;pendingBlocker=null;displayRoom(data);}
 catch(e){$('dl-feedback').textContent=e.message;roomStatus(e.message);}
 finally{onlineBusy=false;await syncRoom(true);}
}
// Online actions send intent only. The server owns cards, shuffling and legality.
for(const name of ['land','cast','pass','attack','block','discard','mulligan','keep','manual']){
 const original=Engine[name];Engine[name]=function(s,...args){return online?{type:name,args}:original(s,...args);};
}
$('dl-create-room').onclick=async()=>{
 if(online){roomStatus('Leave the current room before creating another.');return;}if(onlineBusy)return;onlineBusy=true;$('dl-create-room').disabled=true;roomStatus('Verifying your deck and creating a private room…');
 try{const data=await roomRequest('',{mode:$('dl-room-mode').value,format:selectedFormat(),capacity:Number($('dl-room-capacity').value),name:$('dl-name-0').value,cards:rowsForRoom()},null);online={room:data.room,key:data.key,revision:data.revision,seat:0};online.inviteLink=(data.invites||[data.invite]).map(invite=>{const link=new URL('/deck-lab',location.origin);link.hash=new URLSearchParams({room:data.room,join:invite});return link.href;}).join('\n');$('dl-invite-link').value=online.inviteLink;$('dl-invite-label').hidden=false;displayRoom(data);startPolling();}
 catch(e){roomStatus(e.message);}finally{onlineBusy=false;$('dl-create-room').disabled=false;}
};
$('dl-upload-room').onclick=async()=>{
 if(!online||onlineBusy)return;onlineBusy=true;roomStatus('Verifying your deck for the match…');
 try{const data=await roomRequest('/'+online.room+'/deck',{revision:online.revision,name:$('dl-name-0').value,cards:rowsForRoom()});displayRoom(data);}
 catch(e){roomStatus(e.message);}finally{onlineBusy=false;}
};
$('dl-copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText($('dl-invite-link').value);roomStatus('Guest link copied. Send each invite line only to its intended guest.');}catch{$('dl-invite-link').select();roomStatus('Select and copy the guest link above.');}};
$('dl-leave-room').onclick=()=>{clearInterval(pollTimer);online=null;state=null;$('dl-format').disabled=false;$('dl-room-capacity').disabled=false;$('dl-match').hidden=true;$('deck-lab').classList.remove('dl-online-connected','dl-playing');$('dl-invite-label').hidden=true;$('dl-leave-room').hidden=true;$('dl-upload-room').hidden=true;$('dl-rematch').hidden=false;$('dl-undo').hidden=false;try{sessionStorage.removeItem('mp-deck-room-active');localStorage.removeItem('mp-deck-room-last');}catch{}roomStatus('Disconnected on this device. The room remains available until it expires.');};
const localStart=start;start=function(){if(online){roomStatus('Leave the online room before starting a local match.');return;}localStart();};$('dl-start').onclick=start;$('dl-rematch').onclick=start;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncRoom(true);});
(async()=>{
 const fragment=new URLSearchParams(location.hash.slice(1)),room=fragment.get('room'),invite=fragment.get('join');
 if(room&&invite){
  // Remove the join capability from the address bar and referrer immediately.
  window.history.replaceState(null,'',location.pathname+location.search);onlineBusy=true;
  try{const key=roomKey();online={room,key,revision:-1,seat:1};rememberRoom();const data=await roomRequest('/'+room+'/join',{invite,key},null);displayRoom(data);startPolling();}
  catch(e){roomStatus(e.message);}finally{onlineBusy=false;}
 }else{
  try{online=JSON.parse(sessionStorage.getItem('mp-deck-room-active')||localStorage.getItem('mp-deck-room-last')||'null');if(online?.room&&online?.key){await syncRoom(true);startPolling();}else online=null;}catch{online=null;}
 }
})();
`;
