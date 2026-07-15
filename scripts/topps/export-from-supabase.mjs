#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const args=new Map(process.argv.slice(2).map(arg=>{const [key,...rest]=arg.replace(/^--/,'').split('=');return[key,rest.length?rest.join('='):true];}));
const root=path.resolve(import.meta.dirname,'..','..'),out=path.resolve(root,String(args.get('out')||'data/topps/export'));
const url=String(args.get('url')||process.env.SUPABASE_URL||''),key=String(args.get('key')||process.env.SUPABASE_ANON_KEY||'');
if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
await fsp.mkdir(out,{recursive:true});
const headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
async function exportTable(table,file,select='*'){
  const destination=path.join(out,file),stream=fs.createWriteStream(destination),pageSize=1000;let lastId='',count=0,first=true;
  stream.write('[');
  while(true){const endpoint=new URL(url.replace(/\/$/,'')+'/rest/v1/'+table);endpoint.searchParams.set('select',select);endpoint.searchParams.set('limit',String(pageSize));endpoint.searchParams.set('order','id.asc');if(lastId)endpoint.searchParams.set('id','gt.'+lastId);let response;for(let attempt=1;attempt<=5;attempt++){response=await fetch(endpoint,{headers});if(response.ok)break;if(attempt===5)throw new Error(`${table} export HTTP ${response.status}: ${await response.text()}`);await new Promise(resolve=>setTimeout(resolve,attempt*1000));}const rows=await response.json();for(const row of rows){stream.write((first?'':',\n')+JSON.stringify(row));first=false;count++;lastId=String(row.id||lastId);}process.stdout.write(`\r[topps-export] ${table}: ${count.toLocaleString()}`);if(rows.length<pageSize)break;}
  stream.end(']\n');await new Promise((resolve,reject)=>stream.on('finish',resolve).on('error',reject));process.stdout.write('\n');return count;
}
const sets=await exportTable('topps_sets','topps_sets.json');
const cards=await exportTable('topps_checklist_cards','topps_checklist_cards.json');
process.stdout.write(`[topps-export] complete: ${sets.toLocaleString()} sets / ${cards.toLocaleString()} cards\n`);
