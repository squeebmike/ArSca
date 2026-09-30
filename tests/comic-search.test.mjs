import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { searchComics, searchTerms, comicSearchScriptResponse } from '../scripts/comic-search.mjs';
import { comicSearchClient } from '../scripts/comic-search-client.mjs';

const deps = {
  storeId:'fixed-store', isAvailable:i=>i.quantity>0, itemSlug:i=>i.id,
  listItems:async()=>[
    {id:'stock',name:'Spider-Man #1',categorySlug:'comics',quantity:1,price:5},
    {id:'sold',name:'Spider-Man #2',categorySlug:'comics',quantity:0,price:5},
    {id:'card',name:'Spider-Man card',categorySlug:'collectibles',quantity:1,price:5},
  ],
  db:async path=>{
    const u=new URL('https://db/'+path), p=u.searchParams;
    assert.equal(p.get('store_id'),'eq.fixed-store');
    assert.equal(p.get('order'),'title.asc,id.asc');
    if(u.pathname==='/comic_skus'){
      assert.equal(p.get('customer_enabled'),'eq.true');assert.equal(p.get('foc_cycles.status'),'eq.open');assert.match(p.get('foc_cycles.customer_cutoff_at'),/^gt./);
      return {data:[{id:'pre',title:'Spider-Man #3',customer_price_cents:499}]};
    }
    assert.match(p.get('select'),/backlist_skus!inner/);
    assert.equal(p.get('backlist_skus.is_orderable'),'eq.true');
    return {data:[{id:'book',title:'Spider-Man collection',backlist_skus:[{msrp_cents:2000}]}]};
  },
};
test('one query returns all sources and excludes unavailable stock',async()=>{
  const data=await searchComics(new URL('https://site/comics/search.json?q=spider-man'),deps);
  assert.deepEqual(Object.keys(data.sections).sort(),['backorder','preorder','stock']);
  assert.deepEqual(data.sections.stock.results.map(x=>x.id),['stock']);
  assert.equal(data.sections.preorder.results[0].href,'/preorder/pre');
  assert.equal(data.sections.backorder.results[0].priceCents,2000);
});
test('per-source pagination does not cap or repeat first results',async()=>{
  let seen;
  const data=await searchComics(new URL('https://site/comics/search.json?q=batman&kind=preorder&offset=12&limit=12'),{...deps,db:async path=>{seen=new URL('https://db/'+path);return {data:Array.from({length:13},(_,i)=>({id:String(i+12),title:'Batman'}))};}});
  assert.equal(seen.searchParams.get('offset'),'12');assert.equal(seen.searchParams.get('limit'),'13');
  assert.equal(data.sections.preorder.results.length,12);assert.equal(data.sections.preorder.nextOffset,24);assert.equal(data.sections.preorder.hasMore,true);
  assert.deepEqual(Object.keys(data.sections),['preorder']);
});
test('source failure remains explicit while successful sources still return',async()=>{
  const data=await searchComics(new URL('https://site/comics/search.json?q=spider'),{...deps,db:async path=>{if(path.startsWith('comic_skus'))throw Error('offline');return deps.db(path);}});
  assert.ok(data.sections.preorder.error);assert.equal(data.sections.stock.results.length,1);assert.equal(data.sections.backorder.results.length,1);
});
test('punctuation cannot inject database filters; empty query does no work',async()=>{
  assert.deepEqual(searchTerms('Spider-Man,*) OR &title=evil'),['spider','man','or','title','evil']);
  const data=await searchComics(new URL('https://site/comics/search.json?q=%25%2A'),{db:()=>assert.fail(),listItems:()=>assert.fail()});
  assert.equal(data.emptyQuery,true);
});
test('served script parses',async()=>{new vm.Script(await comicSearchScriptResponse().text());});

test('served script supplies the keepNames helper used by the deployed bundle',async()=>{
  const original=Object.getOwnPropertyDescriptor(comicSearchClient,'toString');
  try {
    Object.defineProperty(comicSearchClient,'toString',{configurable:true,value:()=> 'function(){ const run=__name(()=>{window.started=true},"run"); run(); }'});
    const context={window:{}};
    vm.runInNewContext(await comicSearchScriptResponse().text(),context);
    assert.equal(context.window.started,true);
  } finally {
    if(original) Object.defineProperty(comicSearchClient,'toString',original);
    else delete comicSearchClient.toString;
  }
});

function fakeElement(){return {children:[],textContent:'',value:'',hidden:false,classList:{add(){},toggle(){}},appendChild(n){this.children.push(n);return n;},replaceChildren(...children){this.children=children;},addEventListener(name,fn){this[name]=fn;},focus(){}};}
test('rapid typing ignores stale responses, and clearing restores the catalog',async()=>{
  const input=fakeElement(),output=fakeElement(),status=fakeElement(),clear=fakeElement(),form=fakeElement();
  const host={querySelector:s=>({'input':input,'[data-cs-results]':output,'[data-cs-status]':status,'[data-cs-clear]':clear,form})[s]};
  const calls=[];let timer;
  const context={window:{},document:{head:fakeElement(),body:fakeElement(),createElement:fakeElement,getElementById:()=>host},location:{href:'https://site/books',origin:'https://site',pathname:'/books',search:''},history:{replaceState(){}},URL,URLSearchParams,AbortController,Intl,
    setTimeout:fn=>{timer=fn;},clearTimeout(){},fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))};
  vm.createContext(context);vm.runInContext('('+comicSearchClient.toString()+')("", "")',context);
  input.value='batman';input.input();timer();input.value='spider';input.input();timer();
  assert.equal(calls[0].options.signal.aborted,true);
  calls[1].resolve({ok:true,json:async()=>({sections:{stock:{results:[],hasMore:false}}})});await new Promise(setImmediate);
  assert.match(status.textContent,/spider/);
  calls[0].resolve({ok:true,json:async()=>({sections:{stock:{results:[],hasMore:false}}})});await new Promise(setImmediate);
  assert.match(status.textContent,/spider/);
  clear.onclick();assert.equal(status.textContent,'');assert.equal(input.value,'');assert.equal(output.children.length,0);
});
