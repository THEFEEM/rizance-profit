-- ══════════════════════════════════════════════════════════════════
-- 0099 — account_deletion_requests (A-3.2 FOUNDATION)
--
-- ⚠️ additive ล้วน · ไม่แตะตารางเดิม · ไม่แตะ FK เดิม · ไม่ลบข้อมูลใด ๆ
--
-- ═══ กฎเหล็กข้อเดียวของตารางนี้ ═══════════════════════════════════
--
--   ❌ ห้ามมี FOREIGN KEY ไป public.users เด็ดขาด
--
--   เหตุผล: บันทึกนี้ต้อง **รอดชีวิตหลังแถว users ถูกลบ** ถ้าใส่ FK ไว้
--   มันจะถูก CASCADE ลบไปพร้อมกับสิ่งที่มันพยายามบันทึก — เป็นความผิดพลาด
--   แบบเดียวกับที่ทำให้ hr_audit_logs ใช้เป็นหลักฐานการลบบัญชีไม่ได้
--
--   `user_id` จึงเป็น UUID เปล่า ๆ ไม่มีความสัมพันธ์เชิงโครงสร้าง
--
-- ═══ สิ่งที่ห้ามเก็บในตารางนี้ ═════════════════════════════════════
--   รหัสผ่าน · session JWT · OAuth token · Google ID token ·
--   Stripe secret · reauth proof ดิบ · PII ที่ไม่จำเป็น
--   → เก็บเฉพาะ id · user_id · สถานะ · เวลา · manifest ของไฟล์ · เหตุผลที่ล้ม
--
-- ═══ ขอบเขตของเฟสนี้ ══════════════════════════════════════════════
--   ตารางนี้เป็น "รากฐาน" เท่านั้น — ยังไม่มี endpoint ยังไม่มีปุ่มใน UI
--   ยังไม่มีทางที่ผู้ใช้จริงจะลบบัญชีได้หลัง migration นี้
-- ══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ⚠️ ไม่มี REFERENCES users(id) โดยเจตนา — ดูหัวไฟล์
  user_id               UUID NOT NULL,

  -- วงจรชีวิต (ดู lib/account-deletion.ts เป็นแหล่งความจริงของ transition)
  status                VARCHAR(16) NOT NULL DEFAULT 'requested'
    CONSTRAINT account_deletion_requests_status_check
    CHECK (status IN ('requested', 'db_deleted', 'completed', 'failed')),

  -- ความคืบหน้าการลบไฟล์ใน Supabase Storage (อยู่นอก transaction ของ Postgres)
  storage_status        VARCHAR(16) NOT NULL DEFAULT 'pending'
    CONSTRAINT account_deletion_requests_storage_status_check
    CHECK (storage_status IN ('pending', 'partial', 'done', 'failed')),

  -- รายการ object ที่ต้องลบ เก็บ **ก่อน** แถว DB หาย
  -- รูปแบบ: [{"bucket":"pos-slips","key":"chat/<uuid>/1.jpg","kind":"order_chat"}]
  -- เก็บ object key ไม่ใช่ public URL (URL สร้างกลับได้จาก key แต่ไม่ใช่ทางกลับกัน)
  storage_manifest      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- entry ที่ลบไม่สำเร็จ รอ retry (รูปแบบเดียวกับ manifest)
  storage_failed        JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_object_count  INTEGER NOT NULL DEFAULT 0 CHECK (storage_object_count >= 0),
  storage_deleted_count INTEGER NOT NULL DEFAULT 0 CHECK (storage_deleted_count >= 0),
  storage_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (storage_attempts >= 0),

  -- สรุปจำนวนแถวที่ลบไปในธุรกรรม (ไว้ตรวจย้อนหลัง ไม่ใช่เนื้อหาข้อมูล)
  rows_deleted          JSONB,

  -- เหตุผลที่ล้ม — รหัสเครื่องอ่านได้ + ข้อความสั้น (ห้ามใส่ความลับ)
  failure_code          VARCHAR(48),
  failure_detail        VARCHAR(500),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  db_deleted_at         TIMESTAMPTZ,
  storage_completed_at  TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,

  -- invariant: เข้าสถานะ db_deleted/completed แล้วต้องมีเวลากำกับเสมอ
  CONSTRAINT account_deletion_requests_db_deleted_at_check
    CHECK (status NOT IN ('db_deleted', 'completed') OR db_deleted_at IS NOT NULL),
  CONSTRAINT account_deletion_requests_completed_at_check
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  -- invariant: completed ได้ก็ต่อเมื่อไฟล์จัดการครบแล้ว
  CONSTRAINT account_deletion_requests_completed_storage_check
    CHECK (status <> 'completed' OR storage_status = 'done'),
  CONSTRAINT account_deletion_requests_deleted_count_check
    CHECK (storage_deleted_count <= storage_object_count)
);

