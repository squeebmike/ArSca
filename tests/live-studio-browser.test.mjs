import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {DEFAULT_STUDIO} from '../scripts/live-studio-model.mjs';
const require=createRequire(process.env.STUDIO_PLAYWRIGHT || import.meta.url);
const {chromium}=require('playwright');
const root=process.cwd();
const harness=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/live-studio.css"></head><body style="background:#0b1017;margin:24px;max-width:640px"><div id="mana-live-studio"></div><script>
let saved=${JSON.stringify(DEFAULT_STUDIO)};let calls=[];let WORKER='https://worker.example';let storeId='11111111-1111-4111-8111-111111111111';function getActiveStoreId(){return storeId;}
async function storeWorkerFetch(url,opts){const body=opts?.body?JSON.parse(opts.body):null;calls.push({url,body});if(body?.settings)saved=body.settings;return Response.json({ok:true,settings:saved,revision:1,effect:body?.kind?{id:crypto.randomUUID(),kind:body.kind,startsAt:Date.now(),endsAt:Date.now()+5000}:null,token:'test-only',expiresAt:Date.now()+43200000});}
</script><script src="/scripts/live-studio-controls.js" defer></script></body></html>`;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(harness);return;}const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.env.STUDIO_BROWSER_CHANNEL || undefined});const page=await browser.newPage({viewport:{width:1000,height:1700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[name=width]').waitFor();
 await page.waitForFunction(()=>document.querySelector('[name=width]').value==='700');
 await page.getByRole('button',{name:'Connect / reload'}).click();await page.getByText('Connected. Controls are live.').waitFor();
 await page.locator('[name=message]').fill('<b>Safe literal mana</b>');await page.getByRole('button',{name:'Save live settings'}).click();await page.getByText('Live settings saved.').waitFor();
 const frame=page.frameLocator('iframe');assert.equal(await frame.locator('#mana-message').textContent(),'<b>Safe literal mana</b>');assert.equal(await frame.locator('#mana-message b').count(),0);
 await page.getByRole('button',{name:'JACKPOT',exact:true}).click();await frame.getByText('JACKPOT!',{exact:true}).waitFor();
 assert.equal(await frame.locator('#mana-coins i').count(),24);
 const box=await frame.locator('#mana-sign').boundingBox();assert.ok(box.width<240 && box.height<80,'sign stays small in camera preview');
 await page.getByRole('button',{name:'Create / replace OBS link'}).click();await page.waitForFunction(()=>document.querySelector('#mana-url').value.length>0);assert.match(await page.locator('#mana-url').inputValue(),/arcade-overlay.html#worker=/);
 await page.evaluate(()=>{storeId='22222222-2222-4222-8222-222222222222';});await page.getByRole('button',{name:'SOLD',exact:true}).click();await page.getByText('Store changed. Connect again before controlling the sign.').waitFor();
 await page.locator('[name=message]').fill('THE MANA POCKET • INSERT COIN');await page.locator('[name=message]').dispatchEvent('input');
 await page.evaluate(()=>{storeId='11111111-1111-4111-8111-111111111111';});
 await page.getByRole('button',{name:'CLEAR',exact:true}).click();await page.getByText('Sent CLEAR',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Revoke OBS link',exact:true}).click();await page.getByText('OBS links revoked.',{exact:true}).waitFor();
 if(process.env.STUDIO_SCREENSHOT)await page.screenshot({path:process.env.STUDIO_SCREENSHOT,fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser controls, literal text safety, preview animation, OBS link and store-switch guard passed');
} finally {await browser?.close();server.close();}


