-- 0004_mode_even — booth/event mode (Mode Even)
--
-- Booth data lives in SEPARATE tables. income_entries / expense_entries are
-- NOT altered: every existing query keeps returning regular-shop data only.
-- Profit / break-even are always derived in app code — never stored.
-- Money NUMERIC(12,2). Dates are Bangkok calendar days (resolved in app code).

-- =========================================================
-- booths — one row per event (a 3-day fair = 1 booth)
-- =========================================================
CREATE TABLE IF NOT EXISTS booths (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  starting_budget NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (starting_budget >= 0),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at       TIMESTAMPTZ,
  note            VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_booths_user_status ON booths (user_id, status);
CREATE INDEX IF NOT EXISTS idx_booths_user_start  ON booths (user_id, start_date DESC);

-- =========================================================
-- booth_income_entries — money in, split cash vs transfer
-- =========================================================
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

-- =========================================================
-- booth_expense_entries — money out, fixed (ค่าที่/ค่าแรง) vs variable (วัตถุดิบ)
-- =========================================================
CREATE TABLE IF NOT EXISTS booth_expense_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id   UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  cost_type  VARCHAR(20) NOT NULL CHECK (cost_type IN ('fixed', 'variable')),
  label      VARCHAR(120),
  note       VARCHAR(255),
  entry_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booth_expense_booth_date ON booth_expense_entries (booth_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_booth_expense_user       ON booth_expense_entries (user_id, booth_id);

-- =========================================================
-- booth_members — team for one event (names only, v1)
-- =========================================================
CREATE TABLE IF NOT EXISTS booth_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id   UUID NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  role       VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booth_members_booth ON booth_members (booth_id);
