// Availability is optional enrichment on reference pages, never the checkout source.
export async function optionalCatalogInventory(load,timeoutMs=3000){
 const controller=new AbortController();let timer;
 try{return await Promise.race([
  Promise.resolve().then(()=>load(controller.signal)),
  new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},timeoutMs);})
 ]);}catch{return null;}finally{clearTimeout(timer);}
}
