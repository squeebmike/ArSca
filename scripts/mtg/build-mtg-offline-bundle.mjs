#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGzip, createGunzip } from 'node:zlib';
import readline from 'node:readline';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/core/streamers/stream-array.js';
import chain from 'stream-chain';
import { parse as csvParse } from 'csv-parse';
import {
  bestPriceChartingMatch,
  buildLinkRecord,
  createPriceIndex,
  normalizePriceChartingRow,
  normalizeScryfallCard,
  stableHash,
} from './mtg-offline-core.mjs';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const root = path.resolve(import.meta.dirname, '..', '..');
const version = String(args.get('version') || new Date().toISOString().slice(0, 10));
const outputRoot = path.resolve(root, String(args.get('out') || 'data/mtg/build'));
const bundleDir = path.join(outputRoot, 'mtg', version);
const rawDir = path.resolve(root, String(args.get('raw-dir') || 'data/mtg/raw'));
const limit = Math.max(0, Number(args.get('limit') || 0));
const upload = args.get('upload') === true || args.get('upload') === 'true';
const bucket = String(args.get('bucket') || process.env.MTG_R2_BUCKET || 'arsca-offline-catalogs');
const configPath = path.resolve(root, String(args.get('config') || 'wrangler.deploy.jsonc'));
const generatedAt = new Date().toISOString();

await fsp.mkdir(bundleDir, { recursive:true });
await fsp.mkdir(rawDir, { recursive:true });

function log(message) { process.stdout.write(`[mtg-bundle] ${message}\n`); }

