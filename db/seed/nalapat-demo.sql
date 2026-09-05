-- db/seed/nalapat-demo.sql — Demo campaign สำหรับ DEVELOPMENT เท่านั้น (สเปก §29)
--
-- ⚠️ ไม่ใช่ migration · ไม่รันอัตโนมัติ · ห้ามรันบน production
-- วิธีใช้: แทน :user_id ด้วย users.id ของร้าน dev แล้วรันใน psql/SQL editor
--
-- สร้าง: แคมเปญ NALAPAT 2026 · ฿69 · 8 ก.ย. – 8 ต.ค. 2569 · status=active
-- ⚠️ ไม่สร้างใบ voucher ที่นี่ — เพราะ raw token ต้องมาจาก generateVouchers() (ฟังก์ชันคืนครั้งเดียว)
--    ให้กด Generate 3 ใบจากหน้า /marketing/vouchers/<id> แทน

\set user_id '00000000-0000-0000-0000-000000000000'

INSERT INTO pos_voucher_campaigns
  (user_id, name, description, sponsor, voucher_type, value, quantity_planned,
   start_at, expires_at, status, code_prefix, terms, design_config)
SELECT
  :'user_id'::uuid,
  'NALAPAT 2026',
  'Gift voucher โครงการ NALAPAT — ใช้ได้ที่ NINENON BURGER',
  'NALAPAT',
  'fixed_amount',
  69.00,
  3,
  '2026-09-08 00:00:00+07',
  '2026-10-08 23:59:59+07',
  'active',
  'NAL26',
  E'ใช้ได้ 1 ครั้งต่อใบ\nไม่มีเงินทอน ไม่แลกเป็นเงินสด\nใช้ร่วมกับส่วนลดอื่นไม่ได้\nใช้ได้ถึง 8 ต.ค. 2569',
  '{"template":"event","primaryColor":"#16368f","backgroundColor":"#ffffff","showSponsor":true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM pos_voucher_campaigns WHERE user_id = :'user_id'::uuid AND code_prefix = 'NAL26'
);

INSERT INTO pos_voucher_events (user_id, campaign_id, actor, action, detail)
SELECT user_id, id, 'system', 'campaign_created', '{"seed":"nalapat-demo"}'::jsonb
FROM pos_voucher_campaigns
WHERE user_id = :'user_id'::uuid AND code_prefix = 'NAL26'
  AND NOT EXISTS (SELECT 1 FROM pos_voucher_events e WHERE e.campaign_id = pos_voucher_campaigns.id);

-- ตรวจ
-- SELECT id, name, value, status, code_prefix FROM pos_voucher_campaigns WHERE code_prefix = 'NAL26';
