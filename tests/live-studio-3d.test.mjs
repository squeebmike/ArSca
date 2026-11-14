import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store, 2026-11-02: "I do want the graphics to look better. Think polished
// N64... coins. Arcade shit. Bosses look lame." -- 3D coins and bosses.
const three = fs.readFileSync('assets/vendor/three-0.160.0.module.min.js', 'utf8');
assert.match(three.slice(0, 400), /const t="160"/, 'three.js r160, bundled (no CDN during a show)');
assert.ok(fs.existsSync('assets/vendor/three-LICENSE.txt'), 'three.js MIT licence ships with it');

const src = fs.readFileSync('scripts/live-studio-3d.mjs', 'utf8');
assert.match(src, /from '\.\.\/assets\/vendor\/three-0\.160\.0\.module\.min\.js'/);
for (const id of ['scalper', 'flipper', 'dinged', 'grader', 'shipping']) assert.match(src, new RegExp('\\n  ' + id + '\\(root\\) \\{'), 'a 3D model for ' + id);
// Same boss list as the 2D sprites (the fallback) and the settings.
const { BOSS_IDS } = await import('../scripts/live-studio-bosses.mjs');
assert.deepEqual(BOSS_IDS, ['scalper', 'flipper', 'dinged', 'grader', 'shipping', 'mimic', 'golem', 'kraken', 'lich', 'raccoonking', 'lowballer', 'dragon', 'hydra']);
for (const id of BOSS_IDS) assert.match(src, new RegExp('\\n  ' + id + '\\(root\\) \\{'), 'a 3D model for ' + id);
assert.match(src, /export function createBossView\(canvas/);
assert.match(src, /export function createCoinLayer\(canvas/);
assert.doesNotMatch(src, /Math\.random/, 'coin spreads come from a fixed sequence, not chance');
// The loop stops when no coins are left (no GPU spent between sales).
assert.match(src, /if \(!coins\.length && now >= rainUntil\) \{ cancelAnimationFrame\(raf\)/);

const html = fs.readFileSync('arcade-overlay.html', 'utf8');
for (const id of ['mana-boss-sprite', 'mana-boss-3d', 'mana-effect-boss', 'mana-coins-3d', 'mana-coins']) assert.match(html, new RegExp('id="' + id + '"'));
assert.match(html, /family=Bangers&family=Luckiest\+Guy&family=Press\+Start\+2P/);
assert.match(html, /live-studio-overlay\.mjs\?v=65/);

const overlay = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8');
// Loaded on the side: if WebGL or the module fails, the flat sprites stay.
assert.match(overlay, /import\('\.\/live-studio-3d\.mjs'\)\.then\(/);
assert.match(overlay, /\}\)\.catch\(e=>console\.warn\('\[studio\] 3D off:'/);
assert.match(overlay, /document\.body\.classList\.add\('mana-3d'\)/);
assert.match(overlay, /bossView\?\.hit\(\)/, 'each sale hits the 3D boss');
assert.match(overlay, /bossView\?\.defeat\(!!b\.defeated\)/);
assert.match(overlay, /coinLayer\.burst\(/, 'each sale pops coins out of the score');
assert.match(overlay, /if\(coinLayer\)\{coinLayer\.rain\(/);

const css = fs.readFileSync('assets/live-studio.css', 'utf8');
assert.match(css, /\.mana-3d #mana-boss-sprite \{display:none\}/);
assert.match(css, /#mana-boss-3d,#mana-effect-boss,#mana-coins-3d \{display:none\}/, '3D canvases stay hidden without WebGL');
// Gradient (chrome) text can't inherit a text-shadow: it paints over the fill.
assert.match(css, /#mana-boss-name \{[^}]*text-shadow:none/);
console.log('Live Studio 3D: bundled three.js, five 3D bosses, coins, fallback and wiring passed');
