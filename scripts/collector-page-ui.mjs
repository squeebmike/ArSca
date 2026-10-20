// Presentation only. Product identity, stock and reference data stay with callers.
export const collectorPageStyles=`<style>
.mp-set-hero{padding:clamp(20px,4vw,36px);margin:18px 0 20px;border:1px solid var(--wo-border,rgba(255,255,255,.18));border-radius:20px;background:var(--wo-surface,rgba(255,255,255,.04))}
.mp-set-kicker{font:750 12px/1.5 system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--wo-accent,currentColor);margin:0 0 10px}
.mp-set-hero h1{font-size:clamp(28px,5vw,44px);line-height:1.12;max-width:24ch;text-wrap:balance;margin:0 0 14px}
.mp-set-hero p{max-width:70ch;line-height:1.65;font-size:16px}.mp-set-stats{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 0;padding:0;list-style:none}.mp-set-stats li{padding:7px 12px;border:1px solid var(--wo-border,rgba(255,255,255,.18));border-radius:9px;font:650 13px/1.5 system-ui}
.mp-set-actions,.mp-section-nav{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 24px}.mp-set-actions a,.mp-section-nav a{display:inline-flex;align-items:center;min-height:44px;padding:10px 15px;border-radius:10px;border:1px solid var(--wo-border,rgba(255,255,255,.22));font:650 14px/1.4 system-ui;text-decoration:none;color:var(--wo-text,inherit);background:var(--wo-surface,transparent)}.mp-set-actions a:first-child{background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);border-color:transparent}.mp-section-nav a[aria-current=page]{border-color:var(--wo-accent,currentColor)}
.mp-stock-panel{margin:26px 0 34px;padding:clamp(16px,3vw,24px);border:1px solid var(--wo-border,rgba(255,255,255,.18));border-radius:16px;background:var(--wo-surface,transparent)}.mp-stock-panel h2{font-size:24px;line-height:1.25;margin:0 0 10px}.mp-stock-panel>p{font-size:14px;line-height:1.6;max-width:75ch}.mp-stock-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:14px}.mp-stock-grid .mp-store-copy{background:var(--wo-bg,transparent);font:14px/1.6 system-ui}.mp-stock-grid .mp-store-copy strong{font-size:15px}.mp-collector-page>p{font-size:16px;line-height:1.65}
.mp-checklist-tools{margin:28px 0 18px;padding:20px;border:1px solid var(--wo-border,rgba(255,255,255,.18));border-radius:14px;background:var(--wo-surface,transparent)}.mp-checklist-tools label{display:block;font:700 15px/1.5 system-ui;margin-bottom:10px}.mp-checklist-tools input{width:min(100%,480px);min-height:48px;padding:12px;border-radius:8px;border:1px solid var(--wo-border,#888);background:var(--wo-bg,#16101f);color:var(--wo-text,#fff);font:16px/1.4 system-ui}.mp-checklist-tools button{min-height:48px;padding:12px 18px;margin:8px 0;border:0;border-radius:8px;background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);font:750 15px/1.4 system-ui;cursor:pointer}
.mp-set-row{align-items:center;min-height:54px;font-size:15px;line-height:1.5}.mp-set-row span:last-child{font-size:13px;text-align:right}.mp-set-row:hover{background:var(--wo-surface,rgba(255,255,255,.04))}.mp-collector-page nav[aria-label$="pages"]{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:24px 0}.mp-collector-page nav[aria-label$="pages"] a,.mp-collector-page nav[aria-label$="pages"] span{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:8px 12px;border:1px solid var(--wo-border,rgba(255,255,255,.2));border-radius:8px;text-decoration:none;font-size:14px}.mp-collector-page nav[aria-label$="pages"] [aria-current=page]{background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);font-weight:750}
.mp-collector-page [id],.mp-art [id]{scroll-margin-top:calc(var(--nav-height,92px) + 20px)}.mp-collector-page a:focus-visible,.mp-collector-page button:focus-visible,.mp-collector-page input:focus-visible,.mp-art a:focus-visible{outline:3px solid var(--wo-accent,currentColor);outline-offset:4px}
@media(max-width:600px){.mp-set-row{align-items:flex-start;flex-direction:column;gap:4px}.mp-set-row span:last-child{text-align:left}.mp-checklist-tools input,.mp-checklist-tools button{width:100%}.mp-set-actions a{flex:1 1 140px;justify-content:center}.mp-set-hero{border-radius:14px}}
</style>`;

export function setPageHeader({title,label,description,stats=[],actions=[]},esc){
 return '<header class="mp-set-hero"><p class="mp-set-kicker">'+esc(label)+'</p><h1>'+esc(title)+'</h1>'+(description?'<p>'+esc(description)+'</p>':'')+'<ul class="mp-set-stats">'+stats.filter(Boolean).map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></header><nav class="mp-set-actions" aria-label="Explore this set">'+actions.map(([name,href])=>'<a href="'+esc(href)+'">'+esc(name)+'</a>').join('')+'</nav>';
}

// Preserve editorial markup and existing unique anchors. Add stable anchors only
// to headings missing one, with collision checks against every existing ID.
export function articleContents(body,esc){
 const used=new Set([...body.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]));
 const links=[];let number=0;
 const html=body.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi,(full,attrs,content)=>{
  const text=content.replace(/<[^>]*>/g,'').trim();if(!text)return full;
  let id=attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
  if(!id){do{id='guide-section-'+(++number);}while(used.has(id));used.add(id);attrs+=' id="'+id+'"';}
  links.push('<a href="#'+esc(id)+'">'+text+'</a>');return '<h2'+attrs+'>'+content+'</h2>';
 });
 return {html,nav:links.length>1?'<nav class="mp-art-contents" aria-label="On this page"><strong>On this page</strong><div>'+links.join('')+'</div></nav>':''};
}
