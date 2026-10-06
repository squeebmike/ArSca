import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountBookAlerts} from '../scripts/book-alerts.mjs';
import {renderBookAlertForm,alertBookTitle} from '../scripts/book-alert-ui.mjs';
const storeId='store';
const id='a0000000-0000-4000-a000-000000000001';
function deps(changes={}) {
  return {storeId,json:(b,s=200)=>Response.json(b,{status:s}),
    readJsonWithLimit:async r=>({data:await r.json()}),
    requireAuthenticatedUser:async()=>({user:{id:'owner',email:'Reader@example.test',email_confirmed_at:'2026-10-01'}}),
    supabaseAdminFetch:async()=>({data:[]}),...changes};
}
test('unauthenticated and unverified users cannot access subscriber data',async()=>{
  for(const auth of [{error:new Response('',{status:401})},{user:{email:'reader@example.test'}}]){
    const d=deps({requireAuthenticatedUser:async()=>auth,supabaseAdminFetch:async()=>assert.fail('must not query')});
    const u=new URL('https://test/public/account/book-alerts');
    const r=await handleAccountBookAlerts(new Request(u),{},u,d);assert.ok([401,403].includes(r.status));
  }
});
test('listing ignores client email/store, omits tokens, and disables caching',async()=>{
  let query;const d=deps({supabaseAdminFetch:async(e,p)=>{query=p;return{data:[]};}});
  const u=new URL('https://test/public/account/book-alerts?email=victim@example.test&store_id=other');
  const r=await handleAccountBookAlerts(new Request(u),{},u,d);
  assert.match(query,/store_id=eq.store&email=eq.reader%40example.test/);
  assert.doesNotMatch(query,/victim|other|unsubscribe_token|select=\*/);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});
test('cancellation is scoped to the verified email and active alert; other ids return 404',async()=>{
  let query,values;const d=deps({supabaseAdminFetch:async(e,p,o)=>{query=p;values=JSON.parse(o.body);return{data:[]};}});
  const u=new URL('https://test/public/account/book-alerts');
  const r=await handleAccountBookAlerts(new Request(u,{method:'PATCH',body:JSON.stringify({id,email:'victim@example.test'})}),{},u,d);
  assert.equal(r.status,404);assert.match(query,/email=eq.reader%40example.test/);assert.match(query,/status=in.\(active,checking,sending\)/);
  assert.equal(values.status,'unsubscribed');assert.equal(values.lease_token,null);
});
test('pagination provides the next page without exposing the extra row',async()=>{
  const d=deps({supabaseAdminFetch:async()=>({data:Array.from({length:51},(_,i)=>({id:i}))})});
  const u=new URL('https://test/public/account/book-alerts?offset=50');
  const r=await handleAccountBookAlerts(new Request(u),{},u,d);const b=await r.json();assert.equal(b.alerts.length,50);assert.equal(b.nextOffset,100);
});
test('product alert form strips variant suffix and escapes untrusted titles',()=>{
  assert.equal(alertBookTitle('X-Men #1 COVER A'),'X-Men #1');
  const esc=s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html=renderBookAlertForm(['<img>'],storeId,esc);
  assert.ok(html.includes('&lt;img&gt;'));assert.ok(html.includes('/account?section=alerts'));assert.ok(html.includes('consent:'));
});
