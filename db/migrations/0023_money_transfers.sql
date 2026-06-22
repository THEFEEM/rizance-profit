-- 0023_money_transfers — shop cash↔transfer moves (Phase 3.5)
-- NOT income/expense — zero-sum between cashOnHand and transferOnHand
-- Scope: regular shop only (user_id on users table)
-- Idempotent where possible. Review pre-check before running on shared Supabase.

CREATE TABLE IF NOT EXISTS money_transfers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction   VARCHAR(20) NOT NULL
              CHECK (direction IN ('cash_to_transfer', 'transfer_to_cash')),
  note        VARCHAR(255),
  entry_date  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_money_transfer_user_date
  ON money_transfers (user_id, entry_date);

-- direction semantics:
--   cash_to_transfer = ฝากสดเข้าบัญชี (cash ↓ transfer ↑)
--   transfer_to_cash = ถอนเป็นเงินสด (transfer ↓ cash ↑)
