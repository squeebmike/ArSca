import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── App-wide Display Size control ─────────────────────────────────────
// Nearly every piece of UI text/spacing in this app is hardcoded inline
// px (513x font-size:9px, 476x 10px, 223x 11px, 153x 8px -- over 1,565
// tiny-text declarations total), so a per-element fix isn't practical and
// raising the root font-size does nothing (px overrides don't inherit).
// `zoom` scales the whole rendered layout -- text, images, spacing --
// uniformly via a class on <html>, without touching any inline styles.

assert.match(dashboard, /html\.ui-scale-comfortable\{zoom:1\.15;\}/, 'missing comfortable display-size zoom class');
assert.match(dashboard, /html\.ui-scale-large\{zoom:1\.3;\}/, 'missing large display-size zoom class');

assert.match(dashboard, /function getUiScale\(\)\{/, 'missing getUiScale');
assert.match(dashboard, /function applyUiScale\(scale, persist = true\)\{/, 'missing applyUiScale');
assert.match(dashboard, /localStorage\.getItem\('ui_scale_v1'\)/, 'display size must be read from localStorage, not synced to Supabase (per-device preference)');
assert.match(dashboard, /localStorage\.setItem\('ui_scale_v1', s\)/, 'display size must persist to localStorage');

// Must be applied at app boot, alongside the existing theme boot call.
assert.match(dashboard, /function setupAppShell\(\)\{\s*\n\s*applyStoreTheme\(\);\s*\n\s*applyUiScale\(getUiScale\(\), false\);/, 'applyUiScale must run at app boot in setupAppShell');

// Must expose a user-facing control in the branding/settings panel.
assert.match(dashboard, /DISPLAY SIZE/, 'missing a Display Size UI control');
assert.match(dashboard, /id="ui-scale-compact" onclick="applyUiScale\('compact'\)"/, 'missing COMPACT display-size button');
assert.match(dashboard, /id="ui-scale-comfortable" onclick="applyUiScale\('comfortable'\)"/, 'missing COMFORTABLE display-size button');
assert.match(dashboard, /id="ui-scale-large" onclick="applyUiScale\('large'\)"/, 'missing LARGE display-size button');

console.log('Display size contract checks passed');

// ── Functional check: getUiScale + applyUiScale ─────────────────────
{
  const getSrc = dashboard.match(/function getUiScale\(\)\{[\s\S]*?\n\}/)?.[0];
  const applySrc = dashboard.match(/function applyUiScale\(scale, persist = true\)\{[\s\S]*?\n\}/)?.[0];
  const classesSrc = dashboard.match(/const UI_SCALE_CLASSES = \{[^}]*\};/)?.[0];
  assert.ok(getSrc && applySrc && classesSrc, 'could not extract display-size functions for functional testing');

  class FakeClassList {
    constructor() { this.set = new Set(); }
    add(c) { this.set.add(c); }
    remove(c) { this.set.delete(c); }
    contains(c) { return this.set.has(c); }
  }
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  const root = { classList: new FakeClassList() };
  const document = { documentElement: root, getElementById: () => null };

  const { getUiScale, applyUiScale } = new Function('localStorage', 'document', `
    ${classesSrc}
    ${getSrc}
    ${applySrc}
    return { getUiScale, applyUiScale };
  `)(localStorage, document);

  assert.equal(getUiScale(), 'compact', 'default display size must be compact when nothing is saved');

  applyUiScale('large');
  assert.equal(store.ui_scale_v1, 'large', 'applyUiScale must persist the chosen scale');
  assert.ok(root.classList.contains('ui-scale-large'), 'applying large scale must add the ui-scale-large class');
  assert.equal(getUiScale(), 'large', 'getUiScale must read back the persisted scale');

  applyUiScale('compact');
  assert.ok(!root.classList.contains('ui-scale-large'), 'switching back to compact must remove the previous scale class');
  assert.ok(!root.classList.contains('ui-scale-comfortable'), 'compact must not add any scale class');

  applyUiScale('bogus');
  assert.equal(store.ui_scale_v1, 'compact', 'an unknown scale value must fall back to compact rather than corrupt state');
}

console.log('Display size functional checks passed');
