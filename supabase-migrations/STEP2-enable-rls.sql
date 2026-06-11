-- =============================================================================
-- STEP 2 OF 2 — Run this AFTER STEP1-backfill.sql
-- =============================================================================
-- Turns on Row-Level Security for all 14 business tables and creates
-- the policies that lock each table to only the store it belongs to.
--
-- Safe to re-run — all DROP POLICY IF EXISTS lines clean up before recreating.
-- =============================================================================


-- ── 0. Helper function ────────────────────────────────────────────────────────
-- Checks if the logged-in user is a member of a given store with a
-- minimum role.  Role levels: viewer < employee < manager < admin < owner

-- Drop old TEXT version if it exists, then create UUID version
DROP FUNCTION IF EXISTS public.is_store_member(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.is_store_member(
  _store_id  UUID,
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

CREATE POLICY stores_insert ON stores
  FOR INSERT WITH CHECK (FALSE);  -- stores created via service role only


-- ── 2. STORE_MEMBERS ──────────────────────────────────────────────────────────

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
-- Immutable — no UPDATE or DELETE allowed, even by admins.

ALTER TABLE pos_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_audit_log_select ON pos_audit_log;
DROP POLICY IF EXISTS pos_audit_log_insert ON pos_audit_log;

CREATE POLICY pos_audit_log_select ON pos_audit_log
  FOR SELECT USING (is_store_member(store_id, 'manager'));

CREATE POLICY pos_audit_log_insert ON pos_audit_log
  FOR INSERT WITH CHECK (is_store_member(store_id, 'employee'));


-- ── 12. SCAN_QUEUE ────────────────────────────────────────────────────────────

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


-- ── Done. Run this to verify everything is on: ────────────────────────────────

SELECT
  t.tablename,
  t.rowsecurity          AS rls_enabled,
  COUNT(p.policyname)    AS policy_count
FROM pg_tables t
LEFT JOIN pg_policies p
  ON  p.tablename  = t.tablename
  AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'stores','store_members','store_invites','store_settings',
    'inventory_items',
    'pos_sales','pos_sale_lines','pos_payments',
    'pos_drawer_sessions','pos_drawer_movements','pos_audit_log',
    'scan_queue','customer_receipts','customer_wants'
  )
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;

-- All rows should show rls_enabled = true and policy_count >= 2.
