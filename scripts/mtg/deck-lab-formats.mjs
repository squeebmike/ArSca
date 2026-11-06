export const formatStyles=String.raw`
.dl-commander-entry{display:none}.dl-format-commander .dl-commander-entry{display:block}.dl-format-panel{margin:18px 0}.dl-resource-row{display:flex;min-width:0;min-height:0;gap:10px}.dl-resource-row>.dl-lands{flex:1}.dl-command-zone{min-width:65px;max-width:150px}.dl-command-zone .dl-gallery{min-height:0;gap:5px;padding:0 4px}.dl-command-zone .dl-cardwrap{width:36px;flex-basis:36px}.dl-command-zone .dl-caption,.dl-command-zone .dl-stats,.dl-command-zone .dl-peek{display:none}.dl-cmd-tax{display:none}.dl-command-zone .dl-cmd-tax{display:block;position:absolute;bottom:1px;right:1px;background:#3e3016;color:#ffdf9c;font-size:10px;padding:1px 2px}.dl-command-mark{position:absolute;top:3px;left:3px;background:#72551c;color:#fff4cb;border-radius:4px;font-size:10px;padding:1px 4px}.dl-cmd-track{font-size:10px!important;min-height:24px!important;padding:2px 6px!important}.dl-damage-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #526b73;padding:12px 0}.dl-damage-row strong{flex:1}.dl-damage-row button{min-width:44px}.dl-warning{color:#ffce94}.dl-playing .dl-resource-row .dl-lands .dl-gallery{height:calc(100% - 13px)}.dl-playing .dl-command-zone h3{white-space:nowrap;font-size:9px!important}.dl-playing .dl-command-zone img{max-height:48px;width:auto}.dl-playing .dl-command-zone .dl-card{height:100%}.dl-playing .dl-command-zone .dl-gallery{height:calc(100% - 14px)}@media(max-width:700px){.dl-command-zone{min-width:54px;max-width:100px}.dl-command-zone .dl-cardwrap{width:25px;flex-basis:25px}.dl-playing .dl-command-zone img{max-height:32px}.dl-playing .dl-command-zone h3{font-size:8px!important}.dl-cmd-tax{display:none}.dl-command-zone .dl-cmd-tax{display:block;position:absolute;bottom:1px;right:1px;background:#3e3016;color:#ffdf9c;font-size:10px;padding:1px 2px}.dl-command-mark{font-size:8px;padding:1px 2px}}
`;
export const formatLayoutStyles=String.raw`
.dl-playing .dl-command-zone .dl-gallery{overflow-y:hidden;align-items:center}.dl-playing .dl-command-zone .dl-cardwrap{height:calc(100% - 4px);width:auto;aspect-ratio:5/7;flex:0 0 auto}.dl-playing .dl-command-zone img{height:100%;width:100%;max-height:none;object-fit:contain}.dl-playing .dl-command-zone h3{margin:0!important;line-height:1.1}.dl-hand-peek{font-size:10px!important;min-height:28px!important;padding:3px 6px!important}
@media(max-width:700px){.dl-format-commander.dl-playing #dl-opponent{grid-template-rows:56px 60px minmax(45px,1fr)}.dl-format-commander.dl-playing #dl-human{grid-template-rows:50px minmax(50px,1fr) 60px 115px}.dl-playing .dl-command-zone{min-width:65px}.dl-playing .dl-command-zone .dl-gallery{padding:1px 3px}.dl-playing .dl-command-zone .dl-cmd-tax{font-size:8px}.dl-playing .dl-side-header>div:first-child{min-width:0}.dl-hand-peek{max-width:75px}}
`;
export const formatHelpers=String.raw`
function selectedFormat(){return $('dl-format')?.value||'casual';}
function updateFormatUi(announce=false){
 const commander=selectedFormat()==='commander';$('deck-lab').classList.toggle('dl-format-commander',commander);
 $('dl-mode').querySelector('option[value="bot"]').disabled=commander;$('dl-room-mode').querySelector('option[value="rules"]').disabled=commander;
 if(commander){$('dl-mode').value='manual';$('dl-room-mode').value='table';}
 for(let p=0;p<2;p++)if(decks[p])preview(p);
 if(announce)message(commander?'1v1 Commander: import a Commander section or enter the commander name before loading. Freeform play uses 40 life; abilities and rule choices are manual.':'Format updated. Review the deck checks before starting.');
}
function commanderDamageView(p){
 const commands=state.commanders||[],incoming=commands.filter(c=>c.owner!==p);$('dl-inspect-body').innerHTML='<h2>Commander combat damage</h2><p>Track each commander separately. This tracker does not change life; adjust life separately. At 21 or more from one commander, check the loss condition and any effects that change it.</p>'+incoming.map(c=>{const n=state.players[p].commanderDamage?.[c.id]||0;return '<div class="dl-damage-row"><strong>'+esc(c.name)+'</strong><span class="'+(n>=21?'dl-warning':'')+'">'+n+' / 21</span>'+((!online||p===0)?'<button data-cmd-damage="'+p+'" data-commander="'+esc(c.id)+'" data-delta="-1" '+(!n?'disabled':'')+'>−1</button><button data-cmd-damage="'+p+'" data-commander="'+esc(c.id)+'" data-delta="1">+1</button>':'')+'</div>';}).join('');$('dl-card-actions').replaceChildren();$('dl-inspect').dataset.damagePlayer=p;if(!$('dl-inspect').open)$('dl-inspect').showModal();
}
function commandZoneHtml(p){const cards=state.players[p].commandZone||[];return state.format==='commander'?'<section class="dl-side-zone dl-command-zone" aria-label="'+(p?'Opponent':'Your')+' command zone"><h3>Command zone</h3><div class="dl-gallery">'+cards.map(c=>gameCard(c,p,'commandZone')).join('')+'</div></section>':'';}
`;
export const formatSetupClient=String.raw`
$('dl-format').addEventListener('change',()=>updateFormatUi(true));
for(let p=0;p<2;p++)$('dl-commander-'+p).addEventListener('input',()=>{decks[p]=null;});
document.addEventListener('click',async e=>{
 const view=e.target.closest('[data-cmd-view]');if(view){commanderDamageView(Number(view.dataset.cmdView));return;}
 const change=e.target.closest('[data-cmd-damage]');if(change){const p=Number(change.dataset.cmdDamage);await act(()=>Engine.manual(state,{player:p,kind:'commander-damage',id:change.dataset.commander,value:Number(change.dataset.delta)}));if($('dl-inspect').open)commanderDamageView(p);}
});
updateFormatUi();
`;
