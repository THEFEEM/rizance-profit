-- Rizance Profit — Migration 0021 (E8.1 Subscriptions DB)
-- Prepaid subscription state + payment audit (Omise wiring in E8.2+).
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).
--
-- Schema verified against:
--   db/schema.sql → users.id UUID PRIMARY KEY DEFAULT gen_random_uuid()

BEGIN;

-- Current subscription state (1 user → 1 row)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier               VARCHAR(20) NOT NULL DEFAULT 'free'
                       CHECK (tier IN ('free','event_pass','business','business_pro','org_lite','org_pro')),
  current_period_end TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment history (audit, dedupe via omise_charge_id)
CREATE TABLE IF NOT EXISTS payment_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier               VARCHAR(20) NOT NULL,
  amount             NUMERIC(10,2) NOT NULL,
  period_days        INTEGER NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid','failed','expired')),
  omise_charge_id    VARCHAR(120) UNIQUE,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_period_end ON user_subscriptions(current_period_end);
CREATE INDEX IF NOT EXISTS idx_pay_user ON payment_records(user_id);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payment_records(status);

COMMIT;
