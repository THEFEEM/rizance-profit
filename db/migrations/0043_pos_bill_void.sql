-- 0043_pos_bill_void — void metadata on pos_bills + void_return stock movement type
-- Requires 0038_pos_core.sql, 0040_pos_bills_payment_method_promptpay.sql

BEGIN;

ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(200);

ALTER TABLE pos_stock_movements
  DROP CONSTRAINT IF EXISTS pos_stock_movements_movement_type_check;

ALTER TABLE pos_stock_movements
  ADD CONSTRAINT pos_stock_movements_movement_type_check
  CHECK (movement_type IN ('sale', 'adjustment', 'restock', 'void_return'));

COMMIT;
