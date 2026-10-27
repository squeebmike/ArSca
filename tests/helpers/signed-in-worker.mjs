// Paid price lookups answer only signed-in store staff (scripts/lookup-auth.mjs).
// Tests that call those Worker routes sign in with these: the headers to send,
// the Supabase settings the login check needs, and a fetch wrapper that
// answers that check (any token is a store owner) and passes the rest on.
export const STAFF_STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
export const staffHeaders = (extra = {}) => ({ Authorization: 'Bearer staff-test', 'X-Store-Id': STAFF_STORE, ...extra });
export const withSupabase = (env = {}) => ({ SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ...env });
export function answeringStaffLogin(fetchImpl) {
  return async (input, init) => {
    const url = String(input?.url || input);
    const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://database.example/auth/v1/user')) return ok({ id: 'staff-1', email: 'staff@example.com' });
    if (url.startsWith('https://database.example/rest/v1/store_members')) return ok([{ role: 'owner' }]);
    return fetchImpl(input, init);
  };
}
