-- =============================================================================
-- Walk-Off POS — Multi-Tenant Row-Level Security Migration
-- Created : 2026-06-08
-- Branch  : pokemon-v2-core
-- Author  : Claude Sonnet / WalkOff dev
--
-- PURPOSE
-- -------
-- Ensure every Supabase table that stores business data is gated so that
-- only authenticated members of the owning store can read or write those rows.
-- Uses a SECURITY DEFINER helper (is_store_member) to avoid N+1 policy
-- subqueries and keep policies readable.
--
-- APPLY ORDER
-- -----------
-- 0.  Helper function
-- 1.  stores
-- 2.  store_members
-- 3.  store_invites
-- 4.  store_settings
-- 5.  inventory_items
-- 6.  pos_sales
-- 7.  pos_sale_lines
-- 8.  pos_payments
-- 9.  pos_drawer_sessions
-- 10. pos_drawer_movements
-- 11. pos_audit_log          (immutable — no UPDATE/DELETE policy)
-- 12. scan_queue
-- 13. customer_receipts
-- 14. customer_wants
-- 15. Walk-Off backfill SQL  (COMMENTED — read instructions, then uncomment)
-- 16. Verification query
--
-- ROLE HIERARCHY (lowest → highest)
--   viewer < employee < manager < admin < owner
--
-- BEFORE YOU RUN
-- --------------
-- 1. Run the backfill block (section 15) to stamp store_id on existing rows.
-- 2. Then run the rest of this file in the Supabase SQL editor.
-- 3. Test with a non-owner account to confirm data isolation.
-- =============================================================================

-- ── 0. Helper function: is_store_member ──────────────────────────────────────
-- Returns TRUE if auth.uid() is an active member of _store_id with at least
-- _min_role in the Walk-Off role hierarchy.
-- SECURITY DEFINER so it can read store_members without hitting RLS itself.

CREATE OR REPLACE FUNCTION public.is_store_member(
  _store_id  TEXT,
  _min_role  TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  role_order TEXT[] := ARRAY['viewer','employee','manager','admin','owner'];
  my_role    TEXT;
BEGIN
  SELECT sm.role INTO my_role
  FROM   store_members sm
  WHERE  sm.store_id = _store_id
    AND  sm.user_id  = auth.uid()
    AND  sm.active   = TRUE
  LIMIT 1;

  IF my_role IS NULL THEN RETURN FALSE; END IF;

  RETURN array_position(role_order, my_role) >=
         array_position(role_order, _min_role);
END;
$$;


-- ── 1. STORES ─────────────────────────────────────────────────────────────────
-- Members can read the stores they belong to.
-- Only admins/owners may update store profile.
-- New store creation must use the service role (handled server-side).

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_select ON stores;
DROP POLICY IF EXISTS stores_update ON stores;
DROP POLICY IF EXISTS stores_insert ON stores;

CREATE POLICY stores_select ON stores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM store_members sm
      WHERE  sm.store_id = stores.id
        AND  sm.user_id  = auth.uid()
        AND  sm.active   = TRUE
    )
  );

CREATE POLICY stores_update ON stores
  FOR UPDATE USING (is_store_member(id, 'admin'));

-- Block client-side INSERT; stores are created via service role / edge function.
CREATE POLICY stores_insert ON stores
  FOR INSERT WITH CHECK (FALSE);


-- ── 2. STORE_MEMBERS ──────────────────────────────────────────────────────────
-- Any member of a store can see the full membership list for that store.
-- Only admins can add/change members; only owners can delete/deactivate.

ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_members_select ON store_members;
DROP POLICY IF EXISTS store_members_insert ON store_members;
DROP POLICY IF EXISTS store_members_update ON store_members;
DROP POLICY IF EXISTS store_members_delete ON store_members;

CREATE POLICY store_members_select ON store_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM store_members sm2
      WHERE  sm2.store_id = store_members.store_id
        AND  sm2.user_id  = auth.uid()
        AND  sm2.active   = TRUE
    )
  );

CREATE POLICY store_members_insert ON store_members
  FOR INSERT WITH CHECK (is_store_member(store_id, 'admin'));

CREATE POLICY store_members_update ON store_members
  FOR UPDATE USING (is_store_member(store_id, 'admin'));

