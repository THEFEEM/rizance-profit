-- 0065_pos_payment_timing — จังหวะเก็บเงินของออเดอร์หน้าร้าน (จ่ายก่อนทำ / จ่ายตอนรับ)
--
-- ที่มา: walk-in ที่เข้าคิวครัวเก็บเงินได้ตอน ready เท่านั้น ทำให้ตอนคนแน่น
--        ต้องเลือกระหว่าง "เก็บเงินได้แต่ครัวไม่เห็นคิว" กับ "เข้าคิวแต่เก็บเงินทีหลัง"
--        → แยก "จังหวะเก็บเงิน" ออกจาก "สถานะทำอาหาร" ให้เป็นสองแกนอิสระ
--
-- before = เก็บเงินก่อนเริ่มทำ (บิลเกิดตอนรับออเดอร์)
-- after  = เก็บตอนลูกค้ามารับ (พฤติกรรมเดิม → เป็นค่า DEFAULT ทุกแถวเดิมไม่เปลี่ยน)
--
-- ⚠️ บัญชี: ไม่มีตารางใหม่ ไม่มี journal ใหม่ — เปลี่ยนแค่ "เวลา" ที่ closePosBill ถูกเรียก
--    invariant SUM(bill_items.line_total) = bills.total_amount = debit = credit ยังจริงทุกบิล
--
-- ⚠️ รูที่ต้องปิดพร้อมกันในโค้ด (ไม่ใช่ใน migration นี้):
--    A) ห้ามยกเลิกออเดอร์ที่ bill_id IS NOT NULL จนกว่าจะยกเลิกบิลก่อน
--       ไม่งั้นรายได้ค้างในงบโดยไม่มีอาหารส่งมอบ
--    B) closePosBill + ผูก bill_id ต้องอยู่ transaction เดียว
--       (เกิดขึ้นจริงแล้ว 29 ก.ค.: Q260729-034/035/036 มีบิลแต่ bill_id IS NULL)

BEGIN;

-- ค่าเริ่มต้นต่อร้าน — เปลี่ยนได้ในชีต "QR เมนูร้าน"
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS default_payment_timing VARCHAR(8) NOT NULL DEFAULT 'after';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_shop_settings_default_payment_timing_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_default_payment_timing_check
      CHECK (default_payment_timing IN ('before', 'after'));
  END IF;
END $$;

-- ต่อออเดอร์ — สลับรายออเดอร์ได้ ไม่ต้องแก้ค่าเริ่มต้นร้าน
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS payment_timing VARCHAR(8) NOT NULL DEFAULT 'after';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_payment_timing_check'
  ) THEN
    ALTER TABLE pos_orders
      ADD CONSTRAINT pos_orders_payment_timing_check
      CHECK (payment_timing IN ('before', 'after'));
  END IF;
END $$;

-- ออเดอร์ที่ต้องเก็บเงินก่อนแต่ยังไม่มีบิล = คิวที่พนักงานต้องเคลียร์
CREATE INDEX IF NOT EXISTS idx_pos_orders_prepay_pending
  ON pos_orders (user_id, created_at)
  WHERE payment_timing = 'before' AND bill_id IS NULL;

COMMIT;
