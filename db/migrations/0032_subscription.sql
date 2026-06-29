-- Rizance Profit — Migration 0032 (Stripe subscription Phase 1)
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).
--
-- Schema verified against:
--   db/schema.sql → users.id UUID PRIMARY KEY

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_plan IN ('free', 'event_pass', 'business')),
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE TABLE IF NOT EXISTS stripe_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL,
  plan              TEXT NOT NULL CHECK (plan IN ('event_pass', 'business')),
  amount            INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'thb',
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_payments_user_id_idx ON stripe_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stripe_payments_session_idx ON stripe_payments (stripe_session_id);

CREATE TABLE IF NOT EXISTS usage_counters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counter_key TEXT NOT NULL,
  period      TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, counter_key, period)
);

COMMIT;
