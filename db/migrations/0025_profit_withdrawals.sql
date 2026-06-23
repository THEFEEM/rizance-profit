-- 0025_profit_withdrawals — shop profit withdrawal ledger (W1)
-- Paper-profit withdrawals per member; no payment_method in W1 (not linked to cash balance).
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS profit_withdrawals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES shop_members(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note        VARCHAR(255),
  entry_date  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profit_withdrawals_user_date
  ON profit_withdrawals (user_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_profit_withdrawals_member
  ON profit_withdrawals (member_id, entry_date);
