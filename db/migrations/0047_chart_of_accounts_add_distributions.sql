-- 0047_chart_of_accounts_add_distributions.sql
-- Contra-equity account for profit withdrawals (RTS-P6-C2 §5.3)
-- Requires: 0045_financial_engine_v1_chart_of_accounts_journal.sql

BEGIN;

INSERT INTO chart_of_accounts (account_code, account_name, display_name, account_type, normal_balance)
VALUES ('3100', 'เงินปันผล/ถอนกำไร', 'ถอนกำไร', 'equity', 'debit')
ON CONFLICT (account_code) DO NOTHING;

COMMIT;
