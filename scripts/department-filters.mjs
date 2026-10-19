const fields=['q','kind','sport','player','team','set'];
const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function departmentSelection(items,params=new URLSearchParams()) {
  const selected=Object.fromEntries(fields.map(key=>[key,String(params.get(key)||'').trim().slice(0,key==='q'?120:160)]));
  const options={};
  for(const key of ['sport','player','team','set']){
    const values=new Map();
    for(const item of items){const value=String(item[key]||'').trim();if(value&&!values.has(normalize(value)))values.set(normalize(value),value);}
    options[key]=[...values.values()].sort((a,b)=>a.localeCompare(b));
  }
  options.kind=[...new Set(items.map(item=>item.productTypeSlug).filter(x=>['singles','graded','sealed'].includes(x)))];
  const filtered=items.filter(item=>{
    if(selected.kind&&item.productTypeSlug!==selected.kind)return false;
    for(const key of ['sport','player','team','set'])if(selected[key]&&normalize(item[key])!==normalize(selected[key]))return false;
    return normalize(selected.q).split(/\s+/).filter(Boolean).every(token=>normalize([item.name,item.player,item.team,item.set,item.cardNumber,item.year,item.variant,item.brand,item.condition,item.comic?.publisher,item.comic?.coverArtists?.join(' ')].filter(Boolean).join(' ')).includes(token));
  });
  return {items:filtered,selected,options,active:fields.some(key=>selected[key])};
}
export function departmentPagePath(base,selected,page=1){
  const params=new URLSearchParams();for(const key of fields)if(selected[key])params.set(key,selected[key]);if(page>1)params.set('page',String(page));
  return base+(params.size?'?'+params.toString():'');
}
export function departmentFilterHtml(base,selection,esc,label){
  const {selected,options}=selection;
  const labels={kind:'Card format',sport:'Sport',player:'Player / character',team:'Team',set:'Set'};
  const kinds={singles:'Raw singles',graded:'Graded cards',sealed:'Sealed products'};
  return `<style>.mp-department-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:22px 0;padding:18px;background:var(--wo-surface,#291b39);border:1px solid var(--wo-border,#73518e);border-radius:14px}.mp-department-filters label:first-child{grid-column:1/-1}.mp-department-filters a,.mp-department>p a{font:650 14px/1.5 system-ui!important}.mp-department-filters label{display:grid;gap:7px;font:650 13px/1.4 system-ui}.mp-department-filters :is(input,select){width:100%;min-width:0;min-height:44px;padding:10px;border:1px solid var(--wo-border-strong,#9775af);border-radius:8px;background:var(--wo-surface-alt,#1e132c);color:var(--wo-text,#fff);font:16px system-ui}.mp-department-filters button{align-self:end;min-height:44px;padding:10px;border:0;border-radius:8px;background:var(--wo-button,#9be34c);color:var(--wo-on-button,#1e132c);font:800 15px system-ui}.mp-department-filters :is(input,select,button):focus-visible{outline:3px solid var(--wo-focus,#9be34c);outline-offset:3px}</style><form class="mp-department-filters" action="${base}" method="get" role="search" aria-label="Filter ${esc(label)}"><label>Search ${esc(label)}<input name="q" type="search" value="${esc(selected.q)}" placeholder="Name, number or keyword"></label>${Object.keys(labels).filter(key=>options[key].length||selected[key]).map(key=>`<label>${labels[key]}<select name="${key}"><option value="">All ${key==='kind'?'formats':key==='set'?'sets':key==='sport'?'sports':key==='team'?'teams':'players / characters'}</option>${[...new Set([...options[key],...(selected[key]&&!options[key].includes(selected[key])?[selected[key]]:[])])].map(value=>`<option value="${esc(value)}"${value===selected[key]?' selected':''}>${esc(key==='kind'?kinds[value]||value:value)}</option>`).join('')}</select></label>`).join('')}<button type="submit">Apply filters</button>${selection.active?`<a href="${base}" style="align-self:center">Clear filters</a>`:''}</form>`;
}
