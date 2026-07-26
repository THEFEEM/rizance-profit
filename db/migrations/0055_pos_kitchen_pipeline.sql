-- 0055_pos_kitchen_pipeline — unified kitchen queue (walk-in + QR)
--
-- pos_orders becomes THE kitchen queue:
--   channel 'qr'  = ลูกค้าสั่งเอง (จ่ายตอนรับ — flow เดิม)
--   channel 'pos' = ตั๋วครัวจากบิล walk-in ที่จ่ายแล้ว (bill_id ผูกตั้งแต่สร้าง)
-- New status 'cooking' between accepted and ready:
--   pending → accepted → cooking → ready → completed / cancelled
-- kitchen_enabled: เปิดเมื่อร้านใช้จอครัว — ปิดบิล walk-in แล้วยิงตั๋วเข้าครัวอัตโนมัติ

BEGIN;

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS channel VARCHAR(10) NOT NULL DEFAULT 'qr';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_channel_check'
  ) THEN
    ALTER TABLE pos_orders
      ADD CONSTRAINT pos_orders_channel_check CHECK (channel IN ('qr', 'pos'));
  END IF;
END $$;

-- widen status CHECK: + cooking
ALTER TABLE pos_orders DROP CONSTRAINT IF EXISTS pos_orders_status_check;
ALTER TABLE pos_orders
  ADD CONSTRAINT pos_orders_status_check
  CHECK (status IN ('pending', 'accepted', 'cooking', 'ready', 'completed', 'cancelled'));

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS kitchen_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
