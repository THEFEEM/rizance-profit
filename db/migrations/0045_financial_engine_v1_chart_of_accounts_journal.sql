-- 0045_financial_engine_v1_chart_of_accounts_journal
-- Financial Engine v1: chart of accounts (global) + double-entry journal (append-only)
-- Requires: 0001_init.sql (users, pgcrypto / gen_random_uuid)

BEGIN;

-- =========================================================
-- 1. Chart of Accounts (global master data, not per-user)
-- =========================================================

CREATE TABLE chart_of_accounts (
  account_code   VARCHAR(10) PRIMARY KEY,
  account_name   VARCHAR(100) NOT NULL,
  display_name   VARCHAR(100) NOT NULL,
  account_type   VARCHAR(20) NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance VARCHAR(10) NOT NULL
    CHECK (normal_balance IN ('debit', 'credit')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chart_of_accounts (account_code, account_name, display_name, account_type, normal_balance)
VALUES
  ('1000', 'เงินสด',                     'เงินสด',                 'asset',     'debit'),
  ('1010', 'เงินฝากธนาคาร',               'เงินในบัญชีธนาคาร',       'asset',     'debit'),
  ('1200', 'สินค้าคงเหลือ',               'สต็อกสินค้า',             'asset',     'debit'),
  ('2000', 'เจ้าหนี้การค้า',              'ค้างจ่ายซัพพลายเออร์',    'liability', 'credit'),
  ('3000', 'ทุน–เจ้าของ',                'ทุนของเจ้าของ',           'equity',    'credit'),
  ('4000', 'รายได้จากการขาย',            'ยอดขาย',                 'revenue',   'credit'),
  ('5000', 'ต้นทุนขาย',                  'ต้นทุนสินค้าที่ขาย',       'expense',   'debit'),
  ('5900', 'ค่าใช้จ่ายอื่น',              'ค่าใช้จ่ายทั่วไป',         'expense',   'debit');

-- =========================================================
-- 2. Journal (double-entry, append-only)
-- =========================================================

CREATE TABLE journal_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date            DATE NOT NULL,
  description           TEXT NOT NULL,
  source_module         VARCHAR(30) NOT NULL,
  source_event_id       UUID NOT NULL,
  source_event_type     VARCHAR(30) NOT NULL,
  reversed_by_entry_id  UUID REFERENCES journal_entries(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_journal_source_unique
  ON journal_entries (source_module, source_event_id, source_event_type);

CREATE TABLE journal_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code  VARCHAR(10) NOT NULL REFERENCES chart_of_accounts(account_code),
  debit         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX idx_journal_lines_entry
  ON journal_lines (entry_id);

CREATE INDEX idx_journal_lines_account_date
  ON journal_lines (account_code);

COMMIT;
