-- 0024_capital_transactions — shop capital ledger (Phase 2B)
-- Scope: shop_members only (not booth_members)
-- investment_amount stays as synced cache of SUM(ledger)
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS. Backfill runs once (review counts before migrate).

CREATE TABLE IF NOT EXISTS capital_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES shop_members(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction   VARCHAR(20) NOT NULL
              CHECK (direction IN ('contribution', 'withdrawal')),
  note        VARCHAR(255),
  entry_date  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_tx_user_date
  ON capital_transactions (user_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_capital_tx_member
  ON capital_transactions (member_id, entry_date);

-- Backfill: existing investment_amount → first contribution row per member
INSERT INTO capital_transactions (user_id, member_id, amount, direction, note, entry_date)
SELECT user_id, id, investment_amount, 'contribution',
       'ยอดยกมา', created_at::date
FROM shop_members
WHERE investment_amount > 0;
