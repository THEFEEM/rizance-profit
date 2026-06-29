-- Rizance Profit — Migration 0035 (token-based AI budgets)
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS token_budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  tokens_total  INTEGER NOT NULL,
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  period        TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_budgets_user_scope_period_idx
  ON token_budgets (user_id, scope, COALESCE(period, 'none'));

CREATE INDEX IF NOT EXISTS token_budgets_user_scope_idx
  ON token_budgets (user_id, scope);

CREATE TABLE IF NOT EXISTS token_costs (
  action  TEXT PRIMARY KEY,
  tokens  INTEGER NOT NULL
);

INSERT INTO token_costs (action, tokens) VALUES
  ('rizq_chat',    1500),
  ('scan_slip',    800),
  ('scan_receipt', 3000)
ON CONFLICT (action) DO NOTHING;

COMMIT;
