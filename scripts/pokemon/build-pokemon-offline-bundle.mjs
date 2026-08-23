#!/usr/bin/env node
// Builds the Pokemon offline catalog bundle: real set metadata (from PPT's
// /sets endpoint) plus, on request, actual card image bytes harvested from
// PPT's live /cards endpoint and stored content-addressed in R2 so devices
// never depend on TCGPlayer's CDN once cached.
//
// Bulk price/sealed/ebay/population data stays on the existing
// /pricing/pokemon/export Worker route (see cloudflare-worker-full.js) --
// this script only covers what that route can't: set metadata and images.
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
const outputRoot = path.resolve(root, String(args.get('out') || 'data/pokemon/build'));
const bundleDir = path.join(outputRoot, 'pokemon');
const imagesDir = path.join(outputRoot, 'pokemon-images');
const upload = args.get('upload') === true || args.get('upload') === 'true';
const bucket = String(args.get('bucket') || process.env.POKEMON_R2_BUCKET || 'arsca-offline-catalogs');
const configPath = path.resolve(root, String(args.get('config') || 'wrangler.deploy.jsonc'));
const workerBase = String(args.get('worker-base') || process.env.POKEMON_WORKER_BASE || 'https://still-resonance-4f87.swarnerauto.workers.dev');
const apiBase = String(args.get('api-base') || process.env.POKEMONPRICE_API_BASE || 'https://www.pokemonpricetracker.com/api/v2');
const apiKey = String(args.get('api-key') || process.env.POKEMONPRICE_API_KEY || process.env.POKEMON_PRICE_TRACKER_API_KEY || '');
// none: sets only. all: every set's card images. set:<tcgPlayerNumericId>: one set's card images.
const imagesMode = String(args.get('images') || 'none');
const imageSizes = ['200', '400'];
const concurrency = Math.max(1, Number(args.get('concurrency') || 6));
const generatedAt = new Date().toISOString();

function log(message) { process.stdout.write(`[pokemon-bundle] ${message}\n`); }

