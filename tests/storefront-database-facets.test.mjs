import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../cloudflare-worker-full.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function storefrontCleanText'),source.indexOf('// Same book-detail fields'));
const {filterStorefrontCatalog}=new Function(helpers+';return {filterStorefrontCatalog};')();
const catalog=[
  {id:'1',name:'Jackson Holliday',category:'Sports',categorySlug:'sports-cards',configuration:'Single',productTypeSlug:'singles',price:10,team:'Orioles',cardNumber:'88'},
  {id:'2',name:'Holliday box',category:'Sports',categorySlug:'sports-cards',configuration:'Mega Box',productTypeSlug:'sealed',price:30},
  {id:'3',name:'Custom product',category:'Original Art',categorySlug:'other',configuration:'Signed Print',price:20},
  {id:'4',name:'Pokémon',category:'Pokemon TCG',categorySlug:'pokemon',configuration:'Custom Lot',price:12},
  {id:'5',name:'Unknown type',category:'Sports',categorySlug:'sports-cards',price:5},
];
function run(query){return filterStorefrontCatalog(catalog,new URLSearchParams(query));}
assert.equal(run('category=sports').items.length,3);
assert.equal(run('category=sports-cards&type=singles').items[0].id,'1','legacy navigation still works');
assert.equal(run('category=original+art&type=signed+print').items[0].id,'3','new database values require no code changes');
assert.equal(run('category=sports&type=mega+box').items[0].id,'2');
assert.deepEqual(run('category=sports&q=nothing').filterOptions.types.map(v=>v.label),['Mega Box','Single','Unspecified'],'empty searches retain category-scoped options');
assert.equal(run('q=88+orioles+holliday').items[0].id,'1','search tokens can match separate fields in any order');
assert.equal(run('q=pokemon').items[0].id,'4','accent-insensitive search');
assert.deepEqual(run('sort=price-asc').items.map(v=>v.price),[5,10,12,20,30]);
assert.equal(run('category=sports&type=unspecified').items[0].id,'5','blank types remain discoverable');
assert.equal(run('').filterOptions.categories.find(v=>v.value==='sports').count,3);
assert.deepEqual(catalog.map(v=>v.id),['1','2','3','4','5'],'sorting does not mutate source order');
console.log('Database category/type facets, legacy links, search and sort verified.');