CREATE POLICY store_members_delete ON store_members
  FOR DELETE USING (is_store_member(store_id, 'owner'));


-- ── 3. STORE_INVITES ──────────────────────────────────────────────────────────
-- Invitees can see/accept their own pending invite.
-- Admins can manage all invites for their store.

ALTER TABLE store_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_invites_select ON store_invites;
DROP POLICY IF EXISTS store_invites_insert ON store_invites;
DROP POLICY IF EXISTS store_invites_update ON store_invites;
DROP POLICY IF EXISTS store_invites_delete ON store_invites;

CREATE POLICY store_invites_select ON store_invites
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR is_store_member(store_id, 'admin')
  );

CREATE POLICY store_invites_insert ON store_invites
  FOR INSERT WITH CHECK (is_store_member(store_id, 'admin'));

CREATE POLICY store_invites_update ON store_invites
  FOR UPDATE USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR is_store_member(store_id, 'admin')
  );

CREATE POLICY store_invites_delete ON store_invites
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 4. STORE_SETTINGS ─────────────────────────────────────────────────────────

ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_settings_select ON store_settings;
DROP POLICY IF EXISTS store_settings_insert ON store_settings;
DROP POLICY IF EXISTS store_settings_update ON store_settings;
DROP POLICY IF EXISTS store_settings_delete ON store_settings;

CREATE POLICY store_settings_select ON store_settings
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY store_settings_insert ON store_settings
  FOR INSERT WITH CHECK (is_store_member(store_id, 'manager'));

CREATE POLICY store_settings_update ON store_settings
  FOR UPDATE USING (is_store_member(store_id, 'manager'));

CREATE POLICY store_settings_delete ON store_settings
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 5. INVENTORY_ITEMS ────────────────────────────────────────────────────────
-- Columns used by app: id, data (jsonb), status, store_id, updated_at

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_items_select ON inventory_items;
DROP POLICY IF EXISTS inventory_items_insert ON inventory_items;
DROP POLICY IF EXISTS inventory_items_update ON inventory_items;
DROP POLICY IF EXISTS inventory_items_delete ON inventory_items;

CREATE POLICY inventory_items_select ON inventory_items
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY inventory_items_insert ON inventory_items
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY inventory_items_update ON inventory_items
  FOR UPDATE USING (is_store_member(store_id, 'employee'));

CREATE POLICY inventory_items_delete ON inventory_items
  FOR DELETE USING (is_store_member(store_id, 'manager'));


-- ── 6. POS_SALES ──────────────────────────────────────────────────────────────

ALTER TABLE pos_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sales_select ON pos_sales;
DROP POLICY IF EXISTS pos_sales_insert ON pos_sales;
DROP POLICY IF EXISTS pos_sales_update ON pos_sales;
DROP POLICY IF EXISTS pos_sales_delete ON pos_sales;

CREATE POLICY pos_sales_select ON pos_sales
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY pos_sales_insert ON pos_sales
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY pos_sales_update ON pos_sales
  FOR UPDATE USING (is_store_member(store_id, 'manager'));

CREATE POLICY pos_sales_delete ON pos_sales
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 7. POS_SALE_LINES ─────────────────────────────────────────────────────────

ALTER TABLE pos_sale_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_sale_lines_select ON pos_sale_lines;
DROP POLICY IF EXISTS pos_sale_lines_insert ON pos_sale_lines;
DROP POLICY IF EXISTS pos_sale_lines_update ON pos_sale_lines;
DROP POLICY IF EXISTS pos_sale_lines_delete ON pos_sale_lines;

CREATE POLICY pos_sale_lines_select ON pos_sale_lines
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY pos_sale_lines_insert ON pos_sale_lines
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY pos_sale_lines_update ON pos_sale_lines
  FOR UPDATE USING (is_store_member(store_id, 'manager'));

CREATE POLICY pos_sale_lines_delete ON pos_sale_lines
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 8. POS_PAYMENTS ───────────────────────────────────────────────────────────

ALTER TABLE pos_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_payments_select ON pos_payments;
DROP POLICY IF EXISTS pos_payments_insert ON pos_payments;
DROP POLICY IF EXISTS pos_payments_update ON pos_payments;
DROP POLICY IF EXISTS pos_payments_delete ON pos_payments;

