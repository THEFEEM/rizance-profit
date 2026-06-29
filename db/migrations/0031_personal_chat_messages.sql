-- 0031_personal_chat_messages — Rizq AI chat history for personal mode
BEGIN;

CREATE TABLE IF NOT EXISTS personal_chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content       TEXT NOT NULL DEFAULT '',
  entry_id      UUID,
  entry_kind    VARCHAR(10) CHECK (entry_kind IN ('income', 'expense')),
  card_data     JSONB,
  image_thumb   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_chat_messages_user_id_idx
  ON personal_chat_messages (user_id, created_at DESC);

COMMIT;
