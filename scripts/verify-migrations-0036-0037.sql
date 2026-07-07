-- Verify migrations 0036 + 0037 on Supabase production
-- Paste into SQL Editor → Run. All rows in "status" should show OK.

-- ── 0036: creditor_repayments.booth_id ─────────────────────────────────────
SELECT
  '0036 booth_id column' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'creditor_repayments'
      AND column_name = 'booth_id'
      AND udt_name = 'uuid'
      AND is_nullable = 'YES'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT
  '0036 booth_id FK → booths' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'creditor_repayments'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'booth_id'
      AND ccu.table_name = 'booths'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT
  '0036 idx_creditor_repayments_booth' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'creditor_repayments'
      AND indexname = 'idx_creditor_repayments_booth'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ── 0037: booth_expense_entries.payment_method ─────────────────────────────
SELECT
  '0037 payment_method column' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booth_expense_entries'
      AND column_name = 'payment_method'
      AND is_nullable = 'NO'
      AND column_default LIKE '%cash%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT
  '0037 payment_method CHECK (cash|transfer)' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'booth_expense_entries'
      AND c.conname = 'booth_expense_entries_payment_method_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%cash%'
      AND pg_get_constraintdef(c.oid) ILIKE '%transfer%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ── Reused (no new migration): creditor_repayments.payment_method from 0028 ─
SELECT
  '0028 creditor_repayments.payment_method (reused)' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'creditor_repayments'
      AND column_name = 'payment_method'
      AND is_nullable = 'NO'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ── Sample counts (informational, not pass/fail) ───────────────────────────
SELECT
  COUNT(*) FILTER (WHERE booth_id IS NOT NULL) AS booth_repayments,
  COUNT(*) FILTER (WHERE booth_id IS NULL) AS shop_repayments,
  COUNT(*) AS total
FROM creditor_repayments;

SELECT
  payment_method,
  COUNT(*) AS rows
FROM booth_expense_entries
GROUP BY payment_method
ORDER BY payment_method;
