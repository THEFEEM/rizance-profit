-- 0061_pos_riders — โหมดไรเดอร์ (คนไปส่งของ ไม่ต้องล็อกอิน POS)
--
-- ที่มา: NINENON ให้ "ผู้จัดการ" เป็นคนขับไปส่งเอง ต้องเห็นเฉพาะงานส่ง
--        ไม่ต้องเปิดแอป POS ทั้งตัว → ลิงก์ส่วนตัวต่อคน (revoke ได้รายคน)
--
-- โมเดล:
--   pos_riders            = ทะเบียนคนส่ง (ตารางกลางแบบ employees → ไม่มี branch_id)
--   pos_riders.access_token = ลิงก์ส่วนตัว /r/<token> (UUID เดาไม่ได้ · หมุนใหม่ได้)
--   pos_orders.rider_id   = ใครรับงานนี้ไปส่ง (คนแรกที่กด "รับงาน" ได้ไป)
--
-- ⚠️ บัญชี: ไรเดอร์กด "ส่งสำเร็จ" → เรียก closePosBill ตัวเดิมทุกประการ
--    (payments = [{ method: cash|promptpay, amount: total }])
--    → SUM(bill_items.line_total) = bills.total_amount = debit = credit ยังจริง
--    ไม่มี journal ใหม่ ไม่มี account ใหม่ ไม่แตะ posting adapter
--
-- 💵 เงินสดปลายทาง: บิลลงเป็น "เงินสด" ทันทีที่ส่งถึง แต่ตัวเงินยังอยู่กับคนส่ง
--    cash_settled_at = ตอนที่คนส่งเอาเงินมาคืนหน้าร้านแล้ว
--    → เป็นแค่ตัวกระทบยอด (reconciliation) ไม่ลง journal ซ้ำ
--    → ยอดค้าง = SUM(total) ของ delivered ที่ยังไม่ settled ต่อไรเดอร์

BEGIN;

-- ── ทะเบียนคนส่ง ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_riders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(80) NOT NULL,
  phone        VARCHAR(20),
  access_token UUID NOT NULL DEFAULT gen_random_uuid(),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_riders_access_token
  ON pos_riders (access_token);
CREATE INDEX IF NOT EXISTS idx_pos_riders_user
  ON pos_riders (user_id, is_active, created_at);

-- ── งานส่งผูกกับคนส่ง ───────────────────────────────────────────
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS rider_id UUID REFERENCES pos_riders(id) ON DELETE SET NULL;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS picked_up_at    TIMESTAMPTZ;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS delivered_at    TIMESTAMPTZ;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS cash_settled_at TIMESTAMPTZ;

-- งานที่ยังต้องส่ง + ยอดเงินสดค้างต่อไรเดอร์ (สองเคสหลักของหน้าไรเดอร์)
CREATE INDEX IF NOT EXISTS idx_pos_orders_rider
  ON pos_orders (rider_id, status, created_at DESC)
  WHERE rider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_orders_delivery_open
  ON pos_orders (user_id, status, created_at)
  WHERE order_type = 'delivery';

-- ── แจ้งเตือนคนส่งบนมือถือ (ผูกกับ rider ไม่ใช่ order) ──────────
CREATE TABLE IF NOT EXISTS pos_rider_push_subs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id   UUID NOT NULL REFERENCES pos_riders(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_pos_rider_push_subs_rider
  ON pos_rider_push_subs (rider_id);

COMMIT;
