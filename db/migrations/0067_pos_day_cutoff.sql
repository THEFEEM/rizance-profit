-- 0067_pos_day_cutoff — "เวลาปิดวันขาย" ต่อร้าน (business day cutoff)
--
-- ที่มา (3 ส.ค. 2569): ร้านรับออเดอร์ก่อนเที่ยงคืนแต่เก็บเงินไม่ทัน บิลจึงถูกลง
-- เป็นวันถัดไป → ยอดวันจริงขาด วันถัดไปเกิน ต้องมานั่งเลื่อน entry_date ด้วย SQL
--
-- วิธีที่ POS ร้านอาหารใช้กัน: กำหนด "ชั่วโมงตัดวัน" เช่น 3 = 03:00
--   บิลที่ปิดเวลา 00:00–02:59 นับเป็นยอดของ "วันก่อน"
--   บิลที่ปิดเวลา 03:00 ขึ้นไป นับเป็นยอดของวันนั้น
--   ตั้ง 0 = ปิดใช้งาน (ตัดวันตอนเที่ยงคืนตามปกติ) → เป็นค่าเริ่มต้น ของเดิมไม่เปลี่ยน
--
-- ⚠️ กระทบเฉพาะ "วันที่ที่บันทึก" ของบิล/ออเดอร์/เลขคิว — ไม่แตะยอด ไม่แตะ journal
--    invariant SUM(bill_items.line_total) = bills.total_amount = debit = credit ยังจริง
--
-- ช่วง 0-11 เท่านั้น: ตัดวันหลังเที่ยงไม่มีความหมายสำหรับร้านอาหาร และกันตั้งผิด
-- เป็น 23 ซึ่งจะทำให้ยอดเกือบทั้งวันไปกองที่วันก่อนหน้า

BEGIN;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS day_cutoff_hour SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_shop_settings_day_cutoff_hour_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_day_cutoff_hour_check
      CHECK (day_cutoff_hour >= 0 AND day_cutoff_hour <= 11);
  END IF;
END $$;

COMMIT;
