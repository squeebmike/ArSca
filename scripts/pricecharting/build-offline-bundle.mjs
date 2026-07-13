#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { parse as csvParse } from 'csv-parse';

const args=new Map(process.argv.slice(2).map(arg=>{const [key,...rest]=arg.replace(/^--/,'').split('=');return[key,rest.length?rest.join('='):true];}));
const root=path.resolve(import.meta.dirname,'..','..'),version=String(args.get('version')||new Date().toISOString().slice(0,10));
const outputRoot=path.resolve(root,String(args.get('out')||'data/pricecharting/build')),rawDir=path.resolve(root,String(args.get('raw-dir')||'data/pricecharting/raw'));
const source=String(args.get('pricecharting')||process.env.PRICECHARTING_CSV_URL||process.env.PRICECHARTING_CSV_FILE||'');
const upload=args.get('upload')===true||args.get('upload')==='true',bucket=String(args.get('bucket')||process.env.MTG_R2_BUCKET||'arsca-offline-catalogs');
const configPath=path.resolve(root,String(args.get('config')||'wrangler.deploy.jsonc')),generatedAt=new Date().toISOString();
if(!source)throw new Error('PRICECHARTING_CSV_URL or --pricecharting=<file-or-url> is required');
await fsp.mkdir(rawDir,{recursive:true});

async function sourceFile(input){if(!/^https?:\/\//i.test(input))return path.resolve(root,input);const destination=path.join(rawDir,'pricecharting-business.csv'),response=await fetch(input);if(!response.ok||!response.body)throw new Error(`Download HTTP ${response.status}`);const writer=fs.createWriteStream(destination);await new Promise((resolve,reject)=>{Readable.fromWeb(response.body).pipe(writer).on('finish',resolve).on('error',reject);});return destination;}
function text(row,...keys){for(const key of keys){const value=row[key];if(value!=null&&String(value).trim())return String(value).trim();}return'';}
function money(value){if(value==null||value==='')return null;const n=Number(String(value).replace(/[$,]/g,''));if(!Number.isFinite(n))return null;return Number.isInteger(n)&&n>999?n/100:n;}
function categoryFor(row){const hay=[text(row,'console-name','console_name','console','category'),text(row,'genre','product-type','product_type')].join(' ').toLowerCase();if(/comic/.test(hay))return'comics';if(/sports?|baseball|basketball|football|hockey|soccer|wrestling|racing|golf/.test(hay))return'sports';return'';}
function normalize(row,category){const productId=text(row,'id','product-id','product_id');const productName=text(row,'product-name','product_name','name');const consoleName=text(row,'console-name','console_name','console');const genre=text(row,'genre','product-type','product_type');return{productId,productName,normalizedProductName:productName.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),consoleName,genre,releaseDate:text(row,'release-date','release_date','year'),upc:text(row,'upc','UPC'),asin:text(row,'asin','ASIN'),prices:{ungraded:money(row['loose-price']??row.loose_price??row.ungraded),new:money(row['new-price']??row.new_price??row.new),graded:money(row['graded-price']??row.graded_price??row.graded),grade9_8:money(row['bgs-10-price']??row.bgs_10_price??row['condition-17-price']),psa10:money(row['manual-only-price']??row.manual_only_price??row.psa10)},url:text(row,'product-url','product_url','url')||(productId?`https://www.pricecharting.com/product/${productId}`:''),searchText:[productName,consoleName,genre,text(row,'release-date','release_date','year'),text(row,'upc','UPC')].join(' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),source:'PriceCharting business download',category,updatedAt:generatedAt};}
async function sha256(file){const hash=crypto.createHash('sha256');await new Promise((resolve,reject)=>fs.createReadStream(file).on('data',chunk=>hash.update(chunk)).on('end',resolve).on('error',reject));return hash.digest('hex');}
async function writeCategory(category,rows){const dir=path.join(outputRoot,category,version);await fsp.mkdir(dir,{recursive:true});const file=path.join(dir,'products.jsonl.gz'),out=fs.createWriteStream(file),gzip=createGzip({level:9});gzip.pipe(out);for(const row of rows)if(!gzip.write(JSON.stringify(row)+'\n'))await new Promise(resolve=>gzip.once('drain',resolve));gzip.end();await new Promise((resolve,reject)=>out.on('finish',resolve).on('error',reject));const descriptor={path:path.relative(outputRoot,file).replace(/\\/g,'/'),format:'jsonl.gz',sha256:await sha256(file),recordCount:rows.length,bytes:(await fsp.stat(file)).size};const manifest={category,version,generatedAt,sourceVersions:{pricecharting:{downloadedAt:generatedAt,source:'business-download'}},files:{products:descriptor},status:'ready'};const manifestPath=path.join(outputRoot,category,'manifest.json');await fsp.writeFile(manifestPath,JSON.stringify(manifest,null,2));return{file,manifestPath,descriptor};}
function uploadObject(key,file){const npx=process.platform==='win32'?'npx.cmd':'npx';const result=spawnSync(npx,['wrangler@latest','r2','object','put',`${bucket}/${key}`,'--file',file,'--config',configPath],{stdio:'inherit',cwd:root,shell:false});if(result.status!==0)throw new Error(`R2 upload failed for ${key}`);}

const csvFile=await sourceFile(source),groups={sports:[],comics:[]};
const csv=fs.createReadStream(csvFile).pipe(csvParse({columns:true,bom:true,skip_empty_lines:true,relax_quotes:true,relax_column_count:true}));
for await(const row of csv){const category=categoryFor(row);if(!category)continue;const product=normalize(row,category);if(product.productId&&product.productName)groups[category].push(product);}
for(const category of ['sports','comics']){const built=await writeCategory(category,groups[category]);if(upload){uploadObject(built.descriptor.path,built.file);uploadObject(`${category}/manifest.json`,built.manifestPath);}process.stdout.write(`[pricecharting-bundle] ${category}: ${groups[category].length.toLocaleString()} products\n`);}
