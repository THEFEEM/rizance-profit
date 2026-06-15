-- 0011_project_mode — Project mode (โครงการ): NEW tables only.
--
-- No changes to shop/booth/category/pricing tables.
-- Option A: short-term projects get exactly one auto-created activity in app code.
-- Income/expense always attach to project_activities (one code path).
--
-- Re-runnable: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

-- =========================================================
-- projects (top-level club/org budget container)
-- =========================================================
CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  project_type  VARCHAR(10) NOT NULL
    CHECK (project_type IN ('short', 'long')),
  org_name      VARCHAR(160),
  budget_target NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (budget_target >= 0),
  start_date    DATE,
  end_date      DATE,
  status        VARCHAR(12) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_projects_user_status
  ON projects (user_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_user_created
  ON projects (user_id, created_at DESC);

-- =========================================================
-- project_activities (sub-activities; short-term = 1 auto row)
-- =========================================================
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
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_project_activities_project
  ON project_activities (project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_activities_user
  ON project_activities (user_id, project_id);

-- =========================================================
-- project_income_entries (funding in — always via activity)
-- =========================================================
CREATE TABLE IF NOT EXISTS project_income_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES project_activities(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  source      VARCHAR(30) NOT NULL
    CHECK (source IN (
      'faculty_grant', 'membership', 'participant_fee', 'sponsor',
      'donation', 'activity_income', 'other_income'
    )),
  label       VARCHAR(160),
  entry_date  DATE NOT NULL,
  note        TEXT,
  receipt_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_income_activity_date
  ON project_income_entries (activity_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_project_income_user
  ON project_income_entries (user_id, activity_id);

-- =========================================================
-- project_expense_entries (spending out — always via activity)
-- =========================================================
CREATE TABLE IF NOT EXISTS project_expense_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES project_activities(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category    VARCHAR(30) NOT NULL
    CHECK (category IN (
      'venue', 'food', 'transport', 'materials',
      'printing', 'reward', 'service', 'other_expense'
    )),
  label       VARCHAR(160),
  payer_name  VARCHAR(120),
  entry_date  DATE NOT NULL,
  note        TEXT,
  receipt_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_expense_activity_date
  ON project_expense_entries (activity_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_project_expense_user
  ON project_expense_entries (user_id, activity_id);

-- =========================================================
-- project_members (contributors — accountability only, no equity/split)
-- =========================================================
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

CREATE INDEX IF NOT EXISTS idx_project_members_project
  ON project_members (project_id);
