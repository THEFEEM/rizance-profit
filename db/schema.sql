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
-- category: storefront | online | delivery | service | other_income | misc
-- =========================================================
CREATE TABLE IF NOT EXISTS income_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category   VARCHAR(40) NOT NULL DEFAULT 'storefront'
             CHECK (category IN (
               'storefront', 'online', 'delivery', 'service', 'other_income', 'misc'
             )),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
             CHECK (payment_method IN ('cash', 'transfer')),
  note       VARCHAR(255),
  entry_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- expense_entries  (money out)
-- category: rent | wage | equipment | materials | utilities | shipping | marketing | expense_misc
-- =========================================================
CREATE TABLE IF NOT EXISTS expense_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category   VARCHAR(40) NOT NULL DEFAULT 'expense_misc'
             CHECK (category IN (
               'rent', 'wage', 'equipment', 'materials',
               'utilities', 'shipping', 'marketing', 'expense_misc'
             )),
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
  category       VARCHAR(40) NOT NULL DEFAULT 'storefront'
    CHECK (category IN (
      'storefront', 'online', 'delivery', 'service', 'other_income', 'misc'
    )),
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
  category         VARCHAR(30) NOT NULL
    CHECK (category IN (
      'rent', 'wage', 'equipment', 'materials',
      'utilities', 'shipping', 'marketing', 'expense_misc'
    )),
  label            VARCHAR(120),
  note             VARCHAR(255),
  payer_member_id      UUID REFERENCES booth_members(id) ON DELETE SET NULL,
  external_payer_name  VARCHAR(120),
  entry_date           DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booth_expense_entries_payer_xor_check CHECK (
    (payer_member_id IS NULL AND NULLIF(btrim(external_payer_name), '') IS NULL)
    OR (payer_member_id IS NOT NULL AND NULLIF(btrim(external_payer_name), '') IS NULL)
    OR (payer_member_id IS NULL AND NULLIF(btrim(external_payer_name), '') IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_booth_expense_booth_date ON booth_expense_entries (booth_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_booth_expense_user       ON booth_expense_entries (user_id, booth_id);
CREATE INDEX IF NOT EXISTS idx_booth_expense_payer
  ON booth_expense_entries (payer_member_id) WHERE payer_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booth_expense_external_payer
  ON booth_expense_entries (booth_id, external_payer_name)
  WHERE NULLIF(btrim(external_payer_name), '') IS NOT NULL;

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

-- =========================================================
-- Project mode (โครงการ) — SEPARATE tables; shop/booth untouched.
-- Option A: short-term = one auto-created activity (app layer).
-- =========================================================
CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  project_type  VARCHAR(10) NOT NULL
    CHECK (project_type IN ('short', 'long')),
  org_name      VARCHAR(160),
  project_code  VARCHAR(40),
  objective     TEXT,
  budget_target NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (budget_target >= 0),
  start_date    DATE,
  end_date      DATE,
  status        VARCHAR(12) NOT NULL DEFAULT 'active'
    CHECK (status IN ('planning', 'active', 'closed')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_projects_user_status ON projects (user_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_user_created ON projects (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  budget_target NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (budget_target >= 0),
  start_date    DATE,
  end_date      DATE,
  status        VARCHAR(12) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  note          TEXT,
  is_general    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_project_activities_project ON project_activities (project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_activities_user ON project_activities (user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_activities_general ON project_activities (project_id, is_general);

CREATE TABLE IF NOT EXISTS project_income_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     UUID NOT NULL REFERENCES project_activities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  source          VARCHAR(30) NOT NULL
    CHECK (source IN (
      'faculty_grant', 'membership', 'participant_fee', 'sponsor',
      'donation', 'activity_income', 'other_income'
    )),
  label           VARCHAR(160),
  entry_date      DATE NOT NULL,
  note            TEXT,
  receipt_url     TEXT,
  payment_method  VARCHAR(12) NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'transfer')),
  payment_status  VARCHAR(12) NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('pending', 'approved', 'paid', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_income_activity_date ON project_income_entries (activity_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_project_income_user ON project_income_entries (user_id, activity_id);
-- idx_project_income_status: created by migration 0012 (column may not exist on legacy tables)

CREATE TABLE IF NOT EXISTS project_expense_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     UUID NOT NULL REFERENCES project_activities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category        VARCHAR(30) NOT NULL
    CHECK (category IN (
      'venue', 'food', 'transport', 'materials',
      'printing', 'reward', 'service', 'other_expense'
    )),
  label           VARCHAR(160),
  payer_name      VARCHAR(120),
  fund_source     VARCHAR(30)
    CHECK (fund_source IS NULL OR fund_source IN (
      'faculty_grant', 'membership', 'participant_fee', 'sponsor',
      'donation', 'activity_income', 'other_income'
    )),
  entry_date      DATE NOT NULL,
  note            TEXT,
  receipt_url     TEXT,
  is_advance      BOOLEAN NOT NULL DEFAULT false,
  reimbursed_at   TIMESTAMPTZ,
  payment_status  VARCHAR(12) NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('pending', 'approved', 'paid', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_expense_activity_date ON project_expense_entries (activity_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_project_expense_user ON project_expense_entries (user_id, activity_id);
CREATE INDEX IF NOT EXISTS idx_project_expense_advance
  ON project_expense_entries (activity_id, is_advance)
  WHERE is_advance = true;
-- idx_project_expense_status: created by migration 0012 (column may not exist on legacy tables)
-- idx_project_expense_fund_source: created by migration 0013 (column may not exist on legacy tables)

CREATE TABLE IF NOT EXISTS project_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  role       VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('treasurer', 'member', 'advisor')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members (project_id);
