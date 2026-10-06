// The dashboard's app code lives in scripts/dashboard-app.js (moved out of
// dashboard.html so phones can keep a compiled copy between visits), loaded
// by one <script src> tag at the exact spot it used to sit inline.
//
// Hundreds of tests check the dashboard's code by reading dashboard.html.
// This preload (wired up in .npmrc as node-options, so every `npm test`
// script gets it) makes any read of dashboard.html return the page with the
// app code back inline in place of that tag -- byte-for-byte the page as it
// was before the move -- so those tests keep checking the real code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlPath = path.join(root, 'dashboard.html');
const appPath = path.join(root, 'scripts', 'dashboard-app.js');
const TAG = /<script src="scripts\/dashboard-app\.js\?v=[^"]*"><\/script>/;

const original = fs.readFileSync;
const originalPromise = fs.promises.readFile;
const isDashboard = file => {
  try {
    const p = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? file : '';
    return !!p && path.resolve(p) === htmlPath;
  } catch (e) { return false; }
};
export function inlinedDashboard(html, app) {
  return String(html).replace(TAG, () => '<script>' + app + '</script>');
}
const build = () => inlinedDashboard(original.call(fs, htmlPath, 'utf8'), original.call(fs, appPath, 'utf8'));

fs.readFileSync = function(file, options) {
  if (!isDashboard(file)) return original.apply(this, arguments);
  const text = build();
  const enc = typeof options === 'string' ? options : options?.encoding;
  return enc ? text : Buffer.from(text, 'utf8');
};
fs.promises.readFile = async function(file, options) {
  if (!isDashboard(file)) return originalPromise.apply(this, arguments);
  const text = build();
  const enc = typeof options === 'string' ? options : options?.encoding;
  return enc ? text : Buffer.from(text, 'utf8');
};
syncBuiltinESMExports();
