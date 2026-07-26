-- 0054_pos_shop_live_at — go-live marker for the test-data wipe guard
-- NULL = ยังไม่เปิดร้านจริง (ปุ่มล้างข้อมูลเทสใช้ได้)
-- NOT NULL = เปิดจริงแล้ว → endpoint ล้างข้อมูลปฏิเสธถาวร (ปลดได้เฉพาะแก้ DB ตรง)

BEGIN;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ;

COMMIT;
