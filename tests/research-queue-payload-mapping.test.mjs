import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: Research Queue showed 51 items all labeled generic
// "Research item" with a "SCAN" placeholder box instead of a photo, even
// though they were real eBay comp candidates from Pocket Scout scan
// sessions. Root cause: the worker persists each candidate's payload with
// `title` and `image` fields (see cloudflare-worker-full.js, the
// scan_queue insert in the pocket-scout photo route), but the drawer's
// renderer and getScanImageUrl() never checked those exact field names --
// only name/queryUsed/rawExtractedText for the title, and a list of image
// aliases that didn't include `image`. Real data was sitting right there
// in the payload; the reader just wasn't looking for it.

const dashboardSrc = fs.readFileSync('dashboard.html', 'utf8');

const rendererMatch = dashboardSrc.match(/async function renderResearchQueue\(\)\{[\s\S]*?\n\}\n/);
assert.ok(rendererMatch, 'expected to find renderResearchQueue()');
const titleLineMatch = rendererMatch[0].match(/const title = ([^;]+);/);
assert.ok(titleLineMatch, 'expected to find the research-queue-list title fallback chain inside renderResearchQueue()');
assert.match(
  titleLineMatch[1],
  /s\.title/,
  'Research Queue title fallback must check s.title -- that is the field Pocket Scout actually writes for each eBay comp candidate (cloudflare-worker-full.js scan_queue insert), so without it every real candidate falls back to the generic "Research item" label'
);

const getScanImageUrlMatch = dashboardSrc.match(/function getScanImageUrl\(scan\)\{\s*return ([^;]+);\s*\}/);
assert.ok(getScanImageUrlMatch, 'expected to find getScanImageUrl()');
assert.match(
  getScanImageUrlMatch[1],
  /scan\?\.image\b(?!Url|_url)/,
  'getScanImageUrl must check scan.image -- that is the exact field name Pocket Scout writes (payload.image = l.imageUrl), so without this alias every real candidate photo is silently dropped in favor of the SCAN placeholder box'
);

console.log('Research Queue payload mapping checks passed');
