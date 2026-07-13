#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { parse as csvParse } from 'csv-parse';

const CATEGORY_LABELS={video_games:'Video Games',yugioh:'YuGiOh Cards',one_piece:'One Piece Cards'};
const CATEGORIES=Object.keys(CATEGORY_LABELS),args=new Map(process.argv.slice(2).map(arg=>{const [key,...rest]=arg.replace(/^--/,'').split('=');return[key,rest.length?rest.join('='):true];}));
const root=path.resolve(import.meta.dirname,'..','..'),version=String(args.get('version')||new Date().toISOString().slice(0,10));
const outputRoot=path.resolve(root,String(args.get('out')||'data/pricecharting/build')),rawDir=path.resolve(root,String(args.get('raw-dir')||'data/pricecharting/raw'));
const combinedSource=String(args.get('pricecharting')||process.env.PRICECHARTING_CSV_URL||process.env.PRICECHARTING_CSV_FILE||'');
const sourcesJson=String(args.get('sources-json')||process.env.PRICECHARTING_CSV_URLS_JSON||'').trim(),sourceMap=sourcesJson?JSON.parse(sourcesJson):{};
const upload=args.get('upload')===true||args.get('upload')==='true',bucket=String(args.get('bucket')||process.env.MTG_R2_BUCKET||'arsca-offline-catalogs');
const configPath=path.resolve(root,String(args.get('config')||'wrangler.deploy.jsonc')),generatedAt=new Date().toISOString();
for(const key of Object.keys(sourceMap))if(!CATEGORIES.includes(key))throw new Error(`Unsupported category in sources JSON: ${key}`);
if(!combinedSource&&!Object.keys(sourceMap).length)throw new Error('PRICECHARTING_CSV_URL, --pricecharting, or PRICECHARTING_CSV_URLS_JSON is required');
await fsp.mkdir(rawDir,{recursive:true});

async function sourceFile(input,key='combined'){if(!/^https?:\/\//i.test(input))return path.resolve(root,input);const destination=path.join(rawDir,`pricecharting-${key}.csv`),response=await fetch(input);if(!response.ok||!response.body)throw new Error(`${key} download HTTP ${response.status}`);const writer=fs.createWriteStream(destination);await new Promise((resolve,reject)=>Readable.fromWeb(response.body).pipe(writer).on('finish',resolve).on('error',reject));return destination;}
function text(row,...keys){for(const key of keys){const value=row[key];if(value!=null&&String(value).trim())return String(value).trim();}return'';}
function money(value){if(value==null||value==='')return null;const n=Number(String(value).replace(/[$,]/g,''));if(!Number.isFinite(n))return null;return Number.isInteger(n)&&n>999?n/100:n;}
function categoryFor(row){const hay=[text(row,'category','console-name','console_name','console'),text(row,'genre','product-type','product_type')].join(' ').toLowerCase();const tests=[['video_games',/video game/],['yugioh',/yu-?gi-?oh/],['one_piece',/one piece/]];return tests.find(([,re])=>re.test(hay))?.[0]||'';}
function imageUrl(row){const raw=text(row,'image-url','image_url','imageUrl','image');if(!raw)return'';return raw.startsWith('//')?'https:'+raw:raw.startsWith('/')?'https://www.pricecharting.com'+raw:raw;}
function normalize(row,category){const productId=text(row,'id','product-id','product_id'),productName=text(row,'product-name','product_name','name'),consoleName=text(row,'console-name','console_name','console'),genre=text(row,'genre','product-type','product_type'),releaseDate=text(row,'release-date','release_date','year'),upc=text(row,'upc','UPC'),asin=text(row,'asin','ASIN'),epid=text(row,'epid','ePID');return{productId,productName,normalizedProductName:productName.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),consoleName,genre,releaseDate,upc,asin,epid,imageUrl:imageUrl(row),prices:{ungraded:money(row['loose-price']??row.loose_price??row.ungraded),cib:money(row['cib-price']??row.cib_price),new:money(row['new-price']??row.new_price??row.new),graded:money(row['graded-price']??row.graded_price??row.graded),grade9_8:money(row['bgs-10-price']??row.bgs_10_price??row['condition-17-price']),psa10:money(row['manual-only-price']??row.manual_only_price??row.psa10)},retail:{looseBuy:money(row['retail-loose-buy']??row.retail_loose_buy),looseSell:money(row['retail-loose-sell']??row.retail_loose_sell)},salesVolume:Number(text(row,'sales-volume','sales_volume')||0)||0,url:text(row,'product-url','product_url','url')||(productId?`https://www.pricecharting.com/product/${productId}`:''),searchText:[productName,consoleName,genre,releaseDate,upc,asin,epid,productId].join(' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),source:'PriceCharting business download',category,updatedAt:generatedAt};}
async function sha256(file){const hash=crypto.createHash('sha256');await new Promise((resolve,reject)=>fs.createReadStream(file).on('data',chunk=>hash.update(chunk)).on('end',resolve).on('error',reject));return hash.digest('hex');}
async function writeCategory(category,rows){const dir=path.join(outputRoot,category,version);await fsp.mkdir(dir,{recursive:true});const file=path.join(dir,'products.jsonl.gz'),out=fs.createWriteStream(file),gzip=createGzip({level:9});gzip.pipe(out);for(const row of rows)if(!gzip.write(JSON.stringify(row)+'\n'))await new Promise(resolve=>gzip.once('drain',resolve));gzip.end();await new Promise((resolve,reject)=>out.on('finish',resolve).on('error',reject));const descriptor={path:path.relative(outputRoot,file).replace(/\\/g,'/'),format:'jsonl.gz',sha256:await sha256(file),recordCount:rows.length,bytes:(await fsp.stat(file)).size};const manifest={category,label:CATEGORY_LABELS[category],version,generatedAt,sourceVersions:{pricecharting:{downloadedAt:generatedAt,source:'business-download'}},files:{products:descriptor},status:'ready'};const manifestPath=path.join(outputRoot,category,'manifest.json');await fsp.writeFile(manifestPath,JSON.stringify(manifest,null,2));return{file,manifestPath,descriptor};}
function uploadObject(key,file){const npx=process.platform==='win32'?'npx.cmd':'npx';const result=spawnSync(npx,['wrangler@latest','r2','object','put',`${bucket}/${key}`,'--file',file,'--config',configPath,'--remote'],{stdio:'inherit',cwd:root,shell:false});if(result.status!==0)throw new Error(`R2 upload failed for ${key}`);}
async function importCsv(input,forcedCategory,groups){const csvFile=await sourceFile(input,forcedCategory||'combined'),csv=fs.createReadStream(csvFile).pipe(csvParse({columns:true,bom:true,skip_empty_lines:true,relax_quotes:true,relax_column_count:true}));for await(const row of csv){const category=forcedCategory||categoryFor(row);if(!category||!groups[category])continue;const product=normalize(row,category);if(product.productId&&product.productName)groups[category].set(product.productId,product);}}

const groups=Object.fromEntries(CATEGORIES.map(category=>[category,new Map()]));
if(combinedSource)await importCsv(combinedSource,'',groups);
for(const [category,input] of Object.entries(sourceMap))await importCsv(String(input),category,groups);
for(const category of CATEGORIES){const rows=[...groups[category].values()];if(!rows.length)continue;const built=await writeCategory(category,rows);if(upload){uploadObject(built.descriptor.path,built.file);uploadObject(`${category}/manifest.json`,built.manifestPath);}process.stdout.write(`[pricecharting-bundle] ${category}: ${rows.length.toLocaleString()} products\n`);}
