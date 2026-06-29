-- Rizance Profit — Migration 0034 (Personal Plus plan)
-- Run in Supabase SQL Editor before deploying webhook/checkout changes.

BEGIN;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_subscription_plan_check;

ALTER TABLE users
  ADD CONSTRAINT users_subscription_plan_check
  CHECK (subscription_plan IN (
    'free', 'personal_plus', 'event_pass', 'business'
  ));

ALTER TABLE stripe_payments
  DROP CONSTRAINT IF EXISTS stripe_payments_plan_check;

ALTER TABLE stripe_payments
  ADD CONSTRAINT stripe_payments_plan_check
  CHECK (plan IN ('event_pass', 'business', 'personal_plus'));

COMMIT;
