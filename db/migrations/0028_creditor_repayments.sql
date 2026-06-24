-- 0028_creditor_repayments — shop creditor repayment tracking (1B)
-- จ่ายคืนเจ้าหนี้ที่ออกเงินแทนร้าน (advance) — manual, หักเงินคงเหลือ
-- ผูกกับ (payer_kind, payer_name) เพราะ 1A group ด้วย 2 ฟิลด์นี้ (ไม่มี creditor id)
-- payment_method: เงินที่ใช้คืน (cash/transfer) — หักจาก on-hand ช่องนั้น
BEGIN;

CREATE TABLE IF NOT EXISTS creditor_repayments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_kind      VARCHAR(20) NOT NULL CHECK (payer_kind IN ('member', 'external')),
  payer_name      VARCHAR(160) NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method  VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  note            VARCHAR(255),
  entry_date      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creditor_repayments_user
  ON creditor_repayments (user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_creditor_repayments_creditor
  ON creditor_repayments (user_id, payer_kind, payer_name);

COMMIT;
