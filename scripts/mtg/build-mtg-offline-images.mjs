#!/usr/bin/env node
// Harvests actual MTG card image bytes from Scryfall's own CDN and stores
// them content-addressed in R2, so devices never depend on Scryfall's CDN
// (or its fair-use hotlinking limits, multiplied across an entire fleet of
// store devices) once cached offline. Uses a per-set index + incremental-merge
// pattern so a partial/interrupted build is still usable.
//
// Card metadata/prices are a separate, already-existing daily build
// (scripts/mtg/build-mtg-offline-bundle.mjs, mtg-offline-daily.yml) and are
// untouched by this script -- this only covers what that one doesn't:
// actual image bytes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/core/streamers/stream-array.js';
import chain from 'stream-chain';
import { normalizeScryfallCard, stableHash } from './mtg-offline-core.mjs';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const root = path.resolve(import.meta.dirname, '..', '..');
const outputRoot = path.resolve(root, String(args.get('out') || 'data/mtg-images/build'));
const rawDir = path.resolve(root, String(args.get('raw-dir') || 'data/mtg/raw'));
const imagesDir = path.join(outputRoot, 'images');
const upload = args.get('upload') === true || args.get('upload') === 'true';
const bucket = String(args.get('bucket') || process.env.MTG_R2_BUCKET || 'arsca-offline-catalogs');
const configPath = path.resolve(root, String(args.get('config') || 'wrangler.deploy.jsonc'));
const workerBase = String(args.get('worker-base') || process.env.MTG_WORKER_BASE || 'https://still-resonance-4f87.swarnerauto.workers.dev');
// 'all' or a Scryfall set code (e.g. "mh3", "woe") -- matched case-insensitively.
const scope = String(args.get('scope') || 'all').toLowerCase();
const imageSizes = ['small', 'normal'];
const concurrency = Math.max(1, Number(args.get('concurrency') || 6));
const generatedAt = new Date().toISOString();