async function fetchJson(url) {
  const response = await fetch(url, { headers:{ 'User-Agent':'Walk-Off-MTG-Offline-Builder/1.0' } });
  if(!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function downloadToFile(url, destination) {
  const response = await fetch(url, { headers:{ 'User-Agent':'Walk-Off-MTG-Offline-Builder/1.0' } });
  if(!response.ok || !response.body) throw new Error(`Download HTTP ${response.status} for ${url}`);
  await fsp.mkdir(path.dirname(destination), { recursive:true });
  const writer = fs.createWriteStream(destination);
  await new Promise((resolve, reject) => {
    const source = Readable.fromWeb(response.body);
    source.pipe(writer);
    source.on('error', reject); writer.on('error', reject); writer.on('finish', resolve);
  });
  return destination;
}

async function sourceFile(input, fallbackName) {
  if(!input) return null;
  if(/^https?:\/\//i.test(input)) return downloadToFile(input, path.join(rawDir, fallbackName));
  return path.resolve(root, input);
}

function gzipWriter(filePath) {
  const file = fs.createWriteStream(filePath);
  const gzip = createGzip({ level:9 });
  gzip.pipe(file);
  return {
    async write(record) {
      if(!gzip.write(JSON.stringify(record) + '\n')) await new Promise(resolve => gzip.once('drain', resolve));
    },
    async close() {
      gzip.end();
      await new Promise((resolve, reject) => { file.on('finish', resolve); file.on('error', reject); gzip.on('error', reject); });
    }
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk)); stream.on('end', resolve); stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function fileDescriptor(filePath, recordCount) {
  return {
    path:path.relative(outputRoot, filePath).replace(/\\/g, '/'), format:'jsonl.gz',
    sha256:await sha256File(filePath), recordCount, bytes:(await fsp.stat(filePath)).size,
  };
}

const scryfallArg = String(args.get('scryfall') || process.env.SCRYFALL_BULK_FILE || '');
let scryfallMeta = { downloadedAt:generatedAt, bulkType:'default_cards', sourceUrlHash:'' };
let scryfallFile;
// Scryfall's bulk-data items used to expose a plain JSON-array `download_uri`.
// They've since moved to a gzip-compressed JSONL file under `jsonl_download_uri`
// (download_uri can be absent entirely) -- prefer that, but keep the legacy
// array format working for local overrides / a future reversion.
let scryfallFormat = 'json-array';
if(scryfallArg) {
  scryfallFile = await sourceFile(scryfallArg, 'scryfall-default-cards.json');
  scryfallFormat = /\.jsonl(\.gz)?$/i.test(scryfallArg) ? 'jsonl-gz' : 'json-array';
  scryfallMeta.sourceUrlHash = stableHash(scryfallArg);
} else {
  log('Resolving Scryfall default_cards bulk file');
  const bulkManifest = await fetchJson('https://api.scryfall.com/bulk-data');
  const bulk = (bulkManifest.data || []).find(item => item.type === 'default_cards');
  const bulkUrl = bulk?.jsonl_download_uri || bulk?.download_uri || '';
  if(!bulkUrl) {
    const types = Array.isArray(bulkManifest.data) ? bulkManifest.data.map(item => item.type) : [];
    log(`Scryfall bulk-data response had ${Array.isArray(bulkManifest.data) ? bulkManifest.data.length : 0} item(s): [${types.join(', ')}]`);
    if(bulk) log(`default_cards entry found but missing a download URL: ${JSON.stringify(bulk)}`);
    throw new Error('Scryfall default_cards bulk item missing');
  }
  scryfallFormat = bulk.jsonl_download_uri ? 'jsonl-gz' : 'json-array';
  scryfallMeta = { downloadedAt:bulk.updated_at || generatedAt, bulkType:'default_cards', sourceUrlHash:stableHash(bulkUrl) };
  scryfallFile = await downloadToFile(bulkUrl, path.join(rawDir, scryfallFormat === 'jsonl-gz' ? 'scryfall-default-cards.jsonl.gz' : 'scryfall-default-cards.json'));
}

const pcArg = String(args.get('pricecharting') || process.env.PRICECHARTING_MTG_CSV_URL || process.env.PRICECHARTING_MTG_CSV_FILE || '');
if(!pcArg) throw new Error('PRICECHARTING_MTG_CSV_URL or --pricecharting=<file-or-url> is required');
const pricechartingFile = await sourceFile(pcArg, 'pricecharting-mtg.csv');

const cardsPath = path.join(bundleDir, 'cards.jsonl.gz');
const marketPricesPath = path.join(bundleDir, 'market-prices-scryfall.jsonl.gz');
const pricesPath = path.join(bundleDir, 'prices-pricecharting.jsonl.gz');
const linksPath = path.join(bundleDir, 'links-scryfall-pricecharting.jsonl.gz');
const setsPath = path.join(bundleDir, 'sets.jsonl.gz');
const reportPath = path.join(bundleDir, 'build-report.json');
const manifestPath = path.join(outputRoot, 'mtg', 'manifest.json');

async function* readScryfallEntries(filePath, format) {
  if(format === 'jsonl-gz') {
    const lines = readline.createInterface({ input:fs.createReadStream(filePath).pipe(createGunzip()), crlfDelay:Infinity });
    for await (const line of lines) {
      if(!line.trim()) continue;
      yield JSON.parse(line);
    }
  } else {
    const stream = chain([fs.createReadStream(filePath), parser(), streamArray()]);
    for await (const entry of stream) yield entry.value;
  }
}

log('Normalizing streamed Scryfall cards');
const cardWriter = gzipWriter(cardsPath);
const marketPriceWriter = gzipWriter(marketPricesPath);
const setMap = new Map();
let cardCount = 0;
for await (const cardRaw of readScryfallEntries(scryfallFile, scryfallFormat)) {
  const card = normalizeScryfallCard(cardRaw, generatedAt);
  if(!card.scryfallId) continue;
  await cardWriter.write(card);
  await marketPriceWriter.write({ scryfallId:card.scryfallId, prices:card.prices || {}, tcgplayerId:card.tcgplayerId || '', updatedAt:generatedAt });
  cardCount++;
  if(card.setCode) {
    const current = setMap.get(card.setCode) || {
      source:'scryfall', category:'mtg', setCode:card.setCode, setName:card.setName,
      releasedAt:card.releasedAt, cardCount:0, downloadedAt:generatedAt,
    };
    current.cardCount++;
    if(card.releasedAt && (!current.releasedAt || card.releasedAt < current.releasedAt)) current.releasedAt = card.releasedAt;
    setMap.set(card.setCode, current);
  }
  if(limit && cardCount >= limit) break;
}
await cardWriter.close();
await marketPriceWriter.close();

log('Normalizing PriceCharting MTG snapshot');
const priceWriter = gzipWriter(pricesPath);
const prices = [];
const csv = fs.createReadStream(pricechartingFile).pipe(csvParse({ columns:true, bom:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true }));
for await (const row of csv) {
  const price = normalizePriceChartingRow(row, generatedAt);
  if(!price.pricechartingId || !price.productName) continue;
  if(price.consoleName && !/magic|mtg/i.test(price.consoleName)) continue;
  prices.push(price);
  await priceWriter.write(price);
}
await priceWriter.close();

const setWriter = gzipWriter(setsPath);
for(const set of [...setMap.values()].sort((a, b) => String(b.releasedAt).localeCompare(String(a.releasedAt)))) await setWriter.write(set);
await setWriter.close();

log('Building conservative Scryfall to PriceCharting links');
const priceIndex = createPriceIndex(prices);
const linkWriter = gzipWriter(linksPath);
const linkStats = { autoLinked:0, high:0, medium:0, low:0, lowExamples:[], linkedPriceIds:new Set() };
const cardLines = readline.createInterface({ input:fs.createReadStream(cardsPath).pipe(createGunzip()), crlfDelay:Infinity });
for await (const line of cardLines) {
  if(!line.trim()) continue;
  const card = JSON.parse(line);
  const match = bestPriceChartingMatch(card, priceIndex);
  const link = buildLinkRecord(card, match);
  if(!link) continue;
  await linkWriter.write(link);
  linkStats.autoLinked++;
  linkStats.linkedPriceIds.add(link.pricechartingId);
  if(link.confidence >= 95) linkStats.high++;
  else if(link.confidence >= 85) linkStats.medium++;
  else {
    linkStats.low++;
    if(linkStats.lowExamples.length < 20) linkStats.lowExamples.push(link);
  }
}
await linkWriter.close();

const descriptors = {
  cards:await fileDescriptor(cardsPath, cardCount), prices:await fileDescriptor(pricesPath, prices.length),
  marketPrices:await fileDescriptor(marketPricesPath, cardCount), links:await fileDescriptor(linksPath, linkStats.autoLinked), sets:await fileDescriptor(setsPath, setMap.size),
};
const report = {
  category:'mtg', version, generatedAt, totalScryfallCards:cardCount, totalPriceChartingProducts:prices.length,
  autoLinkedCount:linkStats.autoLinked, highConfidenceCount:linkStats.high, mediumConfidenceCount:linkStats.medium,
  lowConfidenceCount:linkStats.low, unmatchedScryfallCount:cardCount - linkStats.autoLinked,
  unmatchedPriceChartingCount:prices.length - linkStats.linkedPriceIds.size, lowConfidenceExamples:linkStats.lowExamples,
  files:descriptors,
};
await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));

const manifest = {
  category:'mtg', version, generatedAt,
  sourceVersions:{
    scryfall:scryfallMeta,
    pricecharting:{ downloadedAt:generatedAt, source:'pricecharting-mtg-download' },
  },
  files:descriptors, status:'ready', notes:[],
};
await fsp.mkdir(path.dirname(manifestPath), { recursive:true });
await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

function uploadObject(objectPath, filePath) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['wrangler@latest', 'r2', 'object', 'put', `${bucket}/${objectPath}`, '--file', filePath, '--config', configPath], { stdio:'inherit', cwd:root, shell:false });
  if(result.status !== 0) throw new Error(`R2 upload failed for ${objectPath}`);
}

if(upload) {
  log(`Uploading bundle to R2 bucket ${bucket}`);
  for(const file of Object.values(descriptors)) uploadObject(file.path, path.join(outputRoot, file.path));
  uploadObject(`mtg/${version}/build-report.json`, reportPath);
  uploadObject('mtg/manifest.json', manifestPath); // Manifest is deliberately last.
}

log(`Ready: ${cardCount.toLocaleString()} cards, ${prices.length.toLocaleString()} prices, ${linkStats.autoLinked.toLocaleString()} links`);
log(`Manifest: ${manifestPath}`);
