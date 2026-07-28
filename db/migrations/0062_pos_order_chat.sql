-- 0062_pos_order_chat — แชทในออเดอร์ (ลูกค้า ↔ ร้าน ↔ คนส่ง) + รูปหลักฐานการส่ง
--
-- ที่มา: เดลิเวอรี่ต้องคุยกันได้แบบ Grab — ลูกค้าบอกจุดส่ง / คนส่งถ่ายรูป
--        ยืนยันว่าวางของไว้ตรงไหนเมื่อลูกค้าไม่สะดวกมารับหน้างาน
--
-- โมเดล: ข้อความผูกกับ order (CASCADE — ล้างข้อมูลเทสแล้วแชทหายตาม)
--   sender: customer (พิสูจน์ตัวด้วย order.access_token)
--           shop     (session POS)
--           rider    (rider.access_token · เก็บ rider_id ไว้โชว์ชื่อ)
--   kind:   chat  = ข้อความ/รูปทั่วไป
--           proof = รูปหลักฐานการส่ง (โชว์กรอบพิเศษ + คำว่า "หลักฐานการส่ง")
--
-- ไม่มีผลกับบัญชี — เป็นข้อความล้วน

BEGIN;

CREATE TABLE IF NOT EXISTS pos_order_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  sender     VARCHAR(10) NOT NULL CHECK (sender IN ('customer', 'shop', 'rider')),
  rider_id   UUID REFERENCES pos_riders(id) ON DELETE SET NULL,
  kind       VARCHAR(10) NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'proof')),
  body       VARCHAR(500),
  image_url  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pos_order_messages_order
  ON pos_order_messages (order_id, created_at);

COMMIT;
