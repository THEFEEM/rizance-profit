-- 0029_chat_messages — AI chat history for bookkeeping assistant (2A)
-- เก็บประวัติแชทจดบัญชี: ข้อความ user + ตอบกลับ AI + ผูกกับ entry ที่จด
-- role: user (คนพิมพ์/ส่งรูป) | assistant (AI ตอบ)
-- entry_id/entry_kind: ผูก message การ์ดยืนยันกับรายการที่บันทึก (null ถ้าไม่ใช่การจด)
BEGIN;

CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT,
  entry_id     UUID,
  entry_kind   VARCHAR(20) CHECK (entry_kind IS NULL OR entry_kind IN ('income', 'expense')),
  card_data    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON chat_messages (user_id, created_at);

COMMIT;
