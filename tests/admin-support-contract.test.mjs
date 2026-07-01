import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/platform-admin-support.sql', import.meta.url), 'utf8');
const authSafetySql = readFileSync(new URL('../supabase/auth-user-delete-safety.sql', import.meta.url), 'utf8');

assert.match(admin, /Owner Support Console/);
assert.match(admin, /Enable edit mode/);
assert.match(admin, /Required support reason/);
assert.doesNotMatch(admin, /sb_secret_|service_role/i, 'admin browser must not contain a service credential');
const scripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean);
for (const script of scripts) new Function(script);
assert.match(worker, /requirePlatformAdmin/);
assert.match(worker, /return await handlePlatformAdmin/);
assert.match(worker, /\/auth\/v1\/user/);
assert.match(worker, /writePlatformAudit/);
assert.match(worker, /Authorization, x-store-id/);
assert.match(worker, /expected_updated_at/);
assert.match(sql, /platform_admins/);
assert.match(sql, /platform_admin_audit_log/);
assert.match(sql, /revoke all .* authenticated/i);
assert.match(authSafetySql, /on delete set null/i);
assert.match(authSafetySql, /auth\.jwt\(\) ->> 'email'/);
assert.doesNotMatch(authSafetySql, /on delete cascade/i);
console.log('Owner support console contract checks passed.');
