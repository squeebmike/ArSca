import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// 2026-10-25: PriceCharting answered 503 for the Yu-Gi-Oh file and the
// whole daily run failed -- no category updated. Busy answers are tried
// again, and a category that keeps failing keeps yesterday's catalog
// while the others still publish.
const root = path.resolve(import.meta.dirname, '..');
const csv = fs.readFileSync(path.join(root, 'tests/fixtures/pricecharting/offline-sample.csv'), 'utf8');
const hits = { video_games: 0, yugioh: 0, one_piece: 0 };
const server = http.createServer((req, res) => {
  const key = req.url.slice(1);
  hits[key]++;
  if (key === 'yugioh' && hits.yugioh < 3) { res.writeHead(503); return res.end('busy'); }   // busy twice, then fine
  if (key === 'one_piece') { res.writeHead(503); return res.end('down'); }                   // down all day
  if (key === 'video_games' && hits.video_games === 1) { res.writeHead(404); return res.end('no'); } // not retried
  res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(csv);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const run = (sources, out) => new Promise(resolve => {
  const child = spawn(process.execPath, ['scripts/pricecharting/build-offline-bundle.mjs', '--version=test', '--out=' + out, '--retry-wait-ms=1', '--sources-json=' + JSON.stringify(sources)], { cwd: root });
  let text = ''; child.stdout.on('data', d => text += d); child.stderr.on('data', d => text += d);
  child.on('close', status => resolve({ status, text }));
});
try {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-retry-'));
  const r = await run({ yugioh: base + 'yugioh', one_piece: base + 'one_piece' }, out);
  assert.equal(r.status, 0, r.text);
  assert.equal(hits.yugioh, 3, 'a busy answer is tried again (3 tries)');
  assert.ok(fs.existsSync(path.join(out, 'yugioh', 'manifest.json')), 'Yu-Gi-Oh published after the retries');
  assert.equal(hits.one_piece, 3);
  assert.equal(fs.existsSync(path.join(out, 'one_piece')), false, 'One Piece left alone: yesterday\'s catalog stays');
  assert.match(r.text, /::warning::PriceCharting One Piece Cards not updated today, yesterday's catalog stays live \(one_piece download HTTP 503\)/);

  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-retry-'));
  const r2 = await run({ video_games: base + 'video_games' }, out2);
  assert.notEqual(r2.status, 0, 'nothing could be downloaded: the run fails');
  assert.equal(hits.video_games, 1, 'a 404 is not retried');
  assert.match(r2.text, /No PriceCharting category could be downloaded \(video_games\)/);
} finally { server.close(); }
console.log('PriceCharting download retry checks passed');
