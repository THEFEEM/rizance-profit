-- 0051_pos_bill_payments_split — split payment (เงินสด / PromptPay / ไทยช่วยไทย)
--
-- One bill = 1..n payments. Buckets for accounting:
--   cash            → on-hand cash  (income 'cash',  journal 1000)
--   promptpay       → bank transfer (income 'transfer', journal 1010)
--   thai_chuay_thai → bank transfer (โครงการรัฐโอนเข้าบัญชี — same bucket as promptpay)
--
-- pos_bills.payment_method keeps the single method for 1-payment bills and
-- becomes 'split' for multi-payment bills (display + legacy compat).
-- Each payment row remembers the income_entry it was booked into so void can
-- soft-void every bucket entry (SET NULL keeps ledger rows if income deleted).

BEGIN;

CREATE TABLE IF NOT EXISTS pos_bill_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id          UUID NOT NULL REFERENCES pos_bills(id) ON DELETE CASCADE,
  method           VARCHAR(20) NOT NULL
    CHECK (method IN ('cash', 'promptpay', 'thai_chuay_thai')),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  income_entry_id  UUID REFERENCES income_entries(id) ON DELETE SET NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_bill_payments_bill
  ON pos_bill_payments (bill_id);

-- Widen bill-level method: + thai_chuay_thai + split.
ALTER TABLE pos_bills DROP CONSTRAINT IF EXISTS pos_bills_payment_method_check;
ALTER TABLE pos_bills
  ADD CONSTRAINT pos_bills_payment_method_check
  CHECK (payment_method IN ('cash', 'promptpay', 'thai_chuay_thai', 'split'));

COMMIT;
