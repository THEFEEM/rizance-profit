-- 0063_pos_shop_phone — เบอร์โทรร้าน สำหรับปุ่ม "โทรหาร้าน" บนหน้าสถานะออเดอร์ลูกค้า
-- (ไม่ตั้ง = ปุ่มไม่โชว์)

BEGIN;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS shop_phone VARCHAR(20);

COMMIT;
