import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {exportCSV,parseImportCSV} from '../extensions/bcw-catalog/csv.mjs';
const root=path.resolve('.');
const server=http.createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',p.endsWith('.html')?'text/html':'text/javascript');res.end(await fs.readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage();const batches=[];
 await page.route('https://**/*',async route=>{
  const u=route.request().url();
  if(u.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:"test-only",user:{email:"test@example.com"}}}})}})};'});
  if(u.endsWith('/inventory/dropship-import')){const body=route.request().postDataJSON();batches.push(body);return route.fulfill({json:{imported:body.items.length,created:body.items.length,updated:0}});}
  return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/supplies-import.html');
 await page.locator('#store-id').fill('test-store');
 const rows=[{supplier:'BCW',sku:'1-SIL',name:'Silver bags',cost:4,msrp:8,availability:'in_stock',category_paths:['Comics > Bags'],image_url:'https://example.com/bags.jpg',image_urls:['https://example.com/bags.jpg'],description:'Bag, board\nreview'}, {supplier:'BCW',sku:'1-BBSIL',name:'Silver boards',cost:6,msrp:12,availability:'backorder',category_paths:['Comics > Boards']}];
 await page.locator('#csv-input').fill(exportCSV(rows));await page.locator('#parse-btn').click();
 assert.match(await page.locator('#preview-summary').textContent(),/0 selected.*1 shown.*2 total/);
 await page.locator('#filter-category').selectOption('Comics > Bags');await page.locator('#select-visible').click();
 await page.locator('#price-mode').selectOption('msrp');
 const download=page.waitForEvent('download');await page.locator('#export-selected').click();const dl=await download;
 const exported=parseImportCSV(await fs.readFile(await dl.path(),'utf8'));
 assert.equal(exported.length,1);assert.equal(exported[0].sku,'1-SIL');assert.equal(exported[0].price,8);assert.equal(exported[0].image,rows[0].image_url);
 await page.locator('#filter-category').selectOption('');await page.locator('#filter-stock').uncheck();
 assert.match(await page.locator('#preview-summary').textContent(),/1 selected.*2 shown/);
 await page.locator('#import-btn').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('1 created'));
 assert.equal(batches.length,1);assert.equal(batches[0].items[0].sku,'1-SIL');assert.equal(batches[0].publish,false);
 console.log('Browser: filtering, selecting, MSRP preview, CSV export, and selected draft import passed');
}finally{await browser.close();server.close();}