async function fetchJson(pathname, params = {}) {
  const url = new URL(apiBase + pathname);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`PPT ${pathname} HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  return response.json();
}

async function fetchAllPages(pathname, params, extract) {
  const out = [];
  let offset = 0;
  const limit = Number(params.limit || 100);
  for (;;) {
    const page = await fetchJson(pathname, { ...params, offset });
    const rows = extract(page);
    out.push(...rows);
    const meta = page.metadata || {};
    if (!meta.hasMore || !rows.length) break;
    offset += limit;
  }
  return out;
}

function normalizeSet(raw) {
  return {
    id: String(raw.id || ''),
    tcgPlayerId: String(raw.tcgPlayerId || ''),
    tcgPlayerNumericId: raw.tcgPlayerNumericId != null ? String(raw.tcgPlayerNumericId) : '',
    name: raw.name || '',
    series: raw.series || '',
    releaseDate: raw.releaseDate || '',
    cardCount: Number(raw.cardCount || 0),
    imageUrl200: raw.imageCdnUrl200 || '',
    imageUrl400: raw.imageCdnUrl400 || '',
    imageUrl800: raw.imageCdnUrl800 || raw.imageCdnUrl || '',
    downloadedAt: generatedAt,
  };
}

function normalizeCardForImage(raw) {
  const id = String(raw.tcgPlayerId || raw.id || '');
  if (!id) return null;
  return {
    tcgPlayerId: id,
    name: raw.name || '',
    imageUrl200: raw.imageCdnUrl200 || '',
    imageUrl400: raw.imageCdnUrl400 || raw.imageCdnUrl || raw.imageUrl || '',
  };
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
      const response = await fetch(url);
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
// immediately and kill the whole run -- same failure mode confirmed live on
// the MTG image builder (see build-mtg-offline-images.mjs), which shares
// this exact upload helper. Retries with backoff so one flaky request
// doesn't waste an entire set's (or the whole catalog's) harvested images.
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

// ── Sets ─────────────────────────────────────────────────────────────────
await fsp.mkdir(bundleDir, { recursive: true });
const setsPath = path.join(bundleDir, 'sets.jsonl.gz');
const manifestPath = path.join(outputRoot, 'pokemon', 'manifest.json');

let rawSets;
const setsFileArg = args.get('sets-file');
if (setsFileArg) {
  log(`Loading sets from local file ${setsFileArg}`);
  rawSets = JSON.parse(await fsp.readFile(path.resolve(root, String(setsFileArg)), 'utf8'));
} else {
  if (!apiKey) throw new Error('POKEMONPRICE_API_KEY is required (or pass --sets-file for local/testing runs)');
  log('Fetching Pokemon sets from PokemonPriceTracker');
  rawSets = await fetchAllPages('/sets', { language: 'english', limit: 500 }, page => page.data || []);
}
const sets = rawSets.map(normalizeSet);
const setWriter = gzipWriter(setsPath);
for (const set of sets.sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))) await setWriter.write(set);
await setWriter.close();
log(`Wrote ${sets.length.toLocaleString()} sets`);

// ── Images (optional) ───────────────────────────────────────────────────
let imageReport = null;
if (imagesMode !== 'none') {
  const scopeIsAll = imagesMode === 'all';
  const singleSetId = scopeIsAll ? '' : imagesMode.replace(/^set:/, '');
  const setsFileArg2 = args.get('cards-file');
  const targetSets = scopeIsAll
    ? sets.filter(s => s.tcgPlayerNumericId)
    : sets.filter(s => s.tcgPlayerNumericId === singleSetId);
  if (!scopeIsAll && !targetSets.length) throw new Error(`No set found with tcgPlayerNumericId=${singleSetId}`);
  log(`Harvesting images for ${scopeIsAll ? 'ALL sets' : `set ${singleSetId}`} (${targetSets.length} set(s))`);

  const setIdsUploaded = [];
  let totalNewIds = 0;
  for (const set of targetSets) {
    log(`Set ${set.name || set.tcgPlayerNumericId}: fetching card list`);
    let cards;
    if (setsFileArg2) {
      cards = JSON.parse(await fsp.readFile(path.resolve(root, String(setsFileArg2)), 'utf8'));
    } else {
      const raw = await fetchAllPages('/cards', { language: 'english', setId: set.tcgPlayerNumericId, limit: 200 }, page => page.data || []);
      cards = raw;
    }
    const normalized = cards.map(normalizeCardForImage).filter(Boolean);
    log(`Set ${set.name || set.tcgPlayerNumericId}: ${normalized.length} cards, downloading images (${imageSizes.join('/')}px)`);
    const newIds = [];
    await runPool(normalized, async card => {
      let any = false;
      for (const size of imageSizes) {
        const sourceUrl = size === '200' ? (card.imageUrl200 || card.imageUrl400) : (card.imageUrl400 || card.imageUrl200);
        if (!sourceUrl) continue;
        const destination = path.join(imagesDir, card.tcgPlayerId, `${size}.jpg`);
        if (await downloadImage(sourceUrl, destination)) any = true;
      }
      if (any) newIds.push(card.tcgPlayerId);
    }, concurrency);
    setIdsUploaded.push(...newIds);
    totalNewIds += newIds.length;

    if (upload) {
      log(`Set ${set.name || set.tcgPlayerNumericId}: uploading ${newIds.length} card image sets to R2`);
      for (const id of newIds) {
        for (const size of imageSizes) {
          const filePath = path.join(imagesDir, id, `${size}.jpg`);
          if (fs.existsSync(filePath)) await uploadObject(`pokemon/images/${id}/${size}.jpg`, filePath);
        }
      }
      const existingSetIndex = await fetchExistingJson(`${workerBase}/catalog/pokemon/images/manifest?set=${encodeURIComponent(set.tcgPlayerNumericId)}`);
      const mergedSetIds = [...new Set([...(existingSetIndex?.ids || []), ...newIds])];
      const setIndexPath = path.join(outputRoot, `index-set-${set.tcgPlayerNumericId}.json`);
      await fsp.writeFile(setIndexPath, JSON.stringify({ ids: mergedSetIds, generatedAt }, null, 2));
      await uploadObject(`pokemon/images/index-set-${set.tcgPlayerNumericId}.json`, setIndexPath);
    }
  }

  if (upload) {
    const existingAllIndex = await fetchExistingJson(`${workerBase}/catalog/pokemon/images/manifest?set=all`);
    const mergedAllIds = [...new Set([...(existingAllIndex?.ids || []), ...setIdsUploaded])];
    const allIndexPath = path.join(outputRoot, 'index-all.json');
    await fsp.writeFile(allIndexPath, JSON.stringify({ ids: mergedAllIds, generatedAt }, null, 2));
    await uploadObject('pokemon/images/index-all.json', allIndexPath);
  }

  const existingManifest = await fetchExistingJson(`${workerBase}/catalog/pokemon/manifest`);
  const previousSetsCovered = existingManifest?.images?.setsCovered || [];
  const setsCoveredThisRun = targetSets.map(s => s.tcgPlayerNumericId);
  imageReport = {
    sizes: imageSizes.map(Number),
    setsCovered: scopeIsAll ? sets.filter(s => s.tcgPlayerNumericId).map(s => s.tcgPlayerNumericId) : [...new Set([...previousSetsCovered, ...setsCoveredThisRun])],
    allSetsCovered: scopeIsAll || !!existingManifest?.images?.allSetsCovered,
    cardImagesThisRun: totalNewIds,
    lastImageBuildAt: generatedAt,
    lastImageScope: scopeIsAll ? 'all' : `set:${singleSetId}`,
  };
  log(`Images: ${totalNewIds.toLocaleString()} card(s) with at least one size cached`);
} else {
  const existingManifest = await fetchExistingJson(`${workerBase}/catalog/pokemon/manifest`);
  if (existingManifest?.images) imageReport = existingManifest.images;
}

// ── Manifest ─────────────────────────────────────────────────────────────
const descriptors = { sets: await fileDescriptor(setsPath, sets.length) };
const manifest = {
  category: 'pokemon',
  version,
  generatedAt,
  files: descriptors,
  images: imageReport || { sizes: [200, 400], setsCovered: [], allSetsCovered: false, cardImagesThisRun: 0, lastImageBuildAt: '', lastImageScope: '' },
  status: 'ready',
  notes: [],
};
await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

if (upload) {
  log(`Uploading sets bundle to R2 bucket ${bucket}`);
  await uploadObject(descriptors.sets.path, path.join(outputRoot, descriptors.sets.path));
  await uploadObject('pokemon/manifest.json', manifestPath); // Manifest is deliberately last.
}

log(`Ready: ${sets.length.toLocaleString()} sets${imageReport ? `, images covering ${imageReport.setsCovered.length} set(s)${imageReport.allSetsCovered ? ' (all)' : ''}` : ''}`);
log(`Manifest: ${manifestPath}`);
