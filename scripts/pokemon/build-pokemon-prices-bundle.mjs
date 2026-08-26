#!/usr/bin/env node
// Pulls PPT's bulk cards+sealed CSV exports ONCE (this script is meant to
// run on a daily cron -- see .github/workflows/pokemon-prices-daily.yml) and
// republishes them into our own R2 bucket as gzipped JSONL, so every device
// syncs from our cloud copy instead of each one spending PPT's shared
// 2-exports-per-day cap by hitting /pricing/pokemon/export live.
//
// Rows are kept in their RAW PPT CSV shape (just parsed from CSV to JSON) --
// the browser-side normalizePptExportRow() in dashboard.html already knows
// how to reshape a raw export row into the canonical stored shape, so this
// script deliberately does not duplicate that logic.
//
// eBay and Population stay live/on-demand only (see /pricing/pokemon/export
// in cloudflare-worker-full.js): cards+sealed already spend both of PPT's
// daily export slots, so there's nothing left in the cap for this script to
// also pull those types with.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGzip } from 'node:zlib';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const root = path.resolve(import.meta.dirname, '..', '..');
const version = String(args.get('version') || new Date().toISOString().slice(0, 10));
const outputRoot = path.resolve(root, String(args.get('out') || 'data/pokemon-prices/build'));
const bundleDir = path.join(outputRoot, 'pokemon', 'prices');
const upload = args.get('upload') === true || args.get('upload') === 'true';
const bucket = String(args.get('bucket') || process.env.POKEMON_R2_BUCKET || 'arsca-offline-catalogs');
const configPath = path.resolve(root, String(args.get('config') || 'wrangler.deploy.jsonc'));
const apiBase = String(args.get('api-base') || process.env.POKEMONPRICE_API_BASE || 'https://www.pokemonpricetracker.com/api/v2');
const apiKey = String(args.get('api-key') || process.env.POKEMONPRICE_API_KEY || process.env.POKEMON_PRICE_TRACKER_API_KEY || '');
const types = ['cards', 'sealed'];
const generatedAt = new Date().toISOString();

function log(message) { process.stdout.write(`[pokemon-prices-bundle] ${message}\n`); }

async function fetchExport(type) {
  const localFileArg = args.get(`${type}-file`);
  if (localFileArg) {
    log(`Loading ${type} export from local file ${localFileArg}`);
    return fsp.readFile(path.resolve(root, String(localFileArg)), 'utf8');
  }
  if (!apiKey) throw new Error('POKEMONPRICE_API_KEY is required (or pass --cards-file/--sealed-file for local/testing runs)');
  log(`Fetching ${type} export from PokemonPriceTracker`);
  const response = await fetch(`${apiBase}/export?type=${type}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/csv, application/gzip, */*' },
    redirect: 'follow',
  });
  if (response.status === 429) throw new Error(`PPT export ${type}: daily export limit reached (2 per day, shared across all types). Download quota resets at UTC midnight; the new dump itself isn't ready until 6:00 AM UTC.`);
  if (response.status === 403) throw new Error(`PPT export ${type}: Business plan required for bulk exports.`);
  if (!response.ok) throw new Error(`PPT export ${type}: HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);

  const contentType = response.headers.get('content-type') || '';
  const contentEncoding = response.headers.get('content-encoding') || '';
  const isGzip = contentEncoding.includes('gzip') || contentType.includes('gzip') || response.url.endsWith('.gz');
  if (isGzip) {
    const ds = new DecompressionStream('gzip');
    return new Response(response.body.pipeThrough(ds)).text();
  }
  return response.text();
}

// Minimal RFC 4180 CSV parser: handles quoted fields, escaped "" quotes, and
// commas/newlines inside quoted fields. Mirrors the browser-side
// parseCsvWithHeaders() in dashboard.html closely enough that both produce
// the same row shape from the same input.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((header, idx) => { obj[header] = cells[idx] ?? ''; });
    return obj;
  });
}

function gzipWriter(filePath) {
  const file = fs.createWriteStream(filePath);
  const gzip = createGzip({ level: 9 });
  gzip.pipe(file);
  return {
    async write(record) {
      if (!gzip.write(JSON.stringify(record) + '\n')) await new Promise(resolve => gzip.once('drain', resolve));
    },
    async close() {
      gzip.end();
      await new Promise((resolve, reject) => { file.on('finish', resolve); file.on('error', reject); gzip.on('error', reject); });
    },
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function fileDescriptor(filePath, recordCount) {
  return {
    path: path.relative(outputRoot, filePath).replace(/\\/g, '/'),
    format: 'jsonl.gz',
    sha256: await sha256File(filePath),
    recordCount,
    bytes: (await fsp.stat(filePath)).size,
  };
}

function uploadObject(objectPath, filePath) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['wrangler@latest', 'r2', 'object', 'put', `${bucket}/${objectPath}`, '--file', filePath, '--config', configPath, '--remote'], { stdio: 'inherit', cwd: root, shell: false });
  if (result.status !== 0) throw new Error(`R2 upload failed for ${objectPath}`);
}

await fsp.mkdir(bundleDir, { recursive: true });
const descriptors = {};
for (const type of types) {
  const csvText = await fetchExport(type);
  const rows = parseCsv(csvText);
  const filePath = path.join(bundleDir, `${type}.jsonl.gz`);
  const writer = gzipWriter(filePath);
  for (const row of rows) await writer.write(row);
  await writer.close();
  descriptors[type] = await fileDescriptor(filePath, rows.length);
  log(`Wrote ${rows.length.toLocaleString()} ${type} row(s)`);
}

const manifestPath = path.join(outputRoot, 'pokemon', 'prices-manifest.json');
const manifest = {
  category: 'pokemon-prices',
  version,
  generatedAt,
  files: descriptors,
  status: 'ready',
  notes: [],
};
await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

if (upload) {
  log(`Uploading price bundles to R2 bucket ${bucket}`);
  for (const type of types) uploadObject(`pokemon/prices/${type}.jsonl.gz`, path.join(outputRoot, descriptors[type].path));
  uploadObject('pokemon/prices-manifest.json', manifestPath); // Manifest is deliberately last.
}

log(`Ready: ${types.map(t => `${t}=${descriptors[t].recordCount.toLocaleString()}`).join(', ')}`);
log(`Manifest: ${manifestPath}`);
