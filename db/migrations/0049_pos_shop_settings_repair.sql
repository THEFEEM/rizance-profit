-- 0049_pos_shop_settings_repair — sync pos_shop_settings to the 0039 contract
-- Production DB has an older shape (receipt_name) missing: default_payment_method,
-- promptpay_id?, receipt_header, allow_negative_stock → PATCH /api/pos/settings 500s.
-- Additive + idempotent. Does NOT drop receipt_name (leave for a later cleanup).

BEGIN;

-- Fresh installs: full table per 0039 contract.
CREATE TABLE IF NOT EXISTS pos_shop_settings (
  user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  promptpay_id           VARCHAR(20),
  receipt_header         VARCHAR(160),
  allow_negative_stock   BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing installs: add whatever is missing.
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS default_payment_method VARCHAR(20) NOT NULL DEFAULT 'cash';
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS promptpay_id VARCHAR(20);
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS receipt_header VARCHAR(160);
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- CHECK constraint on default_payment_method (skip if already present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_shop_settings_default_payment_method_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_default_payment_method_check
      CHECK (default_payment_method IN ('cash', 'promptpay'));
  END IF;
END $$;

-- Carry legacy receipt_name over to receipt_header (only where header is empty).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_shop_settings' AND column_name = 'receipt_name'
  ) THEN
    EXECUTE 'UPDATE pos_shop_settings
             SET receipt_header = COALESCE(receipt_header, receipt_name)
             WHERE receipt_header IS NULL AND receipt_name IS NOT NULL';
  END IF;
END $$;

COMMIT;
