import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const worker=fs.readFileSync(path.join(root,'cloudflare-worker-full.js'),'utf8');
const browser=fs.readFileSync(path.join(root,'scripts/pricecharting/offline-browser.js'),'utf8');
const dashboard=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
assert.match(worker,/PRICECHARTING_OFFLINE_CATEGORIES[\s\S]*'video_games'[\s\S]*'gaming_magazines'/);
assert.doesNotMatch(worker,/PRICECHARTING_OFFLINE_CATEGORIES[^;]*'pokemon'/);
assert.doesNotMatch(worker,/PRICECHARTING_OFFLINE_CATEGORIES[^;]*'mtg'/);
assert.match(browser,/one_piece/);
assert.match(browser,/identifiers/);
assert.match(dashboard,/Pokémon is intentionally excluded here/);
assert.match(dashboard,/priceChartingOfflineCategoryFor/);

const out=fs.mkdtempSync(path.join(os.tmpdir(),'arsca-pc-offline-'));
const result=spawnSync(process.execPath,['scripts/pricecharting/build-offline-bundle.mjs','--pricecharting=tests/fixtures/pricecharting/offline-sample.csv','--version=test','--out='+out],{cwd:root,encoding:'utf8'});
assert.equal(result.status,0,result.stderr||result.stdout);
for(const category of ['sports','comics','video_games','funko'])assert.ok(fs.existsSync(path.join(out,category,'manifest.json')),category+' manifest missing');
for(const excluded of ['pokemon','mtg'])assert.equal(fs.existsSync(path.join(out,excluded)),false,excluded+' must not use the shared PriceCharting pipeline');
const sports=zlib.gunzipSync(fs.readFileSync(path.join(out,'sports','test','products.jsonl.gz'))).toString().trim().split('\n').map(JSON.parse);
assert.equal(sports[0].imageUrl,'https://example.com/ohtani.jpg');
assert.equal(sports[0].upc,'111111111111');
fs.rmSync(out,{recursive:true,force:true});
console.log('pricecharting offline contract tests passed');
