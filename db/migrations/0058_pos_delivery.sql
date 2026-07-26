-- 0058_pos_delivery — สั่งเดลิเวอรี่ (ส่งถึงบ้าน) สำหรับออเดอร์ QR
--
-- ⚠️ ค่าส่งเป็น "รายได้" → ต้องอยู่ในบิลด้วย ไม่ใช่ตัวเลขลอยๆ
--    วิธีที่ใช้: ตอนปิดบิล ค่าส่งถูกบันทึกเป็น pos_bill_items 1 บรรทัด
--    (product_id = NULL, product_name = 'ค่าส่งเดลิเวอรี่', unit_cost_price = 0)
--    → SUM(bill_items.line_total) = pos_bills.total_amount = journal debit = credit
--      ยังจริงทุกบิลเหมือนเดิม ไม่ต้องแก้ posting adapter
--    pos_orders.delivery_fee เก็บไว้เพื่อโชว์/คำนวณตอนสร้างออเดอร์เท่านั้น
--
-- สถานะไม่เพิ่มใหม่: ใช้ ready = "พร้อมส่ง/กำลังไปส่ง", completed = "ส่งถึงแล้ว"
--   (UI เปลี่ยนคำตาม order_type — CHECK ของ status ไม่ต้องแก้)

BEGIN;

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(12) NOT NULL DEFAULT 'pickup';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_order_type_check'
  ) THEN
    ALTER TABLE pos_orders
      ADD CONSTRAINT pos_orders_order_type_check
      CHECK (order_type IN ('pickup', 'delivery'));
  END IF;
END $$;

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS delivery_address VARCHAR(300);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS delivery_note    VARCHAR(200);
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_delivery_fee_check'
  ) THEN
    ALTER TABLE pos_orders
      ADD CONSTRAINT pos_orders_delivery_fee_check CHECK (delivery_fee >= 0);
  END IF;
END $$;

-- ตั้งค่าเดลิเวอรี่ต่อร้าน
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS delivery_min_order NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS delivery_area_note VARCHAR(200);

COMMIT;
