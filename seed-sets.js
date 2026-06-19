#!/usr/bin/env node
/**
 * seed-sets.js — push local set JSON files into the Worker KV via /sets/import-json
 *
 * Usage:
 *   node seed-sets.js [worker-url]
 *
 * Default worker URL: https://still-resonance-4f87.swarnerauto.workers.dev
 */

const fs = require('fs');
const path = require('path');

const WORKER = process.argv[2] || 'https://still-resonance-4f87.swarnerauto.workers.dev';

const SETS = [
  {
    file: path.join(__dirname, '2026_topps_s1_baseball.json'),
    slug: '2026-topps-s1-baseball',
    name: '2026 Topps Series 1 Baseball',
    sport: 'baseball',
    year: '2026',
  },
];

async function seedSet({ file, slug, name, sport, year }) {
  if (!fs.existsSync(file)) {
    console.error(`  ✗ File not found: ${file}`);
    return false;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);

  // Attach metadata fields the Worker needs
  const payload = { ...data, slug, name: name || data.set, sport, year: year || data.release_date };

  console.log(`  → Seeding ${name} (${(raw.length / 1024).toFixed(0)} KB)…`);

  const res = await fetch(`${WORKER}/sets/import-json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.ok) {
    console.log(`  ✓ ${name}: ${result.baseCount} base cards`);
    return true;
  } else {
    console.error(`  ✗ Failed: ${result.error}`);
    return false;
  }
}

(async () => {
  console.log(`Seeding sets → ${WORKER}\n`);
  let ok = 0, fail = 0;
  for (const s of SETS) {
    const success = await seedSet(s);
    success ? ok++ : fail++;
  }
  console.log(`\nDone: ${ok} seeded, ${fail} failed`);
})();
