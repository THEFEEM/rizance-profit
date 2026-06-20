-- Rizance Profit — Migration 0016
-- Personal mode: separate entry tables, monthly_budget on users, savings_goals.
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).

BEGIN;

-- Personal income entries
CREATE TABLE IF NOT EXISTS personal_income_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category VARCHAR(30) NOT NULL
    CHECK (category IN ('salary','business','freelance','scholarship',
           'family','bonus','loan_return','other_income')),
  note TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_income_user
  ON personal_income_entries(user_id, entry_date);

-- Personal expense entries
CREATE TABLE IF NOT EXISTS personal_expense_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category VARCHAR(30) NOT NULL
    CHECK (category IN ('food','transport','education','rent','water',
           'electricity','internet','phone','health','clothing',
           'donation','installment','social','other_expense')),
  note TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_expense_user
  ON personal_expense_entries(user_id, entry_date);

-- Monthly budget (on users table)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(12,2);

-- Savings goals (separate table — multiple goals per user)
CREATE TABLE IF NOT EXISTS savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(160) NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_savings_goals_user
  ON savings_goals(user_id);

COMMIT;
