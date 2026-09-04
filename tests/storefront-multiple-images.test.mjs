import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('cloudflare-worker-full.js','utf8');
const start=source.indexOf('function storefrontCleanText');
const end=source.indexOf('\nfunction json(',start);
assert.ok(start>=0&&end>start,'storefront shaping helpers must exist');
const context={roundUpToDollar:value=>Math.ceil(Number(value)||0)};
vm.runInNewContext(source.slice(start,end)+';this.shapeStorefrontItem=shapeStorefrontItem;',context);

const primary='https://example.com/front.jpg';
const second='https://example.com/back.jpg';
const third='https://example.com/detail.jpg';
const item=context.shapeStorefrontItem({id:'multi-1',status:'in_stock',data:{name:'Multi-photo item',category:'Sports',quantity:1,thumbnail:primary,photos:[second,primary],images:[third,second]}});
assert.equal(item.image,primary,'the selected primary image must remain first');
assert.deepEqual(Array.from(item.photos),[primary,second,third],'photos and images must merge in order without duplicates');

const imagesOnly=context.shapeStorefrontItem({id:'multi-2',status:'in_stock',data:{name:'Scout item',category:'Collectibles',quantity:1,images:[second,third]}});
assert.equal(imagesOnly.image,second,'an older images-only item must still receive a storefront primary image');
assert.deepEqual(Array.from(imagesOnly.photos),[second,third]);

console.log('Public storefront multi-image normalization checks passed.');
