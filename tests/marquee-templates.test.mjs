// MARQUEE TEMPLATES (store, 2026-11-15: "a couple templates and being able to save them for the marquee sign in the
// Whatnot tab"): ready-made messages, and the store's own saved with the studio so every device has them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const M = await import('../scripts/live-studio-model.mjs');
const ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
assert.equal(M.DEFAULT_STUDIO.marqueeTemplates, '');
const two = JSON.stringify([{ n: 'Friday', t: 'FRIDAY NIGHT COMICS • NEW BOOKS UP' }, { n: 'Pokemon', t: 'POKEMON SINGLES ALL NIGHT' }]);
assert.equal(M.validateSettings({ marqueeTemplates: two }).marqueeTemplates, two, 'saved with the studio settings');
for (const bad of ['not json', JSON.stringify({}), JSON.stringify([{ n: '', t: 'x' }]), JSON.stringify([{ n: 'x', t: 'y'.repeat(301) }]), JSON.stringify(Array.from({ length: 13 }, (_, i) => ({ n: 'n' + i, t: 't' })))])
  assert.throws(() => M.validateSettings({ marqueeTemplates: bad }), /marqueeTemplates/);
assert.throws(() => M.validateSettings({ marqueeTemplates: JSON.stringify([{ n: 'x', t: 'MYSTERY RAFFLE TONIGHT' }]) }), /game of chance/, 'no chance words in a template either');
// The ready-made ones pass the same check; the remote has the picker, PUT ON THE SIGN, SAVE and DELETE.
const builtin = [...ctl.matchAll(/\{n:'([^']+)',t:'([^']+)'\}/g)].map(m => ({ n: m[1], t: m[2] }));
assert.ok(builtin.length >= 4); for (const t of builtin) { assert.equal(M.chanceWordIn(t.t), '', t.n); assert.ok(t.t.length <= 300); }
for (const k of ['id="mq-tpl"', 'id="mq-use"', 'id="mq-save"', 'id="mq-del"', '<input type="hidden" name="marqueeTemplates">', 'paintMarqueeTemplates();preview();', "if(mine.length>=12)throw Error('12 saved templates is the most"]) assert.ok(ctl.includes(k), k);
console.log('Marquee templates: passed');