-- ═══ idempotency ที่บังคับที่ฐานข้อมูล ═══════════════════════════
-- ผู้ใช้หนึ่งคนมีคำขอที่ "ยังทำงานอยู่" ได้ไม่เกินหนึ่งใบ
--   · กดซ้ำ / ยิงซ้ำ / retry → ชน index นี้ → ต้องกลับไปใช้ใบเดิม
--   · ใบที่ completed/failed ไม่ถูกนับ → เก็บประวัติได้หลายใบ
--
-- ⚠️ POLICY ยังไม่ปิด: จะเก็บใบ completed ไว้กี่ใบต่อผู้ใช้/นานแค่ไหน
--    ยังไม่มีข้อสรุปทางกฎหมาย — index นี้จึงเลือกทางที่แคบและปลอดภัยที่สุด
--    คือ "กันซ้ำเฉพาะใบที่ยังทำงานอยู่" ไม่ตัดสินใจเรื่องการเก็บประวัติ
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_requests_active
  ON account_deletion_requests (user_id)
  WHERE status IN ('requested', 'db_deleted');

-- งานค้างที่ต้อง retry (storage cleanup)
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_pending_storage
  ON account_deletion_requests (status, storage_status, updated_at)
  WHERE status = 'db_deleted';

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user
  ON account_deletion_requests (user_id, created_at DESC);

COMMENT ON TABLE account_deletion_requests IS
  'A-3.2 · บันทึกคำขอลบบัญชี — ห้ามมี FK ไป users เพราะต้องรอดหลัง users ถูกลบ';
COMMENT ON COLUMN account_deletion_requests.user_id IS
  'UUID ของผู้ใช้เดิม · จงใจไม่มี FOREIGN KEY';
COMMENT ON COLUMN account_deletion_requests.storage_manifest IS
  'object key ที่ต้องลบ เก็บก่อนลบ DB · สลิป/แชทมี key ที่สร้างกลับไม่ได้หลัง cascade';

-- ═══ assertion ปิดท้าย — fail-closed ══════════════════════════════
DO $$
DECLARE
  fk_count INT;
BEGIN
  SELECT count(*) INTO fk_count
  FROM pg_constraint c
  JOIN pg_class      chl ON chl.oid = c.conrelid
  JOIN pg_namespace  chn ON chn.oid = chl.relnamespace
  WHERE c.contype = 'f'
    AND chn.nspname = 'public'
    AND chl.relname = 'account_deletion_requests';

  IF fk_count <> 0 THEN
    RAISE EXCEPTION
      '0099 ยกเลิก — account_deletion_requests มี FOREIGN KEY % ตัว ทั้งที่ต้องไม่มีเลย', fk_count;
  END IF;

  RAISE NOTICE '0099 OK — account_deletion_requests พร้อมใช้ และไม่มี FK ใด ๆ';
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน (บนฐานข้อมูลใช้แล้วทิ้งเท่านั้น)
--
-- 1) ต้องไม่มี FK เลย — ต้องได้ 0 แถว
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.account_deletion_requests'::regclass AND contype = 'f';
--
-- 2) FK → users ต้องยังเป็น 92 เท่าเดิม (0099 ไม่เพิ่ม)
-- SELECT count(*) FROM pg_constraint c
-- JOIN pg_class cl ON cl.oid = c.conrelid
-- JOIN pg_namespace n ON n.oid = cl.relnamespace
-- WHERE c.contype='f' AND c.confrelid='public.users'::regclass AND n.nspname='public';
--
-- 3) rollback (เฉพาะฐานทดสอบ)
-- DROP TABLE IF EXISTS account_deletion_requests;
-- ══════════════════════════════════════════════════════════════════
