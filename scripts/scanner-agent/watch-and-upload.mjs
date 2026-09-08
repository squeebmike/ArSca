#!/usr/bin/env node
// The Mana Pocket -- Card Intake scanner agent.
//
// Watches a local folder for new image files (whatever your scanner
// software drops there -- a Ricoh fi-8170's own capture app, or anything
// else that saves JPG/PNG files) and uploads each one to the store's
// Card Intake pipeline as soon as it appears. Deliberately has zero
// knowledge of any specific scanner brand -- it only ever looks at a
// folder full of images, so swapping scanner hardware later needs no
// changes here.
//
// Usage:
//   node watch-and-upload.mjs --folder /path/to/scan/output --url https://<your-worker>.workers.dev --token <scanner-station-token>
// or via env vars: SCAN_FOLDER, WORKER_URL, SCANNER_TOKEN
//
// Get a token from the dashboard: Card Intake -> SCANNER -> CREATE SCANNER
// STATION TOKEN. Each uploaded image becomes its own card_intake_item in a
// batch grouped by station + day; nothing here does any card identification
// itself -- that happens server-/dashboard-side, same as every other
// intake source.

import { watch, readdirSync, statSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const FOLDER = path.resolve(arg('folder', process.env.SCAN_FOLDER || './scans'));
const WORKER_URL = (arg('url', process.env.WORKER_URL) || '').replace(/\/$/, '');
const TOKEN = arg('token', process.env.SCANNER_TOKEN);
const POLL_MS = Number(arg('poll-ms', process.env.SCAN_POLL_MS || 3000));
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

if (!WORKER_URL || !TOKEN) {
  console.error('Usage: node watch-and-upload.mjs --folder <path> --url <worker-url> --token <scanner-token>');
  process.exit(1);
}
if (!existsSync(FOLDER)) mkdirSync(FOLDER, { recursive: true });
const uploadedDir = path.join(FOLDER, 'uploaded');
const failedDir = path.join(FOLDER, 'failed');
mkdirSync(uploadedDir, { recursive: true });
mkdirSync(failedDir, { recursive: true });

const inFlight = new Set();

async function uploadOne(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const buf = await readFile(filePath);
  const res = await fetch(`${WORKER_URL}/card-intake/scanner-upload`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'X-Scanner-Token': TOKEN },
    body: buf,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

// Waits for a file to stop growing before uploading it -- a scanner still
// writing a multi-megabyte TIFF/JPEG would otherwise get uploaded half-done.
function fileSizeStable(filePath) {
  return new Promise((resolve) => {
    let lastSize = -1;
    const check = () => {
      let size;
      try { size = statSync(filePath).size; } catch (_) { resolve(false); return; }
      if (size === lastSize && size > 0) { resolve(true); return; }
      lastSize = size;
      setTimeout(check, 400);
    };
    check();
  });
}

async function processFile(filePath) {
  const name = path.basename(filePath);
  if (inFlight.has(name)) return;
  if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) return;
  inFlight.add(name);
  try {
    const stable = await fileSizeStable(filePath);
    if (!stable) return;
    const data = await uploadOne(filePath);
    renameSync(filePath, path.join(uploadedDir, name));
    console.log(`[scanner-agent] uploaded ${name} -> batch ${data.batchId} item ${data.item?.id || '?'}`);
  } catch (e) {
    console.error(`[scanner-agent] FAILED ${name}: ${e.message} -- moved to failed/ for retry`);
    try { renameSync(filePath, path.join(failedDir, name)); } catch (_) { /* left in place, will retry next scan */ }
  } finally {
    inFlight.delete(name);
  }
}

function scanExisting() {
  for (const entry of readdirSync(FOLDER)) {
    const full = path.join(FOLDER, entry);
    if (entry === 'uploaded' || entry === 'failed') continue;
    try { if (statSync(full).isFile()) processFile(full); } catch (_) { /* file removed mid-scan */ }
  }
}

console.log(`[scanner-agent] watching ${FOLDER} -> ${WORKER_URL}/card-intake/scanner-upload`);
scanExisting();
setInterval(scanExisting, POLL_MS);
try {
  watch(FOLDER, (_event, filename) => {
    if (filename) processFile(path.join(FOLDER, filename));
  });
} catch (e) {
  console.warn('[scanner-agent] fs.watch unavailable, relying on polling only:', e.message);
}
