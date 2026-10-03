import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBookAlert, alertDue, runBookAlerts, handleBookAlertRequest } from '../scripts/book-alerts.mjs';
const now = Date.parse('2026-10-02T12:00:00Z');
const storeId='0f9dd4bc-42a7-487e-a972-2905d24513e9';
const token='a0000000-0000-4000-a000-000000000001';
const body={storeId,book:'X-Men ’92: Incursions #1',contactEmail:'READER@example.test',event:'preorder_open',consent:true};
test('explicit consent, title normalization, event and store validation',()=>{
  assert.equal(validateBookAlert(body,storeId).book_key,'x men 92 incursions#1');
  assert.equal(validateBookAlert(body,storeId).email,'reader@example.test');
  for(const change of [{consent:false},{consent:'true'},{event:'news'},{storeId:'other'},{book:'Hello\nBcc: no'},{contactEmail:'bad'}]) assert.throws(()=>validateBookAlert({...body,...change},storeId));
});
test('cutoff alert only inside the 48 hour window and before closure',()=>{
  for(const [hours,expected] of [[49,false],[48,true],[1,true],[0,false],[-1,false]]) {
    assert.equal(alertDue('preorder_cutoff',{state:'preorder',cutoff:new Date(now+hours*3600000).toISOString()},now),expected);
  }
  assert.equal(alertDue('in_stock',{state:'coming'},now),false);
  assert.equal(alertDue('in_stock',{state:'in_stock'},now),true);
});
function fixture(options={}) {
  const row={...validateBookAlert(body,storeId),id:token,unsubscribe_token:token,lease_token:token,status:'checking'};
  const sent=[]; const calls=[]; let cancelled=false;
  const deps={storeId,emailReady:()=>true,completeShippoOrigin:()=>!options.noAddress,
    isAvailable:i=>i.available,itemSlug:()=> 'x-men-92',listItemsForBook:async()=>[],
    sendEmail:async(...args)=>{sent.push(args);if(options.sendFailure)throw new Error('Provider timeout');},
    json:(data,status=200)=>Response.json(data,{status}),readJsonWithLimit:async req=>({data:await req.json()}),enforceUsageLimit:async()=>null,
    supabaseAdminFetch:async(env,path,config={})=>{
      calls.push(path);
      if(path==='rpc/claim_book_alerts')return {data:row.status==='checking'?[{...row}]:[]};
      if(path.startsWith('store_settings?'))return {data:[{receipt_settings:{storefrontEnabled:true,shippingOrigin:{name:'The Mana Pocket',street1:'Example',city:'Example',state:'WA',zip:'00000'}}}]};
      if(path.startsWith('email_notify_contacts?')){
        if(options.optoutFailure)throw new Error('DB down');
        return {data:options.optout?[{opted_out:true}]:[]};
      }
      if(path.startsWith('comic_skus?')) {
        if(options.catalogFailure)throw new Error('DB down');
        return {data:[{id:token,title:options.wrongBook?'X-MEN #1':'X-MEN 92 INCURSIONS #1 COVER A',customer_enabled:true,customer_price_cents:499,cycle:{status:'open',customer_cutoff_at:new Date(now+24*3600000).toISOString()}}]};
      }
      if(path.startsWith('book_alert_subscriptions?')&&config.method==='PATCH') {
        const values=JSON.parse(config.body);
        if(options.cancelBeforeSend&&values.status==='sending') {row.status='unsubscribed';cancelled=true;}
        if(path.includes('&status=eq.')&&!path.includes('&status=eq.'+row.status))return {data:[]};
        Object.assign(row,values);return {data:[{...row}]};
      }
      if(path.startsWith('book_alert_subscriptions?')&&config.method==='POST')return {data:null};
      throw new Error('Unexpected path '+path);
    }};
  return {deps,row,sent,calls,get cancelled(){return cancelled;}};
}
test('matching issue sends once with product link, local deadline and unsubscribe',async()=>{
  const f=fixture(); await runBookAlerts({},f.deps,now); await runBookAlerts({},f.deps,now);
  assert.equal(f.sent.length,1);assert.equal(f.row.status,'sent');
  assert.match(f.sent[0][3],/https:\/\/themanapocket.com\/preorder\//);
  assert.match(f.sent[0][3],/unsubscribe\?token=/); assert.match(f.sent[0][3],/PDT/);
});
test('different series is never treated as this book',async()=>{
  const f=fixture({wrongBook:true}); await runBookAlerts({},f.deps,now);
  assert.equal(f.sent.length,0);assert.equal(f.row.status,'active');
});
test('catalog failures, missing address and opt-out read failure fail closed',async()=>{
  for(const option of ['catalogFailure','noAddress','optoutFailure']){
    const f=fixture({[option]:true});await runBookAlerts({},f.deps,now);
    assert.equal(f.sent.length,0);assert.equal(f.row.status,'active');assert.ok(f.row.next_check_at);
  }
});
test('global opt-out and cancellation between check and send prevent delivery',async()=>{
  for(const option of ['optout','cancelBeforeSend']){
    const f=fixture({[option]:true});await runBookAlerts({},f.deps,now);
    assert.equal(f.sent.length,0);assert.equal(f.row.status,'unsubscribed');
  }
});
test('ambiguous provider failure is not sent again on next cron',async()=>{
  const f=fixture({sendFailure:true});await runBookAlerts({},f.deps,now);await runBookAlerts({},f.deps,now+21600000);
  assert.equal(f.sent.length,1);assert.equal(f.row.status,'sending');assert.match(f.row.last_error,/review/);
});
test('public registration saves new consent, leaves prior opt-outs intact',async()=>{
  for(const optout of [false,true]){
    const f=fixture({optout});const url=new URL('https://example.test/public/book-alerts');
    const res=await handleBookAlertRequest(new Request(url,{method:'POST',body:JSON.stringify(body)}),{},url,f.deps);
    assert.equal(res.status,200);assert.equal(f.calls.some(p=>p.includes('on_conflict=')),!optout);assert.equal(f.sent.length,0);
  }
});
test('email link scanners do not unsubscribe; explicit POST does',async()=>{
  const f=fixture();const url=new URL('https://example.test/public/book-alerts/unsubscribe?token='+token);
  const res=await handleBookAlertRequest(new Request(url),{},url,f.deps);
  assert.equal(res.status,200);assert.equal(f.calls.length,0);assert.match(await res.text(),/method="post"/);
  await handleBookAlertRequest(new Request(url,{method:'POST'}),{},url,f.deps);
  assert.equal(f.row.status,'unsubscribed');
});

test('arrival alert uses available inventory and does not trigger from a preorder',async()=>{
  const f=fixture();f.row.event='in_stock';
  await runBookAlerts({},f.deps,now);assert.equal(f.sent.length,0);
  f.row.status='checking';
  f.deps.listItemsForBook=async()=>[{id:token,name:'X-Men 92 Incursions #1 Cover B',available:true,price:4.99}];
  await runBookAlerts({},f.deps,now+21600000);
  assert.equal(f.sent.length,1);assert.match(f.sent[0][3],/\/item\//);
});