CREATE POLICY pos_payments_select ON pos_payments
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY pos_payments_insert ON pos_payments
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY pos_payments_update ON pos_payments
  FOR UPDATE USING (is_store_member(store_id, 'manager'));

CREATE POLICY pos_payments_delete ON pos_payments
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 9. POS_DRAWER_SESSIONS ────────────────────────────────────────────────────
-- Columns: id, store_id, register_name, show_session_id, status,
--          starting_cash, expected_cash, counted_cash, over_short,
--          opened_by, closed_by, opened_at, closed_at

ALTER TABLE pos_drawer_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_drawer_sessions_select ON pos_drawer_sessions;
DROP POLICY IF EXISTS pos_drawer_sessions_insert ON pos_drawer_sessions;
DROP POLICY IF EXISTS pos_drawer_sessions_update ON pos_drawer_sessions;
DROP POLICY IF EXISTS pos_drawer_sessions_delete ON pos_drawer_sessions;

CREATE POLICY pos_drawer_sessions_select ON pos_drawer_sessions
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY pos_drawer_sessions_insert ON pos_drawer_sessions
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY pos_drawer_sessions_update ON pos_drawer_sessions
  FOR UPDATE USING (is_store_member(store_id, 'employee'));

CREATE POLICY pos_drawer_sessions_delete ON pos_drawer_sessions
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 10. POS_DRAWER_MOVEMENTS ──────────────────────────────────────────────────
-- Columns: id, store_id, drawer_session_id, amount, movement_type,
--          note, created_by, created_at

ALTER TABLE pos_drawer_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_drawer_movements_select ON pos_drawer_movements;
DROP POLICY IF EXISTS pos_drawer_movements_insert ON pos_drawer_movements;
DROP POLICY IF EXISTS pos_drawer_movements_update ON pos_drawer_movements;
DROP POLICY IF EXISTS pos_drawer_movements_delete ON pos_drawer_movements;

CREATE POLICY pos_drawer_movements_select ON pos_drawer_movements
  FOR SELECT USING (is_store_member(store_id, 'viewer'));

CREATE POLICY pos_drawer_movements_insert ON pos_drawer_movements
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY pos_drawer_movements_update ON pos_drawer_movements
  FOR UPDATE USING (is_store_member(store_id, 'manager'));

CREATE POLICY pos_drawer_movements_delete ON pos_drawer_movements
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 11. POS_AUDIT_LOG ─────────────────────────────────────────────────────────
-- Columns: id, store_id, event_type, entity_type, entity_id,
--          details (jsonb), created_by, created_at
-- INTENTIONALLY IMMUTABLE: no UPDATE or DELETE policies.
-- Use service role for corrections or data migrations only.

ALTER TABLE pos_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_audit_log_select ON pos_audit_log;
DROP POLICY IF EXISTS pos_audit_log_insert ON pos_audit_log;

CREATE POLICY pos_audit_log_select ON pos_audit_log
  FOR SELECT USING (is_store_member(store_id, 'manager'));

CREATE POLICY pos_audit_log_insert ON pos_audit_log
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

-- No UPDATE / DELETE — audit rows are permanent records.


-- ── 12. SCAN_QUEUE ────────────────────────────────────────────────────────────
-- Columns: id, store_id, payload (jsonb), status, created_at

ALTER TABLE scan_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scan_queue_select ON scan_queue;
DROP POLICY IF EXISTS scan_queue_insert ON scan_queue;
DROP POLICY IF EXISTS scan_queue_update ON scan_queue;
DROP POLICY IF EXISTS scan_queue_delete ON scan_queue;

CREATE POLICY scan_queue_select ON scan_queue
  FOR SELECT USING (is_store_member(store_id, 'employee'));

CREATE POLICY scan_queue_insert ON scan_queue
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY scan_queue_update ON scan_queue
  FOR UPDATE USING (is_store_member(store_id, 'employee'));

CREATE POLICY scan_queue_delete ON scan_queue
  FOR DELETE USING (is_store_member(store_id, 'employee'));


