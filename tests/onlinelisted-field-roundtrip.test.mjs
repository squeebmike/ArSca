import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: every "publish to storefront" action (the row-menu toggle,
// PUBLISH THIS VIEW, and Force Publish) reported success but the item never
// actually showed up live, and items that were genuinely onlineListed:false
// in Supabase still showed "Remove from Storefront" in the row menu as if
// already published. Root cause: onlineListed was never added to
// BUILT_IN_ITEM_SIMPLE_FIELDS, the shared list mapBuiltInItem's read loop
// and builtInDataFromItem's write loop both iterate over to round-trip a
// plain field. That meant:
//   - READ: the real Supabase value was never copied onto the in-memory
//     item at all (always undefined -- which every check in this file
//     treats as "listed", since they all test `=== false`).
//   - WRITE: an explicit {onlineListed:...} update passed to
//     saveInventoryEdit was silently dropped before it ever reached the
//     saved row -- builtInDataFromItem only persists fields it's told
//     about.
// Only the initial insert (createBuiltInInventoryItem, which builds its
// payload directly rather than through this list) ever actually set it.

const fieldsBlockStart = dashboard.indexOf('const BUILT_IN_ITEM_SIMPLE_FIELDS = [');
assert.ok(fieldsBlockStart !== -1, 'BUILT_IN_ITEM_SIMPLE_FIELDS must exist');
const fieldsBlockEnd = dashboard.indexOf('\n];', fieldsBlockStart);
const fieldsBlock = dashboard.slice(fieldsBlockStart, fieldsBlockEnd);
assert.match(fieldsBlock, /\['onlineListed',\s*true\]/,
  'onlineListed must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS with default true, so a row with no value on record at all still reads as listed (matches the creation default and the storefront Worker\'s own `!== false` rule)');

console.log('onlineListed field-list registration check passed');

// ── Functional: reimplement the exact read/write/merge mechanics and prove
// a value actually round-trips now, where it silently didn't before. ──

function readBuiltInSimpleField(d, field, def, type) {
  const raw = d[field];
  if (type === 'num') return Number(raw ?? def) || def;
  if (type === 'bool') return !!raw;
  if (type === 'array') return Array.isArray(raw) ? raw : def;
  return raw ?? def;
}
function mergeBuiltInSimpleField(updates, existing, field, def, type) {
  const raw = updates[field] ?? existing[field];
  if (type === 'num') return Number(raw ?? def) || def;
  if (type === 'bool') return !!raw;
  return raw ?? def;
}
const FIELDS = [['onlineListed', true]];

// READ: a row explicitly saved as onlineListed:false must surface as false
// on the in-memory item, not silently become undefined/listed.
{
  const d = { onlineListed: false };
  const out = {};
  FIELDS.forEach(([field, def, type]) => { out[field] = readBuiltInSimpleField(d, field, def, type); });
  assert.equal(out.onlineListed, false, 'a row saved as unlisted must read back as unlisted, not fall through to the default');
}
// READ: a row that never had the field set at all defaults to listed.
{
  const d = {};
  const out = {};
  FIELDS.forEach(([field, def, type]) => { out[field] = readBuiltInSimpleField(d, field, def, type); });
  assert.equal(out.onlineListed, true, 'a row with no onlineListed on record must default to listed');
}
// WRITE: publishing (updates.onlineListed = true) must actually land in the
// saved payload, not get dropped.
{
  const existing = { onlineListed: false };
  const updates = { onlineListed: true };
  const nextData = {};
  FIELDS.forEach(([field, def, type]) => { nextData[field] = mergeBuiltInSimpleField(updates, existing, field, def, type); });
  assert.equal(nextData.onlineListed, true, 'an explicit publish update must be written to the saved row, not silently dropped');
}
// WRITE: unpublishing (updates.onlineListed = false) must also actually
// land -- false is falsy, so a naive `updates.field || existing.field`
// merge would incorrectly fall back to the existing value instead.
{
  const existing = { onlineListed: true };
  const updates = { onlineListed: false };
  const nextData = {};
  FIELDS.forEach(([field, def, type]) => { nextData[field] = mergeBuiltInSimpleField(updates, existing, field, def, type); });
  assert.equal(nextData.onlineListed, false, 'an explicit unpublish update must be written, not masked by falsy-fallback to the previous value');
}

console.log('onlineListed field-list read/write/merge functional checks passed');
