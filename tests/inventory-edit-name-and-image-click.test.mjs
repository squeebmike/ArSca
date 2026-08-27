import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: no way existed to fix a typo'd/wrong item name once added --
// the Edit Item modal only ever showed the name as read-only text
// (edit-item-title). Added a real editable field, populated on open, and
// wired into the save payload -- falling back to the existing name if left
// blank so clearing the field can never wipe the name out.
assert.match(dashboard, /<label>Name<\/label>\s*\n\s*<input type="text" id="edit-name" placeholder="Item name">/,
  'the Edit Item modal must have an editable Name field');
assert.match(dashboard, /document\.getElementById\('edit-name'\)\.value = item\.name \|\| '';/,
  'openEditModal must populate the new Name field from the item being edited');
assert.match(dashboard, /name: document\.getElementById\('edit-name'\)\?\.value\.trim\(\) \|\| item\.name,/,
  'confirmEditAndSync must save the edited name, falling back to the existing name if the field was left blank');

// Store report: tapping an inventory row's thumbnail opened Research (live
// pricing/comps) instead of letting the store fix the item's own details --
// the item name text next to it still opens Research; the image now opens
// the edit modal instead, matching how a photo thumbnail is expected to
// behave.
assert.match(dashboard, /const editClick = `openEditModal\('\$\{i\.id\}'\)`;/,
  'the inventory table row must build an edit-modal click handler for its thumbnail');
assert.match(dashboard, /<td class="td-thumb" onclick="\$\{editClick\}" style="cursor:pointer" title="Edit item"><img class="inv-thumb"/,
  'a thumbnail with an image must open the edit modal on click, not Research');
assert.match(dashboard, /<td class="td-thumb" onclick="\$\{editClick\}" style="cursor:pointer" title="Edit item"><div class="inv-thumb-placeholder">🔍<\/div><\/td>/,
  'a thumbnail with no image must also open the edit modal on click, not Research');
// The item name text itself must still open Research -- only the image's
// behavior changed, so a store used to clicking the name for comps isn't
// surprised.
assert.match(dashboard, /class="nc" title="[^"]*" onclick="\$\{researchClick\}"/,
  'the item name text must still open Research, unaffected by the thumbnail change');

console.log('Inventory edit-name field and image-click-opens-edit-modal contract checks passed');
