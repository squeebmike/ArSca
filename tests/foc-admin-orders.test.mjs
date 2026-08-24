import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

const dashboard=fs.readFileSync('dashboard.html','utf8');
const service=fs.readFileSync('scripts/foc-preorders.mjs','utf8');

assert.match(service,/path==='\/foc\/admin\/orders'.*request\.method==='GET'.*request\.method==='PATCH'/,'staff comic-order list/update route must exist');
assert.match(service,/path==='\/foc\/admin\/orders\/email'.*request\.method==='POST'/,'staff confirmation resend route must exist');
assert.match(service,/confirmation_email_sent_at:new Date\(\)\.toISOString\(\)/,'successful confirmation sends must be recorded');
assert.match(dashboard,/COMIC PREORDER ORDERS/,'Orders tab must name the comic preorder queue clearly');
assert.match(dashboard,/exact books and covers, pickup or shipping details, address, and confirmation-email status/i,'Orders tab must explain the fulfillment data it exposes');
assert.match(dashboard,/if\(name === 'orders'\).*renderFocPreorderOrders\(\).*renderStorefrontOrders\(\)/,'opening Orders must refresh both comic and regular storefront orders');
assert.match(dashboard,/MARK PICKED UP/,'pickup preorders must have a fulfillment action');
assert.match(dashboard,/MARK SHIPPED/,'shipping preorders must have a fulfillment action');

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const calls=[];
const deps={
  CORS:{},
  json,
  requireStoreUser:async()=>({user:{id:'staff-1'}}),
  readJsonWithLimit:async request=>({data:await request.json()}),
  supabaseAdminFetch:async(_env,path,options={})=>{
    calls.push({path,options});
    if(path.startsWith('foc_preorder_orders?')&&(!options.method||options.method==='GET'))return{data:[{id:'order-1',store_id:'store-1',order_number:'FOC-1',status:'ready_for_pickup',fulfillment_method:'pickup',cycle:{foc_date:'2026-09-07'}}]};
    if(path.startsWith('foc_preorder_items?')&&(!options.method||options.method==='GET'))return{data:[{id:'item-1',order_id:'order-1',quantity:2,sku_snapshot:{title:'Test Comic',variantLabel:'Cover B'}}]};
    return{data:[]};
  },
};

const list=await handleFocRequest(new Request('https://x/foc/admin/orders?store_id=store-1'),{},new URL('https://x/foc/admin/orders?store_id=store-1'),deps);
assert.equal(list.status,200);
const listed=await list.json();
assert.equal(listed.orders[0].items[0].sku_snapshot.title,'Test Comic','staff list must attach the exact ordered book lines');

const update=await handleFocRequest(new Request('https://x/foc/admin/orders',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({storeId:'store-1',orderId:'order-1',status:'completed'})}),{},new URL('https://x/foc/admin/orders'),deps);
assert.equal(update.status,200);
assert.ok(calls.some(call=>call.path.startsWith('foc_preorder_orders?id=eq.order-1')&&call.options.method==='PATCH'),'pickup completion must update the order');
assert.ok(calls.some(call=>call.path.startsWith('foc_preorder_items?order_id=eq.order-1')&&call.options.method==='PATCH'),'pickup completion must update its book lines');

console.log('FOC staff order fulfillment contract checks passed');
