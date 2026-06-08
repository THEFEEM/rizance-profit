-- Rizance Profit — database schema
-- Profit is NEVER stored; it is always derived (income − expense) in app code.
-- Money is NUMERIC(12,2) — never float — to avoid rounding errors on cash.
-- Requires the pgcrypto extension for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- users  (the shop owner; one owner == one shop in the MVP)
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  shop_name     VARCHAR(120) NOT NULL,
  currency      CHAR(3)      NOT NULL DEFAULT 'THB',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- =========================================================
-- income_entries  (money in)
-- =========================================================
CREATE TABLE IF NOT EXISTS income_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  note       VARCHAR(255),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- expense_entries  (money out)
-- category: supplies | rent | salary | utilities | equipment | other
-- =========================================================
CREATE TABLE IF NOT EXISTS expense_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category   VARCHAR(40) NOT NULL DEFAULT 'other',
  note       VARCHAR(255),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Indexes — every summary is a (user_id, date-range) scan
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_income_user_date  ON income_entries  (user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_expense_user_date ON expense_entries (user_id, entry_date);
