-- 0100 — AUTH-HOTFIX-1: POS SSO handoff · single-use token ledger
--
-- ทำไมต้องมีตาราง: jti ใน token ที่เซ็นแล้ว "อย่างเดียว" กัน replay ไม่ได้
-- ต้องมีการ consume ฝั่งเซิร์ฟเวอร์ที่แชร์กันทุก instance (Vercel serverless ไม่แชร์ memory)
--
-- เก็บเฉพาะ sha256(jti) — ไม่เก็บ token ดิบ · แถวมีอายุ 60 วิ ตารางว่างเกือบตลอด
-- FK → users ON DELETE CASCADE + มี user_id: ไม่เป็น blocker ของ account deletion (กฎจาก A-3.0)
--
-- ⚠️ ไฟล์นี้ยังไม่ถูกรัน · ต้องรีวิวแล้วรันด้วยมือบน Production ก่อน deploy โค้ด
--    (ถ้า deploy โค้ดก่อน: handoff start ตอบ 503 / accept ตอบ 401 store_error — fail-closed ไม่วนลูป)

CREATE TABLE IF NOT EXISTS pos_handoff_tokens (
  jti_hash    TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT pos_handoff_tokens_jti_hash_len CHECK (char_length(jti_hash) = 64)
);

CREATE INDEX IF NOT EXISTS pos_handoff_tokens_expires_at_idx
  ON pos_handoff_tokens (expires_at);

COMMENT ON TABLE pos_handoff_tokens IS
  'AUTH-HOTFIX-1: one-time POS SSO handoff tokens (sha256 of jti). Temporary until pos.rizance.com migration.';
