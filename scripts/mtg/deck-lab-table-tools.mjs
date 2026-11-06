export const tableToolsStyles=String.raw`
.dl-lands .dl-peek{right:-12px;top:-12px}.dl-manual .dl-lands .dl-peek{display:block}.dl-playing .dl-fallback{width:100%!important;box-sizing:border-box;height:100%!important;min-height:0!important;padding:3px;font-size:10px;line-height:1.15;overflow-wrap:anywhere;overflow:hidden}.dl-counter-badge{position:absolute;left:2px;bottom:23px;max-width:100%;font-size:10px;line-height:1.2;background:#452760ed;color:#fff;border:1px solid #d9b9f5;border-radius:4px;padding:2px;overflow-wrap:anywhere}.dl-fallback{border:2px solid #d4b475;background:radial-gradient(#536d60,#172d35)!important;min-height:100%;font-weight:750;text-align:center}.dl-playing .dl-card{touch-action:pan-x}.dl-card-ghost{position:fixed!important;width:90px!important;height:126px!important;z-index:2147483000!important;pointer-events:none!important;opacity:.85;transform:rotate(-4deg);filter:drop-shadow(0 10px 14px #000)}.dl-drop-tray{position:fixed;left:5%;right:5%;bottom:12%;z-index:2147483100;background:#112832f5;border:2px solid #d9b574;border-radius:14px;display:flex;justify-content:center;flex-wrap:wrap;gap:7px;padding:12px;box-shadow:0 0 0 100vmax #0005}.dl-drop-tray button{min-height:48px!important;min-width:85px;color:white;background:#244552;border:1px solid #759ca5;border-radius:8px;padding:8px}.dl-drop-tray button[data-over="true"]{background:#d9b574;color:#17232d}.dl-token-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dl-token-form label:first-child{grid-column:1/-1}.dl-token-form input{display:block;width:100%}.dl-token-form button{grid-column:1/-1}.dl-playing .dl-side-zone h3{margin:0!important;line-height:1.1}.dl-manual-help{font-size:10px;color:#a7c6ce}.dl-playing .dl-card[data-tapped="true"] img{transform:rotate(90deg);opacity:.7}@media(max-width:700px){.dl-counter-badge{font-size:8px}}@media(prefers-reduced-motion:reduce){.dl-card-ghost{transform:none}}
`;
export const tableToolsClient=String.raw`
function manualSeat(p){return state&&!state.result&&state.phase!=='opening'&&!state.players[p]?.eliminated&&(state.mode==='manual'||state.mode==='remote-table'&&p===0);}
function tokenDialog(p){
 if(!manualSeat(p))return;
 $('dl-inspect-body').innerHTML='<h2>Create creature tokens</h2><p>Enter the token described by your card. Token abilities and their effects are manual. Tokens disappear when moved out of the battlefield.</p><form id="dl-token-form" class="dl-token-form"><label>Token name<input id="dl-token-name" maxlength="80" value="Soldier" required></label><label>Power<input id="dl-token-power" type="number" min="-99" max="99" value="1" required></label><label>Toughness<input id="dl-token-toughness" type="number" min="-99" max="99" value="1" required></label><label>How many<input id="dl-token-count" type="number" min="1" max="20" value="1" required></label><button type="submit">Create tokens</button></form>';
 $('dl-card-actions').replaceChildren();$('dl-token-form').onsubmit=async e=>{e.preventDefault();const data={player:p,kind:'token',label:$('dl-token-name').value,power:Number($('dl-token-power').value),toughness:Number($('dl-token-toughness').value),value:Number($('dl-token-count').value)};$('dl-inspect').close();await act(()=>Engine.manual(state,data));};if(!$('dl-inspect').open)$('dl-inspect').showModal();
}
function tableDrop(found,to){
 if(!manualSeat(found.p))return;
 const {c,p,zone}=found;if(to===zone)return;
 if(to==='stack'||to==='field'&&zone==='hand'&&!/\bLand\b/.test(c.type_line)||zone==='commandZone'&&to==='field')return act(()=>Engine.manual(state,{player:p,kind:'table-cast',id:c.id,from:zone}));
 if(zone==='stack')return act(()=>Engine.manual(state,{player:p,kind:'table-resolve',id:c.id,to}));
 return act(()=>Engine.manual(state,{player:p,from:zone,to,id:c.id}));
}
document.addEventListener('dragstart',e=>{if(e.target.closest('#dl-match [data-card]'))e.preventDefault();});
let tableDrag=null,suppressTableClick=0;
function clearTableDrag(){tableDrag?.ghost?.remove();tableDrag?.tray?.remove();tableDrag=null;}
document.addEventListener('pointerdown',e=>{
 if(e.button!==0||e.target.closest('[data-peek],dialog'))return;const el=e.target.closest('#dl-match [data-card]');if(!el||$('dl-match').dataset.motion==='moving')return;const found=locate(el.dataset.card);if(!found||!manualSeat(found.p))return;tableDrag={el,found,x:e.clientX,y:e.clientY,at:Date.now(),pointer:e.pointerId,touch:e.pointerType==='touch'};
});
document.addEventListener('pointermove',e=>{
 const d=tableDrag;if(!d||e.pointerId!==d.pointer)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.ghost){if(Math.hypot(dx,dy)<12||d.touch&&(Date.now()-d.at<160||Math.abs(dx)>Math.abs(dy)))return;d.el.setPointerCapture?.(e.pointerId);d.ghost=d.el.cloneNode(true);d.ghost.classList.add('dl-card-ghost');d.ghost.setAttribute('aria-hidden','true');d.ghost.removeAttribute('data-card');document.body.append(d.ghost);d.tray=document.createElement('div');d.tray.className='dl-drop-tray';d.tray.setAttribute('aria-label','Drop card into a zone');d.tray.innerHTML=[['field','Battlefield'],['stack','Cast / stack'],['graveyard','Graveyard'],['exile','Exile'],['hand','Hand'],['library','Library bottom'],...(d.found.c.isCommander?[['commandZone','Command zone']]:[])].map(([z,n])=>'<button type="button" data-drop-zone="'+z+'">'+n+'</button>').join('');document.body.append(d.tray);}
 e.preventDefault();d.ghost.style.left=(e.clientX-45)+'px';d.ghost.style.top=(e.clientY-63)+'px';const hit=document.elementFromPoint(e.clientX,e.clientY);d.to=hit?.closest('[data-drop-zone]')?.dataset.dropZone;if(!d.to&&hit?.closest('#dl-human .dl-creatures,#dl-human .dl-lands'))d.to='field';if(!d.to&&hit?.closest('#dl-human .dl-own-hand'))d.to='hand';for(const b of d.tray.querySelectorAll('button'))b.dataset.over=String(b.dataset.dropZone===d.to);
},{passive:false});
document.addEventListener('pointerup',e=>{const d=tableDrag;if(!d||e.pointerId!==d.pointer)return;if(!d.ghost&&d.touch&&Math.hypot(e.clientX-d.x,e.clientY-d.y)>12)suppressTableClick=Date.now()+600;if(d.ghost){e.preventDefault();suppressTableClick=Date.now()+600;const f=d.found,to=d.to;clearTableDrag();if(to)tableDrop(f,to);}else clearTableDrag();});
document.addEventListener('pointercancel',clearTableDrag);window.addEventListener('resize',clearTableDrag);document.addEventListener('visibilitychange',clearTableDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape')clearTableDrag();});
document.addEventListener('click',e=>{
 if(Date.now()<suppressTableClick){e.preventDefault();e.stopImmediatePropagation();return;}if(e.target.closest('[data-peek],dialog'))return;const el=e.target.closest('#dl-match [data-card]');if(!el)return;const found=locate(el.dataset.card);if(!found||!manualSeat(found.p))return;
 if(['hand','commandZone'].includes(found.zone)){e.preventDefault();e.stopImmediatePropagation();tableDrop(found,'field');}
 else if(found.zone==='field'){e.preventDefault();e.stopImmediatePropagation();act(()=>Engine.manual(state,{player:found.p,from:'field',id:found.c.id,kind:'tap'}));}
},true);
`;
