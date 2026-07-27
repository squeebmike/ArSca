#!/usr/bin/env node
// Adds newly-parsed Topps sets/cards to the existing live R2 catalog and
// publishes a new version -- no Supabase involved. The historical catalog
// (740 sets / 426,540 cards) was already verified and migrated to R2 on
// 2026-07-16 (see supabase-migrations/2026-07-15-retire-topps-catalog-after-r2.sql);
// Supabase is retired for good, so growing the catalog now means merging
// straight into R2 instead of routing through a database with a storage cap.
//
// Usage:
//   node scripts/topps/merge-and-publish.mjs \
//     --new-cards=data/topps/topps_checklist_cards.json \
//     --new-sets=data/topps/topps_sets.json \
//     --version=2026-08-01.1 \
//     --upload=true
//
// The --new-cards/--new-sets files are exactly what `npm run topps:import`
// (scripts/import-topps-checklists.js) already writes locally -- run that
// first against a zip containing only the new sets you want to add.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const args = new Map(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : true]; }));
const root = path.resolve(import.meta.dirname, '..', '..');
const worker = String(args.get('worker') || 'https://still-resonance-4f87.swarnerauto.workers.dev').replace(/\/$/, '');
const newCardsPath = path.resolve(root, String(args.get('new-cards') || 'data/topps/topps_checklist_cards.json'));
const newSetsPath = path.resolve(root, String(args.get('new-sets') || 'data/topps/topps_sets.json'));
const version = String(args.get('version') || new Date().toISOString().slice(0, 10) + '.1');
const upload = args.get('upload') === true || args.get('upload') === 'true';
const outputRoot = path.resolve(root, String(args.get('out') || 'data/topps/offline-build'));

if (!fs.existsSync(newCardsPath)) throw new Error('Missing new cards file: ' + newCardsPath + ' -- run `npm run topps:import` against the new sets first');
if (!fs.existsSync(newSetsPath)) throw new Error('Missing new sets file: ' + newSetsPath);

async function fetchManifest() {
  const res = await fetch(`${worker}/catalog/topps/manifest`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Topps manifest HTTP ${res.status}`);
  const manifest = await res.json();
  if (manifest.status !== 'ready' || !manifest.version) throw new Error('Topps manifest is not ready -- nothing to merge against');
  return manifest;
}

async function downloadJsonl(type, manifest, tempDir) {
  const descriptor = manifest.files?.[type];
  if (!descriptor?.path) throw new Error(`Manifest is missing ${type} descriptor`);
  const res = await fetch(`${worker}/catalog/topps/download?file=${type}`, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Topps ${type} download HTTP ${res.status}`);
  const file = path.join(tempDir, `${type}.jsonl.gz`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const rows = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) rows.push(JSON.parse(line));
  if (rows.length !== Number(descriptor.recordCount)) throw new Error(`Downloaded ${type} count mismatch (${rows.length}/${descriptor.recordCount}) -- refusing to merge against a corrupt download`);
  return rows;
}

function cardDedupeKey(card = {}) {
  return [card.setId, card.section, card.cardNumber, card.subject || card.player].map(v => String(v || '').toLowerCase().trim()).join('|');
}

function mergeCards(existingCards, newCards) {
  const byId = new Map(existingCards.map(c => [c.id, c]));
  // Card ids include the source PDF's hash, so re-scraping the same set from
  // a byte-different PDF would otherwise create true duplicates -- catch
  // that with a secondary key on (set, section, card #, subject) and treat
  // it as an update-in-place rather than a new row.
  const byDedupeKey = new Map(existingCards.map(c => [cardDedupeKey(c), c.id]));
  for (const card of newCards) {
    const dedupeKey = cardDedupeKey(card);
    const priorId = byDedupeKey.get(dedupeKey);
    if (priorId && priorId !== card.id) byId.delete(priorId);
    byId.set(card.id, card);
    byDedupeKey.set(dedupeKey, card.id);
  }
  return [...byId.values()];
}

function mergeSets(existingSets, newSets, mergedCards) {
  const bySetId = new Map(existingSets.map(s => [s.id, s]));
  for (const set of newSets) bySetId.set(set.id, { ...bySetId.get(set.id), ...set });
  const cardCountBySet = new Map();
  for (const card of mergedCards) cardCountBySet.set(card.setId, (cardCountBySet.get(card.setId) || 0) + 1);
  for (const set of bySetId.values()) set.cardCount = cardCountBySet.get(set.id) || set.cardCount || 0;
  return [...bySetId.values()];
}

async function main() {
  const manifest = await fetchManifest();
  console.log(`Current live catalog: version ${manifest.version}, ${manifest.files.sets.recordCount.toLocaleString()} sets / ${manifest.files.cards.recordCount.toLocaleString()} cards`);

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'walkoff-topps-merge-'));
  let existingSets, existingCards;
  try {
    existingSets = await downloadJsonl('sets', manifest, tempDir);
    existingCards = await downloadJsonl('cards', manifest, tempDir);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  const newCards = JSON.parse(await fsp.readFile(newCardsPath, 'utf8'));
  const newSets = JSON.parse(await fsp.readFile(newSetsPath, 'utf8'));
  if (!Array.isArray(newCards) || !Array.isArray(newSets)) throw new Error('New cards/sets inputs must be JSON arrays');
  console.log(`New local data: ${newSets.length.toLocaleString()} sets / ${newCards.length.toLocaleString()} cards`);

  const mergedCards = mergeCards(existingCards, newCards);
  const mergedSets = mergeSets(existingSets, newSets, mergedCards);
  console.log(`Merged result: ${mergedSets.length.toLocaleString()} sets / ${mergedCards.length.toLocaleString()} cards`);
  if (mergedSets.length === existingSets.length && mergedCards.length === existingCards.length) {
    console.log('No new sets/cards were actually added -- nothing changed, skipping publish. (Set ids/keys already matched the live catalog.)');
    return;
  }

  const mergedDir = path.join(outputRoot, 'merged-input');
  await fsp.mkdir(mergedDir, { recursive: true });
  const mergedCardsPath = path.join(mergedDir, 'topps_checklist_cards.merged.json');
  const mergedSetsPath = path.join(mergedDir, 'topps_sets.merged.json');
  await fsp.writeFile(mergedCardsPath, JSON.stringify(mergedCards));
  await fsp.writeFile(mergedSetsPath, JSON.stringify(mergedSets));

  const buildArgs = ['scripts/topps/build-offline-bundle.mjs', `--cards=${mergedCardsPath}`, `--sets=${mergedSetsPath}`, `--version=${version}`, `--out=${outputRoot}`];
  if (upload) buildArgs.push('--upload=true');
  console.log(`\nBuilding version ${version} from merged data...`);
  const result = spawnSync(process.execPath, buildArgs, { stdio: 'inherit', cwd: root });
  if (result.status !== 0) throw new Error('build-offline-bundle.mjs failed');
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
