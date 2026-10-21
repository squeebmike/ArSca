import {upcomingSets} from './upcoming-sets.mjs';
const verifiedReleaseDates=new Map(upcomingSets.filter(s=>/release/i.test(s.event)&&!/preorder/i.test(s.event)&&s.guide?.includes('/checklists/')).map(s=>[s.guide.split('/').pop(),s.date]));
// Public release metadata only. Import/editor timestamps are not release dates.
export function releaseOrderInfo(row={}){
 for(const value of [row.releaseDate,row.releasedAt,row.released_at,row.saleDate,verifiedReleaseDates.get(row.id)]){
  const date=String(value||'').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T.*)?$/);
  if(!date||Number(date[1])<1900||Number(date[1])>2200)continue;
  if(date[2]&&(Number(date[2])<1||Number(date[2])>12))continue;
  if(date[3]&&(!Number.isFinite(Date.parse(date[1]+'-'+date[2]+'-'+date[3]+'T00:00:00Z'))||new Date(date[1]+'-'+date[2]+'-'+date[3]+'T00:00:00Z').toISOString().slice(0,10)!==date[0].slice(0,10)))continue;
  const key=date[1]+(date[2]?'-'+date[2]:'')+(date[3]?'-'+date[3]:'');
  return {key,label:(date[2]?'Release ':'Set year ')+key};
 }
 const year=String(row.year||'').match(/^(19\d{2}|20\d{2}|21\d{2})$/)?.[0];
 return year?{key:year,label:'Set year '+year}:{key:'',label:''};
}
export function newestReleaseFirst(a,b){
 return releaseOrderInfo(b).key.localeCompare(releaseOrderInfo(a).key)||String(a.displayName||a.name||a.title||'').localeCompare(String(b.displayName||b.name||b.title||''))||String(a.id||'').localeCompare(String(b.id||''));
}
export const newestReleases=rows=>[...rows].sort(newestReleaseFirst);

export function releaseCatalogMetadata(set){
 return {id:set.id||set.setCode,code:set.code||set.setCode,name:set.name||set.setName,releaseDate:set.releaseDate||set.releasedAt||set.released_at||''};
}
