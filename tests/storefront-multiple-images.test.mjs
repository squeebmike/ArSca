import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('cloudflare-worker-full.js','utf8');
const start=source.indexOf('function storefrontCleanText');
const end=source.indexOf('\nfunction json(',start);
assert.ok(start>=0&&end>start,'storefront shaping helpers must exist');
const context={roundUpToDollar:value=>Math.ceil(Number(value)||0),marketRulePrice:value=>Math.ceil(Number(value)||0)};
vm.runInNewContext(source.slice(start,end)+';this.shapeStorefrontItem=shapeStorefrontItem;',context);
const publisherCopy='<p>The &lsquo;Cats &amp; friends.</p><p>Read &#35;1 &mdash; now.</p><script>doNotRun()</script>';
assert.equal(context.storefrontDescriptionText(publisherCopy),'The ‘Cats & friends. Read #1 — now.');
assert.equal(context.storefrontDescriptionText('2 < 3 and &lt;special&gt;'),'2 < 3 and <special>');
assert.equal(context.storefrontDescriptionText('&#x110000;'),'&#x110000;');
const originalDescription={description:publisherCopy};
assert.equal(context.shapeStorefrontItem({id:'description',data:originalDescription}).description,'The ‘Cats & friends. Read #1 — now.');
assert.equal(originalDescription.description,publisherCopy,'public text cleanup never edits source inventory');
assert.equal(context.shapeStorefrontItem({id:'internal-barcode',data:{barcode:'036000291452'}}).gtinCandidates.length,0,'a store-internal barcode is not a verified global product identifier');
assert.equal(context.shapeStorefrontItem({id:'supplier-upc',data:{upc:'036000291452'}}).gtinCandidates[0],'036000291452');

const primary='https://example.com/front.jpg';
const second='https://example.com/back.jpg';
const third='https://example.com/detail.jpg';
const item=context.shapeStorefrontItem({id:'multi-1',status:'in_stock',data:{name:'Multi-photo item',category:'Sports',quantity:1,thumbnail:primary,photos:[second,primary],images:[third,second]}});
assert.equal(context.shapeStorefrontItem({id:'secret-sealed',data:{category:'MTG',productType:'Secret Lair',variant:'Factory Sealed'}}).isSealed,true);
assert.equal(context.shapeStorefrontItem({id:'secret-single',data:{category:'MTG',productType:'Secret Lair',variant:'Foil'}}).isSealed,false,'the Secret Lair product type alone does not make a single sealed');
assert.equal(item.image,primary,'the selected primary image must remain first');
assert.deepEqual(Array.from(item.photos),[primary,second,third],'photos and images must merge in order without duplicates');

const imagesOnly=context.shapeStorefrontItem({id:'multi-2',status:'in_stock',data:{name:'Scout item',category:'Collectibles',quantity:1,images:[second,third]}});
assert.equal(imagesOnly.image,second,'an older images-only item must still receive a storefront primary image');
assert.deepEqual(Array.from(imagesOnly.photos),[second,third]);

console.log('Public storefront multi-image normalization checks passed.');
