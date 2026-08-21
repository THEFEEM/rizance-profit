-- แก้งาน reset-stock-ninenon.sql (ไฟล์นั้นเลิกใช้ — อย่ารันซ้ำ)
--
-- ปัญหา: สคริปต์เดิมเทียบชื่อเมนูเป๊ะ ๆ แต่เมนูจริงมี suffix
-- ("Smash Homemade S (เนื้อ 40g)", "Wrap-Z (แรป-ซี) ไก่บด") เลยสร้างเมนูเปล่า
-- ซ้ำขึ้นมา 6 ตัว และผูกสูตรเข้าตัวผิด
--
-- ไฟล์นี้ทำ 4 อย่าง (atomic):
--   1) ลบเมนูเปล่าที่สร้างเกิน — เฉพาะตัวที่ไม่มีหมวด + ไม่เคยมียอดขาย
--      (สูตร/ลิงก์ modifier ของมันหายตามอัตโนมัติ)
--   2) เติมวัตถุดิบที่ขาด: ไก่สามชั้น (สต็อกเริ่ม 0 — ยังไม่รู้ยอด)
--      ตัวอื่นถ้ามีแล้วไม่แตะ ยอดที่ร้านปรับไว้ไม่หาย
--   3) ผูกสูตรเข้าเมนูจริงด้วย pattern — เจอ 0 หรือเกิน 1 ตัว = หยุดทั้งก้อน
--      พร้อมบอกว่า pattern ไหนพัง (กันผูกผิดตัวเงียบ ๆ)
--   4) ผูกกลุ่มเพิ่มชีสเข้าเมนูจริง + ปิด track_stock รายเมนูของ 7 ตัวนี้
--      (นับผ่านวัตถุดิบแทน — ป้าย "เหลือ -6" ที่ Wrap-Z จะหายไป)
--
-- ตามที่ยืนยัน: L ตัดเนื้อ 80g ตามชื่อเมนูปัจจุบัน · Smash ใช้ซอสอย่างละ 20g
-- Wrap-Z / Chicky ใช้ 10+10 · Fries Cheese = เฟรนฟราย 140 + ไก่สามชั้น 20
-- + ซอสชีส 15 + ซอส Homemade 15 + กระปุก 2oz 1
--
-- ⚠️ Fries Cheese: ในระบบไม่เห็นเมนูชื่อนี้ตรง ๆ — สคริปต์จับ "Fries Cheese%"
--    ก่อน ถ้าไม่มีค่อยจับเมนูชื่อ "เฟรนฟราย" เป๊ะ ๆ (ไม่ใช่ เฟรนฟราย+นักเก็ต)
--    ถ้าจริง ๆ คือเมนูอื่น แก้ pattern ในส่วน "สูตร" ก่อนรัน

-- ═══ STEP 0 · อ่านอย่างเดียว — เมนูเปล่าที่จะโดนลบ ═══════════════
SELECT p.id, p.name, p.sell_price
FROM pos_products p
WHERE p.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
  AND p.name IN ('Smash Homemade S','Smash Homemade M','Smash Homemade L',
                 'Wrap-Z ไก่','Wrap-Z เนื้อ','Chicky Cheese')
  AND p.category_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM pos_bill_items bi WHERE bi.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM pos_order_items oi WHERE oi.product_id = p.id);

-- ═══ STEP 1 · แก้ (atomic) ═══════════════════════════════════════

DO $$
DECLARE
  uid UUID;
  ing RECORD;
  rec RECORD;
  pr  RECORD;
  pid UUID;
  iid UUID;
  n   INT;
  gid_cheese  UUID;
  gid_cheese2 UUID;
  mid UUID;