function log(message) { process.stdout.write(`[mtg-images] ${message}\n`); }

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Walk-Off-MTG-Offline-Builder/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function downloadToFile(url, destination) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Walk-Off-MTG-Offline-Builder/1.0' } });
  if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status} for ${url}`);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const writer = fs.createWriteStream(destination);
  await new Promise((resolve, reject) => {
    const source = Readable.fromWeb(response.body);
    source.pipe(writer);
    source.on('error', reject); writer.on('error', reject); writer.on('finish', resolve);
  });
  return destination;
}

async function sourceFile(input, fallbackName) {
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) return downloadToFile(input, path.join(rawDir, fallbackName));
  return path.resolve(root, input);
}

async function* readScryfallEntries(filePath, format) {
  if (format === 'jsonl-gz') {
    const lines = readline.createInterface({ input: fs.createReadStream(filePath).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      yield JSON.parse(line);
    }
  } else {
    const stream = chain([fs.createReadStream(filePath), parser(), streamArray()]);
    for await (const entry of stream) yield entry.value;
  }
}

async function fetchExistingJson(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function downloadImage(url, destination, attempts = 2) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Scryfall's CDN requires a real User-Agent on every request (per
      // their API terms) and returns HTTP 400 for anything without one --
      // fetchJson()/downloadToFile() above already send one, this fetch was
      // the one call site that didn't, so every single image request here
      // failed identically regardless of the card or size.
      const response = await fetch(url, { headers: { 'User-Agent': 'Walk-Off-MTG-Offline-Builder/1.0' } });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, buffer);
      return true;
    } catch (error) {
      if (attempt === attempts) { log(`  image download failed for ${url}: ${error.message}`); return false; }
    }
  }
  return false;
}

async function runPool(items, worker, size) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
}

// A transient network blip on a single wrangler upload used to throw
// immediately and kill the whole matrix leg -- confirmed live on a real
// run: a "fetch request failed" mid-upload aborted a leg that had already
// harvested and was uploading ~15 sets, losing every set after it. Retries
// with backoff so one flaky request doesn't cost 15 sets of progress.
async function uploadObject(objectPath, filePath, attempts = 4) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = spawnSync(npx, ['wrangler@latest', 'r2', 'object', 'put', `${bucket}/${objectPath}`, '--file', filePath, '--config', configPath, '--remote'], { stdio: 'inherit', cwd: root, shell: false });
    if (result.status === 0) return;
    if (attempt === attempts) throw new Error(`R2 upload failed for ${objectPath} after ${attempts} attempts`);
    log(`  R2 upload failed for ${objectPath} (attempt ${attempt}/${attempts}), retrying...`);
    await new Promise(resolve => setTimeout(resolve, attempt * 4000));
  }
}

// ── Resolve the Scryfall bulk source (same resolution order as
// build-mtg-offline-bundle.mjs, so a local override works identically) ──
const scryfallArg = String(args.get('scryfall') || process.env.SCRYFALL_BULK_FILE || '');
let scryfallFile, scryfallFormat = 'json-array';
if (scryfallArg) {
  scryfallFile = await sourceFile(scryfallArg, 'scryfall-default-cards.json');
  scryfallFormat = /\.jsonl(\.gz)?$/i.test(scryfallArg) ? 'jsonl-gz' : 'json-array';
} else {
  log('Resolving Scryfall default_cards bulk file');
  const bulkManifest = await fetchJson('https://api.scryfall.com/bulk-data');
  const bulk = (bulkManifest.data || []).find(item => item.type === 'default_cards');
  const bulkUrl = bulk?.jsonl_download_uri || bulk?.download_uri || '';
  if (!bulkUrl) throw new Error('Scryfall default_cards bulk item missing');
  scryfallFormat = bulk.jsonl_download_uri ? 'jsonl-gz' : 'json-array';
  scryfallFile = await downloadToFile(bulkUrl, path.join(rawDir, scryfallFormat === 'jsonl-gz' ? 'scryfall-default-cards.jsonl.gz' : 'scryfall-default-cards.json'));
}

// ── Collect cards in scope ──────────────────────────────────────────────
log(`Streaming Scryfall cards for scope "${scope}"`);
const bySet = new Map(); // setCode -> [{scryfallId, imageUrls:{small,normal}}]
let scanned = 0;
for await (const cardRaw of readScryfallEntries(scryfallFile, scryfallFormat)) {
  scanned++;
  const card = normalizeScryfallCard(cardRaw, generatedAt);
  if (!card.scryfallId || !card.setCode) continue;
  const setCode = String(card.setCode).toLowerCase();
  if (scope !== 'all' && setCode !== scope) continue;
  // Double-faced cards keep their images on card_faces[0], not the
  // top-level image_uris -- normalizeScryfallCard already compacted faces.
  const uris = (card.imageUris && card.imageUris.small) ? card.imageUris : (card.cardFaces?.[0]?.imageUris || {});
  if (!uris.small && !uris.normal) continue;
  if (!bySet.has(setCode)) bySet.set(setCode, []);
  bySet.get(setCode).push({ scryfallId: card.scryfallId, imageUrls: { small: uris.small || uris.normal, normal: uris.normal || uris.small } });
}
log(`Scanned ${scanned.toLocaleString()} entries, matched ${[...bySet.values()].reduce((n, arr) => n + arr.length, 0).toLocaleString()} card(s) with images across ${bySet.size} set(s)`);
if (!bySet.size) throw new Error(scope === 'all' ? 'No cards with images found in the Scryfall bulk file' : `No cards found for set "${scope}"`);

// ── Harvest + upload, one set at a time ─────────────────────────────────
const setCodesUploaded = [];
let totalNewIds = 0;
for (const [setCode, cards] of bySet) {
  log(`Set ${setCode}: ${cards.length} card(s), downloading images (${imageSizes.join('/')})`);
  const newIds = [];
  await runPool(cards, async card => {
    let any = false;
    for (const size of imageSizes) {
      const sourceUrl = card.imageUrls[size];
      if (!sourceUrl) continue;
      const destination = path.join(imagesDir, card.scryfallId, `${size}.jpg`);
      if (await downloadImage(sourceUrl, destination)) any = true;
    }
    if (any) newIds.push(card.scryfallId);
  }, concurrency);
  setCodesUploaded.push(setCode);
  totalNewIds += newIds.length;

  if (upload) {
    log(`Set ${setCode}: uploading ${newIds.length} card image set(s) to R2`);
    for (const id of newIds) {
      for (const size of imageSizes) {
        const filePath = path.join(imagesDir, id, `${size}.jpg`);
        if (fs.existsSync(filePath)) await uploadObject(`mtg/images/${id}/${size}.jpg`, filePath);
      }
    }
    const existingSetIndex = await fetchExistingJson(`${workerBase}/catalog/mtg/images/manifest?set=${encodeURIComponent(setCode)}`);
    const mergedSetIds = [...new Set([...(existingSetIndex?.ids || []), ...newIds])];
    const setIndexPath = path.join(outputRoot, `index-set-${setCode}.json`);
    // outputRoot only gets created as a side effect of a successful
    // downloadImage() call (via its own mkdir of imagesDir/<id>/). When
    // every download for a set fails, that never happens, and this write
    // would otherwise crash with ENOENT instead of reporting the real
    // failure (0 images cached) cleanly.
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(setIndexPath, JSON.stringify({ ids: mergedSetIds, generatedAt }, null, 2));
    await uploadObject(`mtg/images/index-set-${setCode}.json`, setIndexPath);
  }
}

if (upload && scope === 'all') {
  const existingAllIndex = await fetchExistingJson(`${workerBase}/catalog/mtg/images/manifest?set=all`);
  const allNewIds = setCodesUploaded.flatMap(setCode => (bySet.get(setCode) || []).map(c => c.scryfallId));
  const mergedAllIds = [...new Set([...(existingAllIndex?.ids || []), ...allNewIds])];
  const allIndexPath = path.join(outputRoot, 'index-all.json');
  await fsp.mkdir(outputRoot, { recursive: true });
  await fsp.writeFile(allIndexPath, JSON.stringify({ ids: mergedAllIds, generatedAt }, null, 2));
  await uploadObject('mtg/images/index-all.json', allIndexPath);
}

log(`Ready: ${totalNewIds.toLocaleString()} card(s) with at least one size cached across ${setCodesUploaded.length} set(s)`);
log(`Output: ${outputRoot}`);
