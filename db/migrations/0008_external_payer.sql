-- 0008_external_payer — advance payer outside booth member list
--
-- Locked product decisions (2026-06):
--   Advance expense (ออกเงินก่อน) payer is EITHER a booth member OR an external person.
--   Member advance: payer_member_id set, external_payer_name NULL.
--   External advance: external_payer_name set (trimmed, non-empty), payer_member_id NULL.
--   Non-advance expense: both NULL.
--   External creditors receive FIFO repayment from gross profit (model A) — never profit share.
--
-- Re-runnable: IF NOT EXISTS / IF EXISTS, DO blocks for constraints.

-- =========================================================
-- booth_expense_entries — external payer name
-- =========================================================

ALTER TABLE booth_expense_entries
  ADD COLUMN IF NOT EXISTS external_payer_name VARCHAR(120);

-- =========================================================
-- XOR: at most one payer identity per row
-- =========================================================

DO $$
BEGIN
  ALTER TABLE booth_expense_entries
    DROP CONSTRAINT IF EXISTS booth_expense_entries_payer_xor_check;
END $$;

DO $$
BEGIN
  ALTER TABLE booth_expense_entries
    ADD CONSTRAINT booth_expense_entries_payer_xor_check
      CHECK (
        -- ordinary expense — no payer tracked
        (
          payer_member_id IS NULL
          AND (external_payer_name IS NULL OR btrim(external_payer_name) = '')
        )
        -- member advance
        OR (
          payer_member_id IS NOT NULL
          AND (external_payer_name IS NULL OR btrim(external_payer_name) = '')
        )
        -- external advance
        OR (
          payer_member_id IS NULL
          AND external_payer_name IS NOT NULL
          AND length(btrim(external_payer_name)) > 0
        )
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================
-- indexes
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_booth_expense_external_payer
  ON booth_expense_entries (booth_id, external_payer_name)
  WHERE external_payer_name IS NOT NULL AND btrim(external_payer_name) <> '';
