// The 3D props, Duke Nukem style (2026-11-12): models photographed from 8 angles,
// drawn as sprites in the crawl; flat sprites when there's no WebGL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../scripts/prop-models.mjs', import.meta.url), 'utf8');
const fp = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
const bg = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
assert.ok(!/Math\.random/.test(src), 'no chance in the models');
const pm = await import('../scripts/prop-models.mjs');
for (const k of ['chest', 'chestopen', 'rat', 'bat', 'spider', 'longbox', 'longboxopen', 'longboxstack', 'shortbox', 'crate', 'coffin', 'bones', 'brazier']) assert.ok(pm.MODEL_KINDS.includes(k), 'model: ' + k);
assert.equal(pm.bakeProps(), null, 'no WebGL (node): flat sprites stay');
const fpm = await import('../scripts/shed-crawl-fp.mjs');
assert.match(fp, /setModels\(m\)/);
for (const k of ['longbox', 'longboxopen', 'longboxstack', 'shortbox', 'crate']) assert.ok(new RegExp(k + ": '").test(fp), 'flat fallback: ' + k);
const kinds = new Set();
for (let f = 1; f <= 12; f++) fpm.propsFor(fpm.layoutFor(f), f).forEach(p => { kinds.add(p.kind); assert.ok(p.face === undefined || Number.isFinite(p.face), 'faces a way'); });
for (const k of ['longbox', 'longboxopen', 'longboxstack']) assert.ok(kinds.has(k), 'long boxes in the dungeon: ' + k);
assert.ok(fpm.ROOM_THEMES.some(t => t.name === 'THE FORGOTTEN STOCK'), 'new dungeon room');
assert.match(ov, /import\('\.\/prop-models\.mjs\?v=1'\)/);
assert.match(bg, /import\('\.\/prop-models\.mjs\?v=1'\)/);
assert.match(ov, /fp\.setModels\(baked\)/);
assert.match(bg, /fp\.setModels\(baked\)/);
console.log('prop-models: 3D props, long box variety, flat fallback and wiring passed');
// 2026-11-12: "props in front seem to move with the camera, they should not move".
assert.match(fp, /view\(\) \{ return \{ look, pitch: pitchNow, scout: scoutNow, fov: FOV \}; \}/);
assert.match(ov, /x=\(side<0\?-1:1\)\*\(phase\*190-60\)\+fgCam\.x/);
assert.match(ov, /if\(!p\|\|fgCam\.hide\)/);
// "When I demo a sale it goes ahead, then comes back": the 8-second refresh no longer undoes the demo.
const ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
assert.match(ctl, /stats:demoStats\|\|\(Date\.now\(\)<demoUntil\?demoFake:null\)\|\|stats/);
assert.match(ctl, /demoFake=fake;demoUntil=Date\.now\(\)\+120000;/);
console.log('prop-models: props in front stay put, demo holds passed');
