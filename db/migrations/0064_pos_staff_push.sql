-- 0064_pos_staff_push — แจ้งเตือนมือถือฝั่งร้าน (ออเดอร์ใหม่ + ลูกค้าทักแชท)
--
-- ที่มา: ร้านปิดจอ/สลับแอปแล้วไม่รู้ว่าลูกค้าทักมา — เสียง/toast ในหน้าเว็บ
-- ช่วยเฉพาะตอนเปิดหน้าอยู่ → ต้องมี Web Push ของฝั่งพนักงานด้วย
--
-- subscription ผูกกับ user (ร้าน) — มือถือ/เบราว์เซอร์กี่เครื่องก็ subscribe ได้
-- ลบอัตโนมัติเมื่อ endpoint ตาย (404/410) เหมือน subs ลูกค้า/คนส่ง

BEGIN;

CREATE TABLE IF NOT EXISTS pos_staff_push_subs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_push_subs_user
  ON pos_staff_push_subs (user_id);

COMMIT;
