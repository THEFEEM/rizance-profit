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
        -- ordinary expense — no payer tracked (blank/whitespace external = none)
        (
          payer_member_id IS NULL
          AND NULLIF(btrim(external_payer_name), '') IS NULL
        )
        -- member advance
        OR (
          payer_member_id IS NOT NULL
          AND NULLIF(btrim(external_payer_name), '') IS NULL
        )
        -- external advance — trimmed non-empty name only
        OR (
          payer_member_id IS NULL
          AND NULLIF(btrim(external_payer_name), '') IS NOT NULL
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
  WHERE NULLIF(btrim(external_payer_name), '') IS NOT NULL;
