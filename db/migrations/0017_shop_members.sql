-- Rizance Profit — Migration 0017
-- Shop partnership: shop_members for investor/manager equity split (E7).
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS shop_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'investor'
    CHECK (role IN ('investor', 'manager')),
  investment_amount NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (investment_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_members_user
  ON shop_members(user_id);

COMMIT;
