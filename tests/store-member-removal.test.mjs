import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const sql = fs.readFileSync('supabase/walkoff-auth-workspaces.sql', 'utf8');

// Owner/admin previously could only DISABLE a store member (toggle active
// false), never actually remove them from the list. The delete RLS policy
// already existed in the schema (store_members_delete_owner_admin) with
// nothing in the dashboard UI ever calling it.
assert.match(sql, /create policy store_members_delete_owner_admin on public\.store_members for delete using \(public\.can_manage_store\(store_id\)\)/,
  'delete RLS policy must exist and stay scoped to owner/admin of that store');

const fnStart = dashboard.indexOf('async function removeStoreMember(memberId)');
assert(fnStart >= 0, 'removeStoreMember() must exist');
const fnEnd = dashboard.indexOf('\n}', fnStart);
const fn = dashboard.slice(fnStart, fnEnd);

assert.match(fn, /requireOwnerAdmin\(\)/, 'removal must be gated the same way role changes and disable already are');
assert.match(fn, /confirm\(/, 'removal is permanent (unlike disable) -- must confirm before deleting');
assert.match(fn, /\.from\('store_members'\)\.delete\(\)\.eq\('id', memberId\)\.select\('id'\)/,
  'must delete the row outright (not just set active=false), and select the row back to detect a silent zero-row RLS denial');
assert.match(fn, /if\(!rows\?\.length\)/, 'a delete that matched zero rows (RLS denial or already-gone) must be treated as failure, not a silent success toast');

assert.match(dashboard, /onclick="removeStoreMember\('\$\{m\.id\}'\)"/, 'REMOVE button must be wired into the member row');

console.log('Store member removal contract checks passed');
