import assert from 'node:assert/strict';
import vm from 'node:vm';
import {cleanCollection,mergeCollection,collectionCsv,collectionToolsHtml} from '../scripts/collection-tools.mjs';
assert.equal(cleanCollection({'mtg/a':'have','bad key':'need','mtg/b':'unknown'})['mtg/a'],'have');
assert.equal(Object.keys(cleanCollection([])).length,0);
const merged=mergeCollection({'mtg/a':'have','pokemon/b':'want'},{'mtg/a':'need','unknown/x':'have'},['mtg/a']);
assert.equal(merged['mtg/a'],'need');assert.equal(merged['pokemon/b'],'want');assert.equal(merged['unknown/x'],undefined);
const cards=[{key:'mtg/a',name:'A',number:'1',url:'https://example.com/a'},{key:'mtg/b',name:'=DANGEROUS()',number:'2',url:'https://example.com/b'}];
assert.ok(!collectionCsv(cards,{'mtg/a':'have','mtg/b':'need'}).includes('example.com/a'));
assert.ok(collectionCsv(cards,{'mtg/b':'need'}).includes("'=DANGEROUS()"));
class Element {
 constructor(){this.children=[];this.events={};this.open=false;this.textContent='';this.value='';}
 appendChild(c){this.children.push(c);}append(...c){this.children.push(...c);}replaceChildren(){this.children=[];}
 addEventListener(name,fn){this.events[name]=fn;}setAttribute(){}click(){}
}
const root=new Element(),selectors=new Map();
root.querySelector=s=>{if(!selectors.has(s))selectors.set(s,new Element());return selectors.get(s);};
let saved='{}';const context={document:{currentScript:{previousElementSibling:root},createElement:()=>new Element(),createTextNode:text=>({textContent:text})},localStorage:{getItem:()=>saved,setItem:(k,v)=>{saved=v;}},window:{addEventListener(){},print(){},},location:{origin:'https://www.themanapocket.com',pathname:'/mtg/a'},navigator:{},Blob,URL,setTimeout};
const html=collectionToolsHtml([{id:'a',name:'A </script>',cardNumber:'1'},{id:'b',name:'B',cardNumber:'2'}],{scope:'mtg',path:c=>'/mtg/'+c.id});
assert.ok(html.includes('not synced to your account'));assert.ok(html.includes('\\u003c/script\\u003e'));
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
vm.runInNewContext(script,context);
assert.equal(selectors.get('[data-collection-list]').children.length,0,'list stays lazy until opened');
root.open=true;root.events.toggle();
const list=selectors.get('[data-collection-list]');assert.equal(list.children.length,2);
const select=list.children[0].children[2];select.value='need';select.events.change();assert.equal(JSON.parse(saved)['mtg/a'],'need');
const filter=selectors.get('[data-collection-filter]');filter.events.change({target:{value:'need'}});assert.equal(list.children.length,1);
const importControl=selectors.get('[data-import-backup]');await importControl.events.change({target:{files:[{size:50,text:async()=>JSON.stringify({'mtg/a':'have','mtg/b':'want','unrelated':'need'})}],value:'selected'}});
assert.equal(JSON.parse(saved)['mtg/a'],'have');assert.equal(JSON.parse(saved)['mtg/b'],'want');assert.equal(JSON.parse(saved).unrelated,undefined);
console.log('Collection state survives reload/merge, scopes restores, exports safe needs and executes serialized client without missing globals');
