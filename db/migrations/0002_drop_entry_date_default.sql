-- 0002_drop_entry_date_default
-- Remove UTC-biased CURRENT_DATE defaults. The app always supplies entry_date
-- via today() (Asia/Bangkok) in lib/queries.ts.
ALTER TABLE income_entries  ALTER COLUMN entry_date DROP DEFAULT;
ALTER TABLE expense_entries ALTER COLUMN entry_date DROP DEFAULT;