BEGIN
  SELECT id INTO uid FROM users WHERE email = 'ninenon2026@gmail.com';
  IF uid IS NULL THEN RAISE EXCEPTION 'ไม่พบ user ninenon2026@gmail.com'; END IF;

  -- ── 1a. ลบเมนูเปล่าที่สร้างเกิน ──────────────────────────────
  DELETE FROM pos_products p
  WHERE p.user_id = uid
    AND p.name IN ('Smash Homemade S','Smash Homemade M','Smash Homemade L',
                   'Wrap-Z ไก่','Wrap-Z เนื้อ','Chicky Cheese')
    AND p.category_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM pos_bill_items bi WHERE bi.product_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM pos_order_items oi WHERE oi.product_id = p.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'ลบเมนูเปล่า % ตัว', n;

  -- ── 1b. วัตถุดิบ — เติมเฉพาะที่ขาด (ของที่มี+ยอดที่ปรับไว้ ไม่แตะ) ─
  FOR ing IN SELECT * FROM (VALUES
    ('เนื้อ',              'g',    2500,  'วัตถุดิบ'),
    ('ไก่บด',              'g',    1000,  'วัตถุดิบ'),
    ('ไก่สามชั้น',         'g',    0,     'วัตถุดิบ'),
    ('แป้งเบอร์เกอร์',     'ลูก',  47,    'วัตถุดิบ'),
    ('แป้ง Wrap',          'แผ่น', 60,    'วัตถุดิบ'),
    ('ชีสแผ่น',            'แผ่น', 64,    'วัตถุดิบ'),
    ('ชีส',                'g',    1700,  'วัตถุดิบ'),
    ('ซอส Homemade',       'g',    0,     'วัตถุดิบ'),
    ('ซอสชีส',             'g',    0,     'วัตถุดิบ'),
    ('มอสมายองเนส',        'g',    3480,  'วัตถุดิบ'),
    ('ซอสมะเขือเทศ',       'g',    2000,  'วัตถุดิบ'),
    ('เนย',                'g',    800,   'วัตถุดิบ'),
    ('ผักสลัด',            'g',    1000,  'วัตถุดิบ'),
    ('หอมใหญ่',            'g',    10000, 'วัตถุดิบ'),
    ('มะเขือเทศ',          'g',    480,   'วัตถุดิบ'),
    ('เฟรนฟราย',           'g',    500,   'วัตถุดิบ'),
    ('ไข่',                'g',    1100,  'วัตถุดิบ'),
    ('พริกไทย',            'g',    280,   'วัตถุดิบ'),
    ('ออริกาโน่',          'g',    50,    'วัตถุดิบ'),
    ('พริกป่น',            'g',    50,    'วัตถุดิบ'),
    ('กระดาษห่อเบอร์เกอร์','ชิ้น', 113,   'บรรจุภัณฑ์'),
    ('กระดาษห่อ Wrap-Z',   'ชิ้น', 10,    'บรรจุภัณฑ์'),
    ('ถุงกระดาษ',          'ชิ้น', 27,    'บรรจุภัณฑ์'),
    ('ถุงมือ',             'คู่',  98,    'บรรจุภัณฑ์'),
    ('กระปุก 2 oz',        'ใบ',   30,    'บรรจุภัณฑ์')
  ) AS t(name, unit, stock, category)
  LOOP
    INSERT INTO ingredients
      (user_id, name, purchase_quantity, purchase_unit, purchase_price,
       track_stock, stock_qty, category)
    SELECT uid, ing.name, 1, ing.unit, 0, true, ing.stock, ing.category
    WHERE NOT EXISTS (
      SELECT 1 FROM ingredients i WHERE i.user_id = uid AND i.name = ing.name);
  END LOOP;

  -- ── 1c. สูตร → เมนูจริง (จับด้วย pattern · พังถ้าไม่เจอ 1 ตัวเป๊ะ) ─
  -- ผักรวม 45g = ผักสลัด 20 + หอมใหญ่ 15 + มะเขือเทศ 10
  FOR rec IN SELECT * FROM (VALUES
    -- Smash Homemade S (เนื้อ 40g)
    ('Smash Homemade S%', 'เนื้อ',                40),
    ('Smash Homemade S%', 'แป้งเบอร์เกอร์',       1),
    ('Smash Homemade S%', 'ซอส Homemade',         20),
    ('Smash Homemade S%', 'ซอสชีส',               20),
    ('Smash Homemade S%', 'เนย',                  5),
    ('Smash Homemade S%', 'ผักสลัด',              20),
    ('Smash Homemade S%', 'หอมใหญ่',              15),
    ('Smash Homemade S%', 'มะเขือเทศ',            10),
    ('Smash Homemade S%', 'กระดาษห่อเบอร์เกอร์',  1),
    ('Smash Homemade S%', 'ถุงกระดาษ',            1),
    -- Smash Homemade M (เนื้อ 60g)
    ('Smash Homemade M%', 'เนื้อ',                60),
    ('Smash Homemade M%', 'แป้งเบอร์เกอร์',       1),
    ('Smash Homemade M%', 'ซอส Homemade',         20),
    ('Smash Homemade M%', 'ซอสชีส',               20),
    ('Smash Homemade M%', 'เนย',                  5),
    ('Smash Homemade M%', 'ผักสลัด',              20),
    ('Smash Homemade M%', 'หอมใหญ่',              15),
    ('Smash Homemade M%', 'มะเขือเทศ',            10),
    ('Smash Homemade M%', 'กระดาษห่อเบอร์เกอร์',  1),
    ('Smash Homemade M%', 'ถุงกระดาษ',            1),
    -- Smash Homemade L (เนื้อ 80g) — 80 ตามชื่อเมนู (ยืนยันแล้ว)
    ('Smash Homemade L%', 'เนื้อ',                80),
    ('Smash Homemade L%', 'แป้งเบอร์เกอร์',       1),
    ('Smash Homemade L%', 'ซอส Homemade',         20),
    ('Smash Homemade L%', 'ซอสชีส',               20),
    ('Smash Homemade L%', 'เนย',                  5),
    ('Smash Homemade L%', 'ผักสลัด',              20),
    ('Smash Homemade L%', 'หอมใหญ่',              15),
    ('Smash Homemade L%', 'มะเขือเทศ',            10),
    ('Smash Homemade L%', 'กระดาษห่อเบอร์เกอร์',  1),
    ('Smash Homemade L%', 'ถุงกระดาษ',            1),
    -- Wrap-Z (แรป-ซี) ไก่บด
    ('Wrap-Z%ไก่%', 'แป้ง Wrap',                  1),
    ('Wrap-Z%ไก่%', 'ไก่บด',                      40),
    ('Wrap-Z%ไก่%', 'ซอส Homemade',               10),
    ('Wrap-Z%ไก่%', 'ซอสชีส',                     10),
    ('Wrap-Z%ไก่%', 'ผักสลัด',                    20),
    ('Wrap-Z%ไก่%', 'หอมใหญ่',                    15),
    ('Wrap-Z%ไก่%', 'มะเขือเทศ',                  10),
    ('Wrap-Z%ไก่%', 'กระดาษห่อ Wrap-Z',           1),
    -- Wrap-Z (แรป-ซี) เนื้อ
    ('Wrap-Z%เนื้อ%', 'แป้ง Wrap',                1),
    ('Wrap-Z%เนื้อ%', 'เนื้อ',                    40),
    ('Wrap-Z%เนื้อ%', 'ซอส Homemade',             10),
    ('Wrap-Z%เนื้อ%', 'ซอสชีส',                   10),
    ('Wrap-Z%เนื้อ%', 'ผักสลัด',                  20),
    ('Wrap-Z%เนื้อ%', 'หอมใหญ่',                  15),
    ('Wrap-Z%เนื้อ%', 'มะเขือเทศ',                10),
    ('Wrap-Z%เนื้อ%', 'กระดาษห่อ Wrap-Z',         1),
    -- Chicky Cheese (ไก่ 50g)
    ('Chicky Cheese%', 'ไก่บด',                   50),
    ('Chicky Cheese%', 'แป้งเบอร์เกอร์',          1),
    ('Chicky Cheese%', 'ชีสแผ่น',                 1),
    ('Chicky Cheese%', 'ซอส Homemade',            10),
    ('Chicky Cheese%', 'ซอสชีส',                  10),
    ('Chicky Cheese%', 'กระดาษห่อเบอร์เกอร์',     1),
    ('Chicky Cheese%', 'ถุงกระดาษ',               1),
    -- Fries Cheese (ดูหมายเหตุหัวไฟล์เรื่อง pattern)
    ('@FRIES',         'เฟรนฟราย',                140),
    ('@FRIES',         'ไก่สามชั้น',              20),
    ('@FRIES',         'ซอสชีส',                  15),
    ('@FRIES',         'ซอส Homemade',            15),
    ('@FRIES',         'กระปุก 2 oz',             1)
  ) AS t(pattern, ingredient, qty)
  LOOP
    IF rec.pattern = '@FRIES' THEN
      -- ลอง "Fries Cheese%" ก่อน ไม่มีค่อยใช้เมนูชื่อ "เฟรนฟราย" เป๊ะ
      SELECT COUNT(*), MIN(id::text)::uuid INTO n, pid FROM pos_products
        WHERE user_id = uid AND name ILIKE 'Fries Cheese%';
      IF n = 0 THEN
        SELECT COUNT(*), MIN(id::text)::uuid INTO n, pid FROM pos_products
          WHERE user_id = uid AND name = 'เฟรนฟราย';
      END IF;
    ELSE
      SELECT COUNT(*), MIN(id::text)::uuid INTO n, pid FROM pos_products
        WHERE user_id = uid AND name ILIKE rec.pattern;
    END IF;
    IF n <> 1 THEN
      RAISE EXCEPTION 'pattern "%" เจอเมนู % ตัว (ต้อง 1) — ตรวจชื่อเมนูก่อน',
        rec.pattern, n;
    END IF;

    SELECT id INTO iid FROM ingredients
      WHERE user_id = uid AND name = rec.ingredient;
    IF iid IS NULL THEN
      RAISE EXCEPTION 'ไม่พบวัตถุดิบ %', rec.ingredient;
    END IF;

    INSERT INTO pos_product_ingredients (product_id, ingredient_id, quantity)
    VALUES (pid, iid, rec.qty)
    ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity;

    -- นับสต็อกผ่านวัตถุดิบแทน — ปิดตัวนับรายเมนู (ป้าย "เหลือ -6" หาย)
    UPDATE pos_products SET track_stock = false WHERE id = pid AND track_stock;
  END LOOP;

  -- ── 1d. เพิ่มชีส +10 → เมนูจริง ──────────────────────────────
  SELECT id INTO gid_cheese FROM pos_modifier_groups
    WHERE user_id = uid AND name = 'เพิ่มชีส';
  IF gid_cheese IS NULL THEN
    INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select)
    VALUES (uid, 'เพิ่มชีส', 0, 1) RETURNING id INTO gid_cheese;
  END IF;
  SELECT id INTO gid_cheese2 FROM pos_modifier_groups
    WHERE user_id = uid AND name = 'เพิ่มชีส ×2';
  IF gid_cheese2 IS NULL THEN
    INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select)
    VALUES (uid, 'เพิ่มชีส ×2', 0, 1) RETURNING id INTO gid_cheese2;
  END IF;

  SELECT id INTO iid FROM ingredients WHERE user_id = uid AND name = 'ชีสแผ่น';

  SELECT id INTO mid FROM pos_modifiers
    WHERE group_id = gid_cheese AND name = 'เพิ่มชีส';
  IF mid IS NULL THEN
    INSERT INTO pos_modifiers (group_id, name, price_delta)
    VALUES (gid_cheese, 'เพิ่มชีส', 10) RETURNING id INTO mid;
  END IF;
  INSERT INTO pos_modifier_ingredients (modifier_id, ingredient_id, quantity)
  VALUES (mid, iid, 1)
  ON CONFLICT (modifier_id, ingredient_id) DO UPDATE SET quantity = 1;

  SELECT id INTO mid FROM pos_modifiers
    WHERE group_id = gid_cheese2 AND name = 'เพิ่มชีส';
  IF mid IS NULL THEN
    INSERT INTO pos_modifiers (group_id, name, price_delta)
    VALUES (gid_cheese2, 'เพิ่มชีส', 10) RETURNING id INTO mid;
  END IF;
  INSERT INTO pos_modifier_ingredients (modifier_id, ingredient_id, quantity)
  VALUES (mid, iid, 2)
  ON CONFLICT (modifier_id, ingredient_id) DO UPDATE SET quantity = 2;

  -- S / M / Wrap ×2 → เพิ่มชีส · L → เพิ่มชีส ×2 (ตัด 2 แผ่น)
  FOR pr IN SELECT * FROM (VALUES
    ('Smash Homemade S%'), ('Smash Homemade M%'),
    ('Wrap-Z%ไก่%'), ('Wrap-Z%เนื้อ%')
  ) AS t(pattern)
  LOOP
    SELECT id INTO pid FROM pos_products
      WHERE user_id = uid AND name ILIKE pr.pattern;
    INSERT INTO pos_product_modifier_groups (product_id, group_id)
    VALUES (pid, gid_cheese) ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT id INTO pid FROM pos_products
    WHERE user_id = uid AND name ILIKE 'Smash Homemade L%';
  INSERT INTO pos_product_modifier_groups (product_id, group_id)
  VALUES (pid, gid_cheese2) ON CONFLICT DO NOTHING;
