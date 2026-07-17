#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const worker = String(process.env.TOPPS_WORKER_URL || process.argv[2] || 'https://still-resonance-4f87.swarnerauto.workers.dev').replace(/\/$/, '');
const manifestResponse = await fetch(`${worker}/catalog/topps/manifest`, { cache: 'no-store' });
if (!manifestResponse.ok) throw new Error(`Topps manifest HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
if (manifest.status !== 'ready' || !manifest.version) throw new Error('Topps manifest is not ready');

const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'walkoff-topps-r2-'));
async function verify(type) {
  const descriptor = manifest.files?.[type];
  if (!descriptor?.sha256 || !descriptor?.recordCount) throw new Error(`Topps manifest is missing ${type} integrity data`);
  const response = await fetch(`${worker}/catalog/topps/download?file=${type}`, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`Topps ${type} download HTTP ${response.status}`);
  const file = path.join(temp, `${type}.jsonl.gz`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(file)
    .on('data', chunk => hash.update(chunk))
    .on('end', resolve)
    .on('error', reject));
  const actualHash = hash.digest('hex');
  if (actualHash !== String(descriptor.sha256).toLowerCase()) throw new Error(`Topps ${type} SHA-256 mismatch`);
  let count = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) { JSON.parse(line); count++; }
  if (count !== Number(descriptor.recordCount)) throw new Error(`Topps ${type} count mismatch (${count}/${descriptor.recordCount})`);
  return { count, bytes: (await fsp.stat(file)).size, sha256: actualHash };
}

try {
  const sets = await verify('sets');
  const cards = await verify('cards');
  console.log(JSON.stringify({ ok: true, version: manifest.version, sets, cards }, null, 2));
} finally {
  await fsp.rm(temp, { recursive: true, force: true });
}
