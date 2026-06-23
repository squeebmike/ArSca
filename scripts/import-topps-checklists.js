#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const zlib = require('zlib');
const { buildChecklistIndex } = require('./topps-checklist-parser');

const DEFAULT_ZIP = 'C:\\Users\\Sales\\Downloads\\toppsChecklist.zip';
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'topps');
const WORK_DIR = path.join(ROOT, '.topps-import');
const PYTHON = process.env.PYTHON || 'C:\\Users\\Sales\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';

function argValue(name, fallback = '') {
  const hit = process.argv.find(a => a === name || a.startsWith(name + '='));
  if (!hit) return fallback;
  if (hit === name) return 'true';
  return hit.slice(name.length + 1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha1File(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function listZipPdfs(zipFile) {
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip=[IO.Compression.ZipFile]::OpenRead('${zipFile.replace(/'/g, "''")}')`,
    '$zip.Entries | Where-Object { $_.FullName -like "*.pdf" } | ForEach-Object { $_.FullName }',
    '$zip.Dispose()',
  ].join('; ');
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractZipEntry(zipFile, entryName, targetFile) {
  ensureDir(path.dirname(targetFile));
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip=[IO.Compression.ZipFile]::OpenRead('${zipFile.replace(/'/g, "''")}')`,
    `$entry=$zip.Entries | Where-Object { $_.FullName -eq '${entryName.replace(/'/g, "''")}' } | Select-Object -First 1`,
    `if($entry){ [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${targetFile.replace(/'/g, "''")}', $true) }`,
    '$zip.Dispose()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function compressSources(index) {
  const compact = {
    schemaVersion: index.schemaVersion,
    generatedAt: index.generatedAt,
    sources: index.sources,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'topps_pdf_sources.json.gz'), zlib.gzipSync(JSON.stringify(compact)));
}

function writeSampleIndex(sources) {
  const sample = buildChecklistIndex(sources.slice(0, 3));
  writeJson(path.join(OUT_DIR, 'topps_checklists_index.sample.json'), sample);
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || data.message || res.statusText || res.status);
  return data;
}

async function publishIndex(worker, index) {
  const base = worker.replace(/\/$/, '');
  const cardChunkSize = Number(argValue('--publish-card-chunk-size', '1000')) || 1000;
  const sourceIndex = index.sources.map(s => {
    const source = { ...s };
    delete source.rawText;
    return source;
  });

  console.log(`Publishing to Worker KV in chunks: ${index.sets.length} sets, ${index.cards.length} cards, ${index.sources.length} PDFs`);
  await postJson(base + '/topps-checklists/import-start', {
    schemaVersion: index.schemaVersion,
    generatedAt: index.generatedAt,
    sets: index.sets,
    sources: sourceIndex,
    expectedCardCount: index.cards.length,
  });

  const chunkCount = Math.ceil(index.cards.length / cardChunkSize);
  for (let i = 0; i < chunkCount; i++) {
    const cards = index.cards.slice(i * cardChunkSize, (i + 1) * cardChunkSize);
    await postJson(base + '/topps-checklists/import-cards-chunk', { chunkIndex: i, cards });
    if ((i + 1) % 10 === 0 || i === chunkCount - 1) console.log(`  cards ${i + 1}/${chunkCount}`);
  }

  for (let i = 0; i < index.sources.length; i++) {
    await postJson(base + '/topps-checklists/import-source', { source: index.sources[i] });
    if ((i + 1) % 50 === 0 || i === index.sources.length - 1) console.log(`  sources ${i + 1}/${index.sources.length}`);
  }

  const done = await postJson(base + '/topps-checklists/import-complete', {
    schemaVersion: index.schemaVersion,
    setCount: index.sets.length,
    cardCount: index.cards.length,
    sourceCount: index.sources.length,
    chunkCount,
  });
  console.log(`Published to Worker: ${done.setCount} sets, ${done.cardCount} cards, ${done.sourceCount} PDFs, ${done.chunkCount} card chunks`);
}

async function main() {
  const zipFile = path.resolve(argValue('--zip', DEFAULT_ZIP));
  const limit = Number(argValue('--limit', '0')) || 0;
  const fresh = process.argv.includes('--fresh');
  const publish = process.argv.includes('--publish');
  const worker = argValue('--worker', 'https://still-resonance-4f87.swarnerauto.workers.dev');
  const manifestFile = path.join(WORK_DIR, 'manifest.json');

  if (!fs.existsSync(zipFile)) throw new Error('Zip not found: ' + zipFile);
  ensureDir(OUT_DIR);
  ensureDir(WORK_DIR);
  if (fresh && fs.existsSync(manifestFile)) fs.rmSync(manifestFile, { force: true });

  const manifest = readJson(manifestFile, { zipFile, processed: {} });
  const entries = listZipPdfs(zipFile).slice(0, limit || undefined);
  const sources = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const base = path.basename(entry);
    const pdfFile = path.join(WORK_DIR, 'pdfs', base);
    const textFile = path.join(WORK_DIR, 'texts', base.replace(/\.pdf$/i, '.json'));

    if (!fs.existsSync(textFile)) {
      console.log(`[${i + 1}/${entries.length}] extracting ${base}`);
      extractZipEntry(zipFile, entry, pdfFile);
      execFileSync(PYTHON, [path.join(__dirname, 'extract_topps_pdf_text.py'), pdfFile, textFile], { stdio: 'inherit' });
    } else {
      console.log(`[${i + 1}/${entries.length}] cached ${base}`);
    }

    const extracted = readJson(textFile, null);
    if (!extracted) continue;
    const pdfHash = fs.existsSync(pdfFile) ? sha1File(pdfFile) : crypto.createHash('sha1').update(entry).digest('hex');
    const sourceId = 'topps_pdf_' + pdfHash.slice(0, 16);
    manifest.processed[entry] = { sourceId, pdfHash, textFile, processedAt: new Date().toISOString() };
    sources.push({
      sourceId,
      fileName: base,
      originalPath: entry,
      pdfHash,
      pageCount: extracted.pageCount || 0,
      rawText: extracted.rawText || '',
      pdfUrl: '',
      importedAt: manifest.processed[entry].processedAt,
    });
  }

  writeJson(manifestFile, manifest);
  const index = buildChecklistIndex(sources);
  writeJson(path.join(OUT_DIR, 'topps_checklists_index.json'), index);
  writeJson(path.join(OUT_DIR, 'topps_sets.json'), index.sets);
  writeJson(path.join(OUT_DIR, 'topps_checklist_cards.json'), index.cards);
  writeSampleIndex(sources);
  writeJson(path.join(OUT_DIR, 'topps_pdf_sources.sample.json'), index.sources.map(s => ({ ...s, rawText: s.rawText.slice(0, 1200) })));
  compressSources(index);

  console.log(`\nTopps checklist import complete`);
  console.log(`PDFs: ${index.sources.length}`);
  console.log(`Sets: ${index.sets.length}`);
  console.log(`Cards: ${index.cards.length}`);
  console.log(`Output: ${path.join(OUT_DIR, 'topps_checklists_index.json')}`);

  if (publish) {
    await publishIndex(worker, index);
  }
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
