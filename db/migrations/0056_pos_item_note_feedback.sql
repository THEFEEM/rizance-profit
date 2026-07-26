-- 0056_pos_item_note_feedback — โน้ตต่อรายการ + ความเห็นลูกค้าหลังรับอาหาร
--
-- 1) note ต่อรายการ (เช่น "ไม่ใส่ผัก", "เพิ่มแตงกวาดอง")
--    เก็บทั้งฝั่งออเดอร์ (ครัว/พนักงานเห็น) และฝั่งบิล (snapshot ประวัติ)
--    ไม่กระทบบัญชี: เป็นข้อความล้วน ไม่มีผลต่อ line_total / total_amount / journal
--
-- 2) pos_order_feedback — ลูกค้า QR ให้คะแนน+คอมเมนต์ได้ 1 ครั้งต่อ 1 ออเดอร์
--    (UNIQUE order_id) เขียนผ่าน access_token ของออเดอร์เท่านั้น ไม่ต้องล็อกอิน
--    ON DELETE CASCADE → ล้างข้อมูลเทสลบ orders แล้ว feedback หายตามอัตโนมัติ

BEGIN;

ALTER TABLE pos_order_items ADD COLUMN IF NOT EXISTS note VARCHAR(200);
ALTER TABLE pos_bill_items  ADD COLUMN IF NOT EXISTS note VARCHAR(200);

CREATE TABLE IF NOT EXISTS pos_order_feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_order_feedback_user_created
  ON pos_order_feedback (user_id, created_at DESC);

COMMIT;
