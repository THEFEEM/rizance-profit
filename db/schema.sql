-- Rizance Profit — database schema (idempotent: safe on a fresh DB or re-run)
-- Profit is NEVER stored; it is always derived (income − expense) in app code.
-- Money is NUMERIC(12,2) — never float — to avoid rounding errors on cash.
-- All CREATE EXTENSION / TABLE / INDEX statements use IF NOT EXISTS.
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
-- category: storefront | delivery | other
-- =========================================================
CREATE TABLE IF NOT EXISTS income_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category   VARCHAR(40) NOT NULL DEFAULT 'storefront'
             CHECK (category IN ('storefront', 'delivery', 'other')),
  note       VARCHAR(255),
  entry_date DATE NOT NULL,
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
  entry_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Indexes — every summary is a (user_id, date-range) scan
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_income_user_date  ON income_entries  (user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_expense_user_date ON expense_entries (user_id, entry_date);

-- =========================================================
-- Cost & Pricing (computed costs never stored)
-- =========================================================
CREATE TABLE IF NOT EXISTS ingredients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(120) NOT NULL,
  purchase_quantity NUMERIC(12,4) NOT NULL CHECK (purchase_quantity > 0),
  purchase_unit     VARCHAR(20) NOT NULL,
  purchase_price    NUMERIC(12,2) NOT NULL CHECK (purchase_price >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingredients_user ON ingredients (user_id);

CREATE TABLE IF NOT EXISTS menu_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(120) NOT NULL,
  desired_profit NUMERIC(12,2) CHECK (desired_profit IS NULL OR desired_profit >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_items_user ON menu_items (user_id);

CREATE TABLE IF NOT EXISTS recipe_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity      NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  UNIQUE (menu_item_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_items_menu ON recipe_items (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient ON recipe_items (ingredient_id);

CREATE TABLE IF NOT EXISTS overheads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        VARCHAR(40) NOT NULL,
  label           VARCHAR(120),
  monthly_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_overheads_user ON overheads (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_overheads_user_fixed_category
  ON overheads (user_id, category)
  WHERE category <> 'other';

CREATE TABLE IF NOT EXISTS pricing_settings (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  estimated_cups_per_month INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cups_per_month >= 0),
  default_profit_per_cup   NUMERIC(12,2) CHECK (default_profit_per_cup IS NULL OR default_profit_per_cup >= 0),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Mode Even (booth/event mode) — SEPARATE tables; the regular
-- income_entries / expense_entries are never altered.
-- =========================================================
CREATE TABLE IF NOT EXISTS booths (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                VARCHAR(120) NOT NULL,
  pool_budget         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pool_budget >= 0),
  pool_gets_share     BOOLEAN NOT NULL DEFAULT false,
  profit_split_method VARCHAR(20) NOT NULL DEFAULT 'equal'
    CHECK (profit_split_method IN ('equal', 'by_equity')),
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at           TIMESTAMPTZ,
  note                VARCHAR(255),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_booths_user_status ON booths (user_id, status);
CREATE INDEX IF NOT EXISTS idx_booths_user_start  ON booths (user_id, start_date DESC);

CREATE TABLE IF NOT EXISTS booth_income_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id       UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  note           VARCHAR(255),
  entry_date     DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booth_income_booth_date ON booth_income_entries (booth_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_booth_income_user       ON booth_income_entries (user_id, booth_id);

CREATE TABLE IF NOT EXISTS booth_expense_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id         UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  cost_type        VARCHAR(20) NOT NULL CHECK (cost_type IN ('fixed', 'variable')),
  label            VARCHAR(120),
  note             VARCHAR(255),
  payer_member_id  UUID REFERENCES booth_members(id) ON DELETE SET NULL,
  entry_date       DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booth_expense_booth_date ON booth_expense_entries (booth_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_booth_expense_user       ON booth_expense_entries (user_id, booth_id);
CREATE INDEX IF NOT EXISTS idx_booth_expense_payer
  ON booth_expense_entries (payer_member_id) WHERE payer_member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS booth_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id          UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  name              VARCHAR(120) NOT NULL,
  role              VARCHAR(20) NOT NULL DEFAULT 'employee'
    CHECK (role IN ('investor', 'employee', 'manager')),
  investment_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (investment_amount >= 0),
  wage_amount       NUMERIC(12,2) CHECK (wage_amount IS NULL OR wage_amount >= 0),
  wage_type         VARCHAR(10) CHECK (wage_type IS NULL OR wage_type IN ('daily', 'event')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booth_members_booth ON booth_members (booth_id);
CREATE INDEX IF NOT EXISTS idx_booth_members_booth_role ON booth_members (booth_id, role);
