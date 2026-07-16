#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGzip } from 'node:zlib';

const args = new Map(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : true]; }));
const root = path.resolve(import.meta.dirname, '..', '..');
const version = String(args.get('version') || new Date().toISOString().slice(0, 10));
const generatedAt = new Date().toISOString();
const cardsPath = path.resolve(root, String(args.get('cards') || 'data/topps/export/topps_checklist_cards.json'));
const setsPath = path.resolve(root, String(args.get('sets') || 'data/topps/export/topps_sets.json'));
const outputRoot = path.resolve(root, String(args.get('out') || 'data/topps/offline-build'));
const upload = args.get('upload') === true || args.get('upload') === 'true';
const bucket = String(args.get('bucket') || process.env.MTG_R2_BUCKET || 'arsca-offline-catalogs');
const configPath = path.resolve(root, String(args.get('config') || 'wrangler.deploy.jsonc'));

async function sha256(file) { const hash = crypto.createHash('sha256'); await new Promise((resolve, reject) => fs.createReadStream(file).on('data', c => hash.update(c)).on('end', resolve).on('error', reject)); return hash.digest('hex'); }
function compactCard(row = {}) { return { id: row.id, setId: row.setId || row.set_id, sourceId: row.sourceId || row.source_id, year: row.year, brand: row.brand, product: row.product, sport: row.sport, setName: row.setName || row.set_name, releaseName: row.releaseName || row.release_name, cardNumber: row.cardNumber || row.card_number, player: row.player, subject: row.subject, team: row.team, notes: row.notes, section: row.section, flags: row.flags || {}, parseConfidence: Number(row.parseConfidence ?? row.parse_confidence ?? 0), searchText: row.searchText || row.search_text || '', updatedAt: row.updatedAt || row.updated_at || generatedAt }; }
function compactSet(row = {}) { return { id: row.id, year: row.year, brand: row.brand, product: row.product, sport: row.sport, setName: row.setName || row.set_name, releaseName: row.releaseName || row.release_name, cardCount: Number(row.cardCount ?? row.card_count ?? 0), updatedAt: row.updatedAt || row.updated_at || generatedAt }; }
async function writeJsonlGzip(file, rows, mapper) { await fsp.mkdir(path.dirname(file), { recursive: true }); const out = fs.createWriteStream(file), gzip = createGzip({ level: 9 }); gzip.pipe(out); for (const row of rows) { const value = mapper(row); if (!value.id) continue; if (!gzip.write(JSON.stringify(value) + '\n')) await new Promise(resolve => gzip.once('drain', resolve)); } gzip.end(); await new Promise((resolve, reject) => out.on('finish', resolve).on('error', reject)); }
async function descriptor(file, count) { return { path: path.relative(outputRoot, file).replace(/\\/g, '/'), format: 'jsonl.gz', sha256: await sha256(file), recordCount: count, bytes: (await fsp.stat(file)).size }; }
function uploadObject(key, file) { const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'; const result = spawnSync(npx, ['wrangler@latest', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--config', configPath, '--remote'], { stdio: 'inherit', cwd: root, shell: false }); if (result.status !== 0) throw new Error(`R2 upload failed for ${key}`); }

const cards = JSON.parse(await fsp.readFile(cardsPath, 'utf8'));
const sets = JSON.parse(await fsp.readFile(setsPath, 'utf8'));
if (!Array.isArray(cards) || !Array.isArray(sets)) throw new Error('Topps cards and sets inputs must be JSON arrays');
const versionDir = path.join(outputRoot, 'topps', version);
const cardsFile = path.join(versionDir, 'cards.jsonl.gz'), setsFile = path.join(versionDir, 'sets.jsonl.gz');
await writeJsonlGzip(cardsFile, cards, compactCard);
await writeJsonlGzip(setsFile, sets, compactSet);
const manifest = { category: 'topps', label: 'Topps Sports Checklists', version, generatedAt, schemaVersion: 1, sourceVersions: { topps: { importedAt: generatedAt } }, files: { cards: await descriptor(cardsFile, cards.length), sets: await descriptor(setsFile, sets.length) }, status: 'ready' };
const manifestPath = path.join(outputRoot, 'topps', 'manifest.json');
await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
if (upload) { uploadObject(manifest.files.cards.path, cardsFile); uploadObject(manifest.files.sets.path, setsFile); uploadObject('topps/manifest.json', manifestPath); }
process.stdout.write(`[topps-offline] ${sets.length.toLocaleString()} sets / ${cards.length.toLocaleString()} cards / ${version}\n`);
