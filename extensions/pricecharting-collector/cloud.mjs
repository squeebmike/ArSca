export const DASHBOARD='https://squeebmike.github.io/ArSca/dashboard.html';
export const isDashboard=url=>{try{const u=new URL(url);return u.origin==='https://squeebmike.github.io'&&u.pathname==='/ArSca/dashboard.html';}catch{return false;}};
// Only this fixed API is callable in the signed-in dashboard. Its existing
// storeWorkerFetch adds/refreshes auth; no session token leaves that page.
export async function dashboardCloudRequest(path,method,body){
 if(location.origin!=='https://squeebmike.github.io'||location.pathname!=='/ArSca/dashboard.html')throw Error('Open the ArSca dashboard first.');
 if(!/^\/reference-collector\/(batch|sets|cards)(\?[^#]*)?$/.test(path)||!['GET','POST'].includes(method))throw Error('Invalid cloud reference request.');
 if(typeof storeWorkerFetch!=='function')throw Error('Wait for the dashboard to finish loading, then connect again.');
 const response=await storeWorkerFetch(path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();return {status:response.status,data};
}
export async function cloudRequest(chrome,path,method='GET',body=null){
 let connection=(await chrome.storage.local.get('cloudConnection')).cloudConnection,tab;
 try{if(connection?.tabId)tab=await chrome.tabs.get(connection.tabId);}catch{}
 if(!tab||!isDashboard(tab.url)){
  tab=(await chrome.tabs.query({url:DASHBOARD+'*'})).find(t=>isDashboard(t.url));
  if(!tab)throw Error('Open your signed-in ArSca dashboard and click Connect cloud.');
 }
 const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:dashboardCloudRequest,args:[path,method,body]}))[0]?.result;
 if(!result||result.status<200||result.status>=300)throw Error(result?.data?.error||'Cloud upload failed. Sign in to the dashboard, then resume.');
 if(connection?.tabId!==tab.id)await chrome.storage.local.set({cloudConnection:{tabId:tab.id,connectedAt:Date.now()}});
 return result.data;
}
export async function uploadReferences(chrome,rows){
 const groups=new Map();for(const row of rows){if(!groups.has(row.consoleId))groups.set(row.consoleId,[]);groups.get(row.consoleId).push(row);}
 const summaries=[];
 for(const cards of groups.values())for(let offset=0;offset<cards.length;offset+=150){
  const batch=cards.slice(offset,offset+150);
  // A single metadata-only outbox survives a browser interruption. The server
  // upserts by source URL, so replaying after an uncertain response is safe.
  await chrome.storage.local.set({pendingCloudBatch:batch});
  const data=await cloudRequest(chrome,'/reference-collector/batch','POST',{cards:batch});
  if(data.rejected)throw Error(`${data.rejected} source records need review. This batch remains queued locally; open the source and resume after correcting it.`);
  summaries.push(data.summary);await chrome.storage.local.remove('pendingCloudBatch');
 }
 return summaries;
}
