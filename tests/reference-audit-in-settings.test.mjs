import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store (2026-10-25): "I can't close this tab? For the card reference audit.
// It goes across all tabs?" -- it floated over every tab with no close.
// It now sits in SETTINGS / ADMIN only.
const src = readFileSync(new URL('../scripts/reference-audit-dashboard.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
assert.ok(src.includes("const home=document.getElementById('tab-backoffice');"), 'placed in the Settings tab');
assert.ok(src.includes("home.insertBefore(panel,document.getElementById('backoffice-panels'))"), 'above the settings panels');
assert.ok(!/panel\.style\.cssText='position:fixed/.test(src), 'no longer floats over every tab');
assert.ok(html.includes('id="tab-backoffice"') && html.includes('id="backoffice-panels"'), 'Settings tab markup it relies on');
console.log('reference audit panel lives in Settings');
