import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import './helpers/mock-body-html-rewriter.mjs';
import {optionalCatalogInventory} from '../scripts/catalog-availability.mjs';
import {catalogInventoryHtml,catalogSetInventoryHtml} from '../scripts/catalog-inventory.mjs';
assert.deepEqual(await optionalCatalogInventory(async()=>[{id:'a'}]),[{id:'a'}]);
assert.equal(await optionalCatalogInventory(async()=>{throw Error('Database timeout');}),null);
let signal;
assert.equal(await optionalCatalogInventory(s=>{signal=s;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(Error('aborted'))));},15),null);
assert.equal(signal.aborted,true,'the timeout cancels the optional upstream fetch');
for(const html of [catalogInventoryHtml(null,{},'mtg',{},{}),catalogSetInventoryHtml(null,[],'mtg',{}, {})]){assert.ok(html.includes('temporarily unavailable'));assert.ok(!html.includes('No matching'));}
// Exercise the real MTG route while the database rejects inventory reads.
const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;
globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
globalThis.fetch=async()=>{throw Error('Database timeout');};
const set={setCode:'test',setName:'Reference Test'},card={scryfallId:'00000000-0000-0000-0000-000000000001',setCode:'test',name:'Test Card',collectorNumber:'1',prices:{usd:'3.00'},imageUris:{}};
const manifest={status:'ready',files:{sets:{path:'mtg/sets.jsonl.gz'},cards:{path:'mtg/cards.jsonl.gz'}}};
const env={SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',MTG_CATALOG_R2:{get:async key=>key==='mtg/manifest.json'?{json:async()=>manifest}:{body:new Response(gzipSync(JSON.stringify(key.includes('sets')?set:card)+'\n')).body}}};
try{const worker=(await import('../cloudflare-worker-full.js')).default;const res=await worker.fetch(new Request('https://worker.invalid/mtg/test'),env,{waitUntil(){}});const body=await res.text();assert.equal(res.status,200);assert.ok(body.includes('Test Card'));assert.ok(body.includes('Highest nonfoil reference values'));assert.ok(body.includes('temporarily unavailable'));assert.ok(!body.includes('No matching singles'));const cardPath=body.match(/href="(\/mtg\/test\/[^" ]+)"/)[1];const detail=await worker.fetch(new Request('https://worker.invalid'+cardPath),env,{waitUntil(){}});assert.equal(detail.status,200);assert.ok((await detail.text()).includes('temporarily unavailable'));}
finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;}
console.log('Reference pages survive inventory outages; optional inventory requests abort at the deadline without claiming sold-out stock');
