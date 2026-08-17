import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the worker's /identify/card prompt reads grading labels ──
assert.match(worker, /"gradingCompany":"","grade":"","certNumber":""/, 'the identify JSON schema must carry gradingCompany/grade/certNumber fields');
assert.match(worker, /which may be raw or sealed in a graded slab \(PSA\/BGS\/CGC\/SGC\)/, 'the prompt must put graded slabs in scope, not exclude them');
assert.match(worker, /certNumber is the cert\/serial number printed on the label as plain digits/, 'the prompt must tell the model to read the cert number as text, not decode a barcode graphic');
assert.match(worker, /gradingCompany: String\(c\.gradingCompany \|\| ''\)\.trim\(\)\.slice\(0, 10\)/, 'gradingCompany must be threaded through the response mapping');
assert.match(worker, /certNumber: String\(c\.certNumber \|\| ''\)\.replace\(\/\\D\/g, ''\)\.slice\(0, 20\)/, 'certNumber must be digit-only sanitized before being trusted as a PSA cert lookup key');

console.log('Own AI graded-slab (worker) contract checks passed');

// ── Contract: doCardSightScan skips the barcode-first check for Graded Slab, going straight to own AI ──
const scanFnSrc = dashboard.match(/async function doCardSightScan\(\)\{[\s\S]*?\n\}\n/)[0];
const gradedBranchIdx = scanFnSrc.indexOf("categoryHint === 'graded'");
const barcodeCheckIdx = scanFnSrc.indexOf('detectCardsightBarcode()');
assert.ok(gradedBranchIdx >= 0, 'doCardSightScan must branch on the graded category');
assert.ok(barcodeCheckIdx >= 0, 'doCardSightScan must still check for a barcode for every other category');
assert.ok(gradedBranchIdx < barcodeCheckIdx, 'the graded-slab branch must run BEFORE the barcode-first check is reached, not after it fails to find one');
assert.match(scanFnSrc, /await runOwnGradedIdentifyScan\(captureCardSightFrame\(\)\)/, 'selecting Graded Slab must call the graded-slab identify path with a fresh captured frame');

console.log('Own AI graded-slab (scan routing) contract checks passed');

// ── Contract: runOwnGradedIdentifyScan resolves a legible cert through the real PSA API, falls back otherwise ──
const gradedFnSrc = dashboard.match(/async function runOwnGradedIdentifyScan\(img\)\{[\s\S]*?\n\}\n/)[0];
assert.match(gradedFnSrc, /if\(card\.certNumber && \/\^\\d\{6,10\}\$\/\.test\(card\.certNumber\)\)/, 'a certNumber must be validated as plausible digits before trusting it as a real cert lookup key');
assert.match(gradedFnSrc, /row = await resolvePsaCertRow\(card\.certNumber\)/, 'a legible cert number must be resolved through the real PSA cert API, not just trusted from the model');
assert.match(gradedFnSrc, /if\(!row\) row = await resolveOwnCardIdentifyCard\(card\)/, 'no legible cert (or a non-PSA slab) must still fall back to a real catalog match instead of failing the scan');
assert.match(gradedFnSrc, /not PSA-verified/, 'an AI-read grade that was not confirmed against the real PSA database must be labeled as unverified');

console.log('Own AI graded-slab (resolution logic) contract checks passed');

// ── Functional: the cert-number plausibility check accepts real-shaped cert numbers and rejects junk ──
function looksLikePlausibleCert(certNumber){
  return !!(certNumber && /^\d{6,10}$/.test(certNumber));
}
assert.equal(looksLikePlausibleCert('82736451'), true, 'an 8-digit PSA-shaped cert number must be accepted');
assert.equal(looksLikePlausibleCert(''), false, 'a blank certNumber (raw card, or illegible label) must not trigger a PSA lookup');
assert.equal(looksLikePlausibleCert('12'), false, 'a too-short digit string must not be trusted as a real cert number');
assert.equal(looksLikePlausibleCert('12345678901234'), false, 'an implausibly long digit string must not be trusted as a real cert number');

console.log('Own AI graded-slab cert-plausibility functional checks passed');

// ── Functional: the worker's certNumber sanitizer strips everything but digits, matching what the PSA cert API expects ──
function sanitizeCertNumber(raw){
  return String(raw || '').replace(/\D/g, '').slice(0, 20);
}
assert.equal(sanitizeCertNumber('8273-6451'), '82736451', 'punctuation in a misread label must be stripped before it reaches the PSA cert API');
assert.equal(sanitizeCertNumber('cert #82736451'), '82736451', 'stray letters from a misread label must be stripped too');
assert.equal(sanitizeCertNumber(''), '', 'a blank input must sanitize to a blank string, never throw');

console.log('Own AI graded-slab cert-sanitizer functional checks passed');
