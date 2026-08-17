-- 0075_pos_tables — NINENON Self-Order: QR รายโต๊ะ + ทานที่ร้าน
--
-- ที่มาจาก audit: ระบบสั่งเอง (เมนู /m, ออเดอร์เข้า POS, เลขคิว, สถานะ, ชื่อเรียกคิว,
-- ร้านปิด, add-ons, server-side pricing) มีครบแล้ว — delta จริงคือ "โต๊ะ" เท่านั้น
--
-- การตัดสินใจ:
-- 1) เก็บ table_code เป็น snapshot ใน order (ไม่ FK) — ลบ/เปลี่ยนชื่อโต๊ะ
--    แล้วประวัติออเดอร์เก่าต้องยังอ่านออกว่ามาจากโต๊ะไหน
-- 2) dine_in เป็น order_type ที่สาม (ADDITIVE บน CHECK เดิม) — flow เดิม pickup/delivery
--    ไม่ถูกแตะแม้แต่บรรทัดเดียว
-- 3) QR ต่อโต๊ะ = /m/<menuToken>?t=<code> — reuse token เดิม ไม่มี token ใหม่ให้รั่ว
--    การปลอม ?t= ได้แค่ "อ้างโต๊ะผิด" ซึ่งพนักงานเห็นตอนเสิร์ฟอยู่แล้ว (ยอมรับได้)
--    โต๊ะที่ปิดใช้งาน (is_active=false) สั่งไม่ได้ — server ตรวจเสมอ

BEGIN;

CREATE TABLE IF NOT EXISTS pos_tables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- รหัสสั้นใน QR เช่น T01 (a-z0-9 ไม่เกิน 10)
  code       VARCHAR(10) NOT NULL,
  -- ชื่อที่คนอ่าน เช่น "โต๊ะ 1" / "ชั้นสอง ริมหน้าต่าง"
  label      VARCHAR(40) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_tables_user_code
  ON pos_tables (user_id, upper(code));

-- ── ออเดอร์: ประเภท dine_in + โต๊ะ ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_order_type_check') THEN
    ALTER TABLE pos_orders DROP CONSTRAINT pos_orders_order_type_check;
  END IF;
  ALTER TABLE pos_orders ADD CONSTRAINT pos_orders_order_type_check
    CHECK (order_type IN ('pickup', 'delivery', 'dine_in'));
END $$;

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS table_code VARCHAR(10);

-- คิวครัว: ออเดอร์ค้างของโต๊ะหนึ่ง (เพิ่มรายการ/ตามเสิร์ฟ)
CREATE INDEX IF NOT EXISTS idx_pos_orders_table_open
  ON pos_orders (user_id, table_code, created_at DESC)
  WHERE table_code IS NOT NULL AND status NOT IN ('completed', 'cancelled');

COMMIT;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='pos_tables') AS tbl_cols, -- 7
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_name='pos_orders' AND column_name='table_code')                    AS ord_col,  -- 1
--   (SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname='pos_orders_order_type_check')                                   AS type_chk; -- มี dine_in
