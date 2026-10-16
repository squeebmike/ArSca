import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Store ask: "make it store wide" -- the price mover / low stock alert
// thresholds are saved in the store's vendor config (store_settings.modules)
// like the category price rules, not per device.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = name => { const s = dashboard.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

const store = {};
const saved = [];
const localStorage = { getItem:k => (k in store ? store[k] : null), setItem:(k, v) => { store[k] = String(v); } };
const ctx = vm.createContext({ localStorage, saved,
  getVendorConfig:() => JSON.parse(store.vendor_config_v1 || '{}'),
  saveVendorConfig:cfg => { saved.push(JSON.parse(JSON.stringify(cfg))); store.vendor_config_v1 = JSON.stringify(cfg); } });
vm.runInContext([extractFn('getAlertSettings'), extractFn('saveAlertSettings'), 'this.api = { getAlertSettings, saveAlertSettings };'].join('\n'), ctx);
const get = () => JSON.parse(JSON.stringify(ctx.api.getAlertSettings()));

assert.deepEqual(get(), { lowStockQty:1, lowStockMinValue:20, priceMoveThresholdPct:20, priceMoveThresholdDollar:25 }, 'defaults');
store.alert_settings_v1 = JSON.stringify({ lowStockQty:3, priceMoveThresholdPct:15 });
assert.equal(get().priceMoveThresholdPct, 15, 'an older per-device value is the fallback');
store.vendor_config_v1 = JSON.stringify({ alertSettings:{ priceMoveThresholdPct:10 } });
assert.equal(get().priceMoveThresholdPct, 10, 'the store-wide value wins over the device');
assert.equal(get().lowStockQty, 3, 'keys the store has not set still fall back');
ctx.api.saveAlertSettings({ priceMoveThresholdDollar:9999 });
assert.equal(saved.length, 1, 'saves through the vendor config (synced to store_settings)');
assert.deepEqual(saved[0].alertSettings, { lowStockQty:3, lowStockMinValue:20, priceMoveThresholdPct:10, priceMoveThresholdDollar:9999 });
assert.doesNotMatch(extractFn('saveAlertSettings'), /alert_settings_v1/, 'no longer saved only on this device');

// getVendorConfig must keep alertSettings or it is dropped on every save.
assert.match(extractFn('getVendorConfig'), /alertSettings: \{ \.\.\.\(saved\.alertSettings \|\| \{\}\) \},/);
assert.match(dashboard, /Alert thresholds are saved for the whole store, so every device uses them\./);

console.log('Store-wide alert settings checks passed');