-- ── 13. CUSTOMER_RECEIPTS ─────────────────────────────────────────────────────
-- Columns: id, store_id, sale_id, phone, sms_status, created_at

ALTER TABLE customer_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_receipts_select ON customer_receipts;
DROP POLICY IF EXISTS customer_receipts_insert ON customer_receipts;
DROP POLICY IF EXISTS customer_receipts_update ON customer_receipts;
DROP POLICY IF EXISTS customer_receipts_delete ON customer_receipts;

CREATE POLICY customer_receipts_select ON customer_receipts
  FOR SELECT USING (is_store_member(store_id, 'employee'));

CREATE POLICY customer_receipts_insert ON customer_receipts
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY customer_receipts_update ON customer_receipts
  FOR UPDATE USING (is_store_member(store_id, 'manager'));

CREATE POLICY customer_receipts_delete ON customer_receipts
  FOR DELETE USING (is_store_member(store_id, 'admin'));


-- ── 14. CUSTOMER_WANTS ────────────────────────────────────────────────────────
-- Columns: id, store_id, sale_id, phone, customer_name, want_text,
--          categories, marketing_opt_in, created_at

ALTER TABLE customer_wants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_wants_select ON customer_wants;
DROP POLICY IF EXISTS customer_wants_insert ON customer_wants;
DROP POLICY IF EXISTS customer_wants_update ON customer_wants;
DROP POLICY IF EXISTS customer_wants_delete ON customer_wants;

CREATE POLICY customer_wants_select ON customer_wants
  FOR SELECT USING (is_store_member(store_id, 'employee'));

CREATE POLICY customer_wants_insert ON customer_wants
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));

CREATE POLICY customer_wants_update ON customer_wants
  FOR UPDATE USING (is_store_member(store_id, 'employee'));

CREATE POLICY customer_wants_delete ON customer_wants
  FOR DELETE USING (is_store_member(store_id, 'manager'));


-- =============================================================================
-- ── 15. WALK-OFF BACKFILL  (UNCOMMENT AND RUN FIRST if you have existing data)
-- =============================================================================
-- Before enabling RLS, existing rows that have NULL store_id will become
-- invisible (the policy will reject them).  Run this block in the Supabase
-- SQL editor BEFORE the rest of the file.
--
-- Step 1: Find your Walk-Off store UUID.
-- Step 2: Replace 'YOUR_WALKOFF_STORE_ID' everywhere below with that UUID.
-- Step 3: Uncomment the UPDATE statements and run them.
-- Step 4: Re-run this file from section 0 to enable RLS + policies.
-- =============================================================================

/*

-- Step 1 — Find Walk-Off store UUID:
SELECT id, name, display_name FROM stores
WHERE  name       ILIKE '%walk%off%'
   OR  display_name ILIKE '%walk%off%';

-- Step 2 — Backfill (replace placeholder with real UUID from Step 1):
DO $$
DECLARE
  wid TEXT := 'YOUR_WALKOFF_STORE_ID';  -- ← paste UUID here
BEGIN
  UPDATE inventory_items     SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE pos_sales            SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE pos_sale_lines       SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE pos_payments         SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE pos_drawer_sessions  SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE pos_drawer_movements SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE pos_audit_log        SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE scan_queue           SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE customer_receipts    SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE customer_wants       SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  UPDATE store_settings       SET store_id = wid WHERE store_id IS NULL OR store_id = '';
  RAISE NOTICE 'Backfill complete for store_id = %', wid;
END $$;

*/


-- =============================================================================
-- ── 16. VERIFICATION QUERY (run after applying RLS to confirm all tables)
-- =============================================================================

/*

SELECT
  t.tablename,
  t.rowsecurity            AS rls_enabled,
  COUNT(p.policyname)      AS policy_count
FROM pg_tables  t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'stores', 'store_members', 'store_invites', 'store_settings',
    'inventory_items',
    'pos_sales', 'pos_sale_lines', 'pos_payments',
    'pos_drawer_sessions', 'pos_drawer_movements', 'pos_audit_log',
    'scan_queue', 'customer_receipts', 'customer_wants'
  )
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;

-- Expected: rowsecurity = TRUE for all rows; policy_count >= 2 for all.
-- pos_audit_log should have policy_count = 2 (select + insert only — immutable).

*/
