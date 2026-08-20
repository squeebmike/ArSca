import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: saving eBay listing settings (category map + description
// templates) must await the cloud write and tell the user the truth about
// whether it actually reached Supabase -- previously this fired
// saveVendorProfile() without awaiting it and always showed "saved", so a
// cloud write that silently failed (offline, RLS, non-owner/admin role)
// looked identical to a real save. Templates stayed local-only and never
// reached other devices, which is exactly the bug being fixed here. ──
assert.match(dashboard, /async function saveEbayListingSettings\(\)\{/, 'saveEbayListingSettings must be async so it can await the cloud save');
const fnSrc = dashboard.match(/async function saveEbayListingSettings\(\)\{[\s\S]*?\n\}/)[0];
assert.match(fnSrc, /const cloudSaved = await saveVendorProfile\(\{ ebayCategoryMap, ebayDescriptionTemplates, ebayDescriptionTemplate:ebayDescriptionTemplates\.default \|\| '' \}\);/, 'the eBay category map + description templates save must await saveVendorProfile and capture whether the cloud write succeeded');
assert.match(fnSrc, /toast_dash\(cloudSaved \? 'eBay listing settings saved' : 'Saved on this device only/, 'the save must be honest about a cloud-sync failure instead of always claiming success');

// ── Contract: the underlying cloud-save path this depends on ──
assert.match(dashboard, /async function saveVendorProfile\(profile\)\{/, 'saveVendorProfile must exist');
assert.match(dashboard, /const cloudSaved = await saveStoreSettingsToSupabase\(\{/, 'saveVendorProfile must itself await the Supabase write, not fire-and-forget it');
assert.match(dashboard, /return cloudSaved;/, 'saveVendorProfile must return whether the cloud write succeeded so callers can report it accurately');
assert.match(dashboard, /receipt_settings:\{[\s\S]{0,400}ebayDescriptionTemplate:next\.ebayDescriptionTemplate \|\| '',\s*ebayDescriptionTemplates:next\.ebayDescriptionTemplates \|\| \{\},/, 'the receipt_settings upsert must carry both the legacy single template and the per-category templates map, since it is a full replace not a merge');

// ── Contract: bulk eBay listing must use the seller's saved template by
// default. "Use AI descriptions" silently REPLACES fields.desc (the
// template-rendered description) with a freshly AI-written one whenever
// checked (see prepareEbayBulkReview) -- a seller who just spent time
// filling out a template and never noticed this checkbox would see AI
// copy instead and have no idea why. Default it off, and label it so the
// override is obvious rather than a surprise. ──
assert.doesNotMatch(dashboard, /<input type="checkbox" id="ebay-bulk-use-ai" checked>/, 'the bulk-listing "Use AI descriptions" checkbox must not default to checked -- it silently discards the seller\'s saved template');
assert.match(dashboard, /<input type="checkbox" id="ebay-bulk-use-ai">\s*Use AI descriptions \(overrides your saved templates\)/, 'the checkbox label must make clear that checking it overrides saved templates');

console.log('eBay template cloud sync contract checks passed');

// ── Functional: reimplement the save/report decision and confirm a failed
// cloud write is reported honestly, never silently swallowed as "saved". ──
async function saveEbayListingSettings(saveVendorProfileMock){
  const cloudSaved = await saveVendorProfileMock({ ebayCategoryMap: {}, ebayDescriptionTemplates: { default: 'My template' }, ebayDescriptionTemplate: 'My template' });
  return cloudSaved ? 'eBay listing settings saved' : 'Saved on this device only — cloud sync failed, other devices will not see this change yet';
}

{
  const message = await saveEbayListingSettings(async () => true);
  assert.equal(message, 'eBay listing settings saved', 'a successful cloud save must report success');
}
{
  const message = await saveEbayListingSettings(async () => false);
  assert.equal(message, 'Saved on this device only — cloud sync failed, other devices will not see this change yet', 'a failed cloud save must never claim the change reached other devices');
}

console.log('eBay template cloud sync functional checks passed');