END $$;

-- ═══ STEP 2 · ตรวจหลังรัน ═══════════════════════════════════════

-- 2a) สูตรต้องอยู่บนเมนูจริง (ชื่อมี suffix) — คาดหวัง:
--     Smash S/M/L = 10 · Wrap-Z ×2 = 8 · Chicky = 7 · เฟรนฟราย/Fries = 5
SELECT p.name, COUNT(*) AS recipe_lines
FROM pos_products p
JOIN pos_product_ingredients pi ON pi.product_id = p.id
WHERE p.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
GROUP BY p.name ORDER BY p.name;

-- 2b) เมนูเปล่าต้องหายหมด — ต้องได้ 0 แถว
SELECT name FROM pos_products
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
  AND name IN ('Smash Homemade S','Smash Homemade M','Smash Homemade L',
               'Wrap-Z ไก่','Wrap-Z เนื้อ','Chicky Cheese')
  AND category_id IS NULL;

-- 2c) เพิ่มชีสผูกถูกตัว — L ต้องตัด 2 แผ่น ที่เหลือ 1
SELECT p.name AS product, g.name AS grp, m.price_delta, mi.quantity AS slices
FROM pos_product_modifier_groups pg
JOIN pos_products p        ON p.id = pg.product_id
JOIN pos_modifier_groups g ON g.id = pg.group_id
JOIN pos_modifiers m       ON m.group_id = g.id
JOIN pos_modifier_ingredients mi ON mi.modifier_id = m.id
WHERE p.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
  AND g.name LIKE 'เพิ่มชีส%'
ORDER BY p.name;

-- 2d) วัตถุดิบครบ 25 (24 เดิม + ไก่สามชั้น) — ยอดที่ร้านปรับไว้ต้องไม่เปลี่ยน
SELECT name, stock_qty, purchase_unit AS unit, category
FROM ingredients
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
ORDER BY category, name;
