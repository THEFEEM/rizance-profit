-- seed-ninenon-ingredients — วัตถุดิบ + บรรจุภัณฑ์ 23 รายการ (ราคาจดจริง 29 ก.ค. 2569)
-- ร้าน: ninenon2026@gmail.com
--
-- ⚠️ ไม่ใช่ migration — เป็น seed data รันครั้งเดียวใน SQL Editor (รีวิวก่อนรัน)
-- Idempotent: มีชื่อซ้ำของ user นี้อยู่แล้ว → ข้าม (NOT EXISTS) ไม่ทับของเดิม
--   → ขนมปังเบอร์เกอร์ / ชีส / เนื้อบด ที่มีอยู่แล้วในคลังจะไม่ถูกแตะ
--
-- หน่วยที่เดาให้ (แก้ทีหลังได้ในหน้าคลัง → แก้ไข):
--   ราคา "ต่อ 1 หน่วยซื้อ" ตามที่จดมา · stock เริ่ม 0 (ไปตลาดครั้งหน้าค่อยรับของเข้า)
--   last_purchase_price ตั้งไว้เลย → โหมดไปตลาด prefill ราคาให้ทันที

DO $$
DECLARE
  uid UUID;
BEGIN
  SELECT id INTO uid FROM users WHERE email = 'ninenon2026@gmail.com';
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ user ninenon2026@gmail.com';
  END IF;

  INSERT INTO ingredients
    (user_id, name, purchase_quantity, purchase_unit, purchase_price,
     category, track_stock, stock_qty, last_purchase_price, last_purchased_at)
  SELECT uid, v.name, v.qty, v.unit, v.price, v.category, true, 0, v.price, now()
  FROM (VALUES
    -- ── เนื้อ/ของสด ────────────────────────────────────────────
    ('แป้งเบอร์เกอร์',        1::numeric, 'piece', 25::numeric,  'ขนมปัง'),
    ('นักเก็ตไก่',            1,          'kg',    108,          'เนื้อ/ของสด'),
    ('เนื้อแผ่น',             1,          'kg',    135,          'เนื้อ/ของสด'),
    ('ไก่บด',                 1,          'kg',    83,           'เนื้อ/ของสด'),
    ('ไก่กรอบสาหร่าย',        1,          'kg',    92,           'เนื้อ/ของสด'),
    ('ไก่ 3 ชั้น',            1,          'kg',    96,           'เนื้อ/ของสด'),
    ('แป้งเคบับ',             1,          'piece', 74,           'ขนมปัง'),
    -- ── ชีส/นม ─────────────────────────────────────────────────
    ('ชีสแผ่น',               1,          'kg',    287,          'ชีส/นม'),
    ('เนยเหลือง',             1,          'kg',    73,           'ชีส/นม'),
    ('นมสดคาเนชั่น',          1,          'l',     67,           'ชีส/นม'),
    -- ── ผัก ────────────────────────────────────────────────────
    ('แตงกวาดอง',             1,          'kg',    98,           'ผัก'),
    ('หอมใหญ่ (กระสอบ)',      1,          'piece', 250,          'ผัก'),
    -- ── ซอส/เครื่องปรุง ────────────────────────────────────────
    ('ซอสชีส',                1,          'kg',    75,           'ซอส/เครื่องปรุง'),
    ('ซอสมะเขือเทศ',          1,          'kg',    45,           'ซอส/เครื่องปรุง'),
    ('มายองเนสตราลิลลี่',     1,          'kg',    48,           'ซอส/เครื่องปรุง'),
    ('มายองบอย',              1,          'kg',    175,          'ซอส/เครื่องปรุง'),
    ('น้ำมัน',                1,          'l',     48,           'ซอส/เครื่องปรุง'),
    -- ── บรรจุภัณฑ์/สิ้นเปลือง ──────────────────────────────────
    ('กระดาษห่อแรปซี',        1,          'piece', 47,           'บรรจุภัณฑ์'),
    ('ถุงกระดาษ',             1,          'piece', 95,           'บรรจุภัณฑ์'),
    ('ถุงหิ้ว',               1,          'piece', 40,           'บรรจุภัณฑ์'),
    ('ถุงมือ (100 ชิ้น)',     1,          'piece', 120,          'บรรจุภัณฑ์'),
    ('ทิชชู่',                1,          'piece', 100,          'บรรจุภัณฑ์')
  ) AS v(name, qty, unit, price, category)
  WHERE NOT EXISTS (
    SELECT 1 FROM ingredients i WHERE i.user_id = uid AND i.name = v.name
  );

  -- เนื้อบด 240/กก. มีอยู่แล้วในคลัง → อัปเดตแค่ราคาซื้อล่าสุด (ไม่แตะ stock/avg_cost)
  UPDATE ingredients
  SET last_purchase_price = 240, purchase_price = 240, purchase_quantity = 1,
      updated_at = now()
  WHERE user_id = uid AND name = 'เนื้อบด';

  RAISE NOTICE 'seed เสร็จ — เพิ่มเฉพาะตัวที่ยังไม่มี';
END $$;

-- ตรวจผล: ควรเห็น ~25 รายการ จัดหมวดครบ
SELECT name, purchase_quantity || ' ' || purchase_unit AS หน่วย,
       purchase_price AS ราคา, category
FROM ingredients
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
ORDER BY category, name;
