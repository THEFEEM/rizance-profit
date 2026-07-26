-- 0057_pos_prepay_slip_push — ลูกค้า QR โอนก่อน + แนบสลิป, และ push แจ้งเตือนมือถือ
--
-- ⚠️ ไม่มีผลต่อบัญชี: การอัปโหลดสลิป "ไม่" สร้างรายรับ/journal
--    รายรับยังเกิดตอนพนักงานปิดบิล (closeBill) เหมือนเดิมทุกกรณี
--    → invariant SUM(bill_items.line_total) = total_amount = debit = credit ไม่ขยับ
--    slip_verified_at เป็นแค่ "ร้านตรวจสลิปแล้ว" ไม่ใช่การรับรู้รายได้
--
-- payment_intent:
--   'at_shop'          = จ่ายที่ร้านตอนมารับ (พฤติกรรมเดิมทั้งหมด)
--   'prepaid_transfer' = ลูกค้าโอนมาก่อน แล้วแนบสลิป
--
-- pos_order_push_subs: ลูกค้าไม่มีบัญชี → ผูก subscription กับ order โดยตรง
--   ลบตามออเดอร์ (CASCADE) และหมดอายุเองเมื่อออเดอร์ถูกล้าง

BEGIN;

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS payment_intent VARCHAR(20) NOT NULL DEFAULT 'at_shop';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_payment_intent_check'
  ) THEN
    ALTER TABLE pos_orders
      ADD CONSTRAINT pos_orders_payment_intent_check
      CHECK (payment_intent IN ('at_shop', 'prepaid_transfer'));
  END IF;
END $$;

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS slip_url             TEXT;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS slip_uploaded_at     TIMESTAMPTZ;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS slip_verified_at     TIMESTAMPTZ;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS slip_rejected_reason VARCHAR(200);

-- คิวงาน "รอตรวจสลิป" — index เฉพาะแถวที่ยังไม่ตรวจ
CREATE INDEX IF NOT EXISTS idx_pos_orders_slip_pending
  ON pos_orders (user_id, slip_uploaded_at DESC)
  WHERE slip_uploaded_at IS NOT NULL AND slip_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS pos_order_push_subs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_pos_order_push_subs_order
  ON pos_order_push_subs (order_id);

COMMIT;
