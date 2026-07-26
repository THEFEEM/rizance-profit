-- 0059_pos_delivery_geo — ลูกค้าแชร์ตำแหน่ง (พิกัด) แทนพิมพ์ที่อยู่
--
-- เก็บพิกัดจาก Geolocation API ของเบราว์เซอร์ลูกค้า:
--   delivery_lat / delivery_lng      — พิกัด (NUMERIC(9,6) ≈ ละเอียด ~11 ซม.)
--   delivery_accuracy_m              — ความคลาดเคลื่อนที่เครื่องรายงาน (เมตร)
--                                      ใช้เตือนพนักงานถ้าจับตำแหน่งหลวมเกิน
--
-- ที่อยู่ตัวอักษร (delivery_address จาก 0058) ยังเก็บไว้เป็น "รายละเอียดเสริม"
--   เช่น บ้านเลขที่ / ชั้น / จุดสังเกต — ไม่บังคับแล้วเมื่อมีพิกัด
--   ฝั่ง server บังคับว่าต้องมี (lat+lng) หรือ address อย่างน้อยหนึ่งอย่าง
--
-- ไม่มีผลต่อบัญชี: เป็นข้อมูลจัดส่งล้วนๆ
-- PDPA: พิกัดผูกกับออเดอร์ ลบตามออเดอร์ (ล้างข้อมูลเทส/ลบ user = CASCADE)

BEGIN;

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS delivery_lat NUMERIC(9,6);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS delivery_lng NUMERIC(9,6);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS delivery_accuracy_m NUMERIC(8,1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_delivery_latlng_check'
  ) THEN
    ALTER TABLE pos_orders
      ADD CONSTRAINT pos_orders_delivery_latlng_check
      CHECK (
        (delivery_lat IS NULL AND delivery_lng IS NULL)
        OR (
          delivery_lat BETWEEN -90 AND 90
          AND delivery_lng BETWEEN -180 AND 180
        )
      );
  END IF;
END $$;

COMMIT;
