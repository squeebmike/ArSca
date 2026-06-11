-- =============================================================================
-- STEP 1 OF 2 — Run this FIRST in the Supabase SQL Editor
-- =============================================================================
-- This stamps store_id on any existing rows that are missing it.
-- Without this, those rows become invisible the moment RLS turns on.
--
-- HOW TO USE:
--   1. Paste this whole file into the Supabase SQL Editor and click RUN.
--   2. Look at the results of the SELECT at the top — it shows your store UUID.
--   3. Copy that UUID.
--   4. Replace YOUR_WALKOFF_STORE_ID below with the real UUID.
--   5. Click RUN again.
--   6. You should see: NOTICE: Backfill complete for store_id = <your uuid>
--   7. Then run STEP2-enable-rls.sql
-- =============================================================================


-- ── Step A: Find your Walk-Off store UUID ─────────────────────────────────────
-- Run this first to see what UUID to use.

SELECT id, name, display_name
FROM   stores
WHERE  name        ILIKE '%walk%off%'
   OR  display_name ILIKE '%walk%off%'
   OR  name        ILIKE '%walkoff%'
   OR  display_name ILIKE '%walkoff%';


-- ── Step B: Paste your UUID below, then run the whole file again ──────────────
-- Replace  YOUR_WALKOFF_STORE_ID  with the id you got from Step A above.
-- Example: wid TEXT := 'abc123de-0000-0000-0000-000000000000';

DO $$
DECLARE
  wid UUID := 'YOUR_WALKOFF_STORE_ID';   -- ← PASTE YOUR UUID HERE (keep the quotes)
BEGIN
  IF wid::TEXT = 'YOUR_WALKOFF_STORE_ID' THEN
    RAISE EXCEPTION 'You must replace YOUR_WALKOFF_STORE_ID with your real store UUID before running Step B.';
  END IF;

  UPDATE inventory_items     SET store_id = wid WHERE store_id IS NULL;
  UPDATE pos_sales            SET store_id = wid WHERE store_id IS NULL;
  UPDATE pos_sale_lines       SET store_id = wid WHERE store_id IS NULL;
  UPDATE pos_payments         SET store_id = wid WHERE store_id IS NULL;
  UPDATE pos_drawer_sessions  SET store_id = wid WHERE store_id IS NULL;
  UPDATE pos_drawer_movements SET store_id = wid WHERE store_id IS NULL;
  UPDATE pos_audit_log        SET store_id = wid WHERE store_id IS NULL;
  UPDATE scan_queue           SET store_id = wid WHERE store_id IS NULL;
  UPDATE customer_receipts    SET store_id = wid WHERE store_id IS NULL;
  UPDATE customer_wants       SET store_id = wid WHERE store_id IS NULL;
  UPDATE store_settings       SET store_id = wid WHERE store_id IS NULL;

  RAISE NOTICE 'Backfill complete for store_id = %', wid;
END $$;
