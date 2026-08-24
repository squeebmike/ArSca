import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

const service=fs.readFileSync('scripts/foc-preorders.mjs','utf8');
const dashboard=fs.readFileSync('dashboard.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20260824203612_foc_shippo_shipping_labels.sql','utf8');

assert.match(service,/path==='\/foc\/admin\/orders\/label'.*request\.method==='POST'/,'Shippo label route must be wired');
assert.match(service,/shipping_label_status:'purchasing'/,'purchase must claim the order before calling Shippo');
assert.match(service,/shipping_label_status:'review_required'/,'ambiguous Shippo outcomes must block automatic retry');
assert.match(service,/https:\/\/api\.goshippo\.com\/transactions\//,'purchase must use Shippo transactions');
assert.match(service,/label_file_type:'PDF_4x6'/,'labels must be printer-ready 4x6 PDFs');
assert.match(dashboard,/GET SHIPPO LABEL/,'ready shipping orders must expose a Shippo label action');
assert.match(dashboard,/PRINT 4×6 LABEL/,'purchased labels must be printable from Orders');
assert.match(dashboard,/Shippo will charge the connected account/,'staff must confirm the live Shippo charge');
assert.match(migration,/shipping_label_transaction_id text/,'Shippo transaction ID must persist on the order');
assert.match(migration,/create unique index.*idx_foc_orders_shippo_transaction/s,'Shippo transaction IDs must be unique');

const order={id:'order-1',store_id:'store-1',order_number:'FOC-1',status:'reserved',fulfillment_method:'shipping',customer_name:'Customer',customer_email:'customer@example.com',customer_phone:'5555555555',shipping_address:{line1:'1 Main St',city:'Portland',state:'OR',zip:'97201'},shipping_service:'USPS Ground Advantage',shipping_cents:599};
const rows={...order};
const kv=new Map();const calls=[],shippoCalls=[];
const env={SHIPPO_API_TOKEN:'secret',LBA_KV:{get:async(key,type)=>{const value=kv.get(key);return type==='json'&&value?JSON.parse(value):value||null;},put:async(key,value)=>kv.set(key,value)}};
const deps={
  json:(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}),
  readJsonWithLimit:async request=>({data:await request.json()}),requireStoreUser:async()=>({user:{id:'staff'}}),
  supabaseAdminFetch:async(_env,path,options={})=>{calls.push({path,options});
    if(path.startsWith('store_settings?'))return{data:[{payment_settings:{shipping:{enabled:true,provider:'shippo',shipFrom:{name:'Mana Pocket',line1:'2 Shop St',city:'Portland',state:'OR',zip:'97202'},defaultParcel:{length:'12',width:'9',height:'1',distance_unit:'in',weight:'1',mass_unit:'lb'}}}}]};
    if(path.startsWith('foc_preorder_items?'))return{data:[{quantity:2}]};
    if(path.startsWith('foc_preorder_orders?')&&(!options.method||options.method==='GET'))return{data:[{...rows}]};
    if(path.includes('shipping_label_transaction_id=is.null')&&options.method==='PATCH'){rows.shipping_label_status='purchasing';return{data:[{...rows}]};}
    if(path.includes('shipping_label_status=eq.purchasing')&&options.method==='PATCH'){Object.assign(rows,JSON.parse(options.body));return{data:[]};}
    if(path.startsWith('foc_preorder_orders?')&&options.method==='PATCH'){Object.assign(rows,JSON.parse(options.body));return{data:[]};}
    return{data:[]};
  },
  shippoFetch:async(url)=>{shippoCalls.push(url);return url.endsWith('/shipments/')
    ? new Response(JSON.stringify({rates:[{object_id:'rate-1',amount:'5.25',provider:'USPS',servicelevel:{name:'Ground Advantage'},estimated_days:3}]}),{status:200})
    : new Response(JSON.stringify({status:'SUCCESS',object_id:'tx-1',label_url:'https://labels.example/label.pdf',tracking_number:'9400',tracking_url_provider:'https://tools.usps.com/track/9400'}),{status:200});},
};

const request=body=>new Request('https://x/foc/admin/orders/label',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
let response=await handleFocRequest(request({storeId:'store-1',orderId:'order-1',action:'quote'}),env,new URL('https://x/foc/admin/orders/label'),deps);
assert.equal(response.status,200);const quote=await response.json();assert.equal(quote.recommended.rateId,'rate-1');
response=await handleFocRequest(request({storeId:'store-1',orderId:'order-1',action:'purchase',rateId:'rate-1'}),env,new URL('https://x/foc/admin/orders/label'),deps);
assert.equal(response.status,200);const purchase=await response.json();assert.equal(purchase.label.transactionId,'tx-1');assert.equal(rows.shipping_label_status,'purchased');assert.equal(rows.shipping_tracking_number,'9400');
assert.ok(calls.some(call=>call.path.includes('shipping_label_transaction_id=is.null')&&call.options.method==='PATCH'),'purchase must use the guarded atomic claim');
response=await handleFocRequest(request({storeId:'store-1',orderId:'order-1',action:'purchase',rateId:'rate-1'}),env,new URL('https://x/foc/admin/orders/label'),deps);
assert.equal(response.status,200);assert.equal((await response.json()).alreadyPurchased,true,'a repeat click must return the stored label');
assert.equal(shippoCalls.filter(url=>url.endsWith('/transactions/')).length,1,'a repeat click must never purchase a second Shippo transaction');

console.log('FOC Shippo label quote, purchase, persistence, and dashboard contracts passed');
