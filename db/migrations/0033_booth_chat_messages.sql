-- 0033_booth_chat_messages — Rizq AI chat history for booth mode
BEGIN;

CREATE TABLE IF NOT EXISTS booth_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id    UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL DEFAULT '',
  entry_id    UUID,
  entry_kind  VARCHAR(10) CHECK (entry_kind IN ('income', 'expense')),
  card_data   JSONB,
  image_thumb TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booth_chat_messages_booth_id_idx
  ON booth_chat_messages (booth_id, created_at DESC);

COMMIT;
