-- Reset + Seed สต็อก NINENON BURGER (ninenon2026@gmail.com) — 21 ส.ค. 2569
--
-- ทำอะไร: ลบวัตถุดิบเก่า + ประวัติ movement + สูตรเก่าทั้งหมด แล้วลงใหม่
--   วัตถุดิบ 19 + บรรจุภัณฑ์ 5 = 24 รายการ · สูตร 6 เมนู (53 บรรทัด)
--   modifier เพิ่มชีส +10 (ตัดชีสแผ่น 1) และเพิ่มชีส ×2 สำหรับ L (ตัด 2)
--
-- ⚠️ รันครั้งเดียว — รันซ้ำได้ผลลัพธ์เท่าเดิม แต่ movement จากการขายจริง
--    ระหว่างนั้นจะถูกล้างไปด้วย (เพราะขั้น wipe ลบทุกอย่างก่อนลงใหม่)
--
-- ═══ จุดที่ต้องรีวิวก่อนรัน ═══════════════════════════════════════
-- 1) ปริมาณซอส: ตามคำตอบล่าสุด เบอร์เกอร์ Smash ใช้ ซอส Homemade 20g +
--    ซอสชีส 20g ต่อลูก (สเปคแรกเขียน 10+10) · Wrap-Z ใช้ 10+10 ตามสเปคแรก
--    Chicky ใช้ 10+10 ตามที่ยืนยัน — ถ้าไม่ใช่ แก้เลข VALUES ในส่วน "สูตร"
-- 2) ผักรวม 45g แตกเป็น ผักสลัด 20 + หอมใหญ่ 15 + มะเขือเทศ 10 — ปรับได้
-- 3) ซอส Homemade / ซอสชีส ตั้งสต็อกเริ่ม 0 (ยังไม่รู้ยอด) — ร้านกดรับเข้า
--    ในหน้าสต็อกเมื่อรู้ยอดจริง ระหว่างนี้ยอดจะติดลบตามการขาย (ตั้งใจ:
--    ติดลบ = ปริมาณที่ใช้ไปจริง เอาไว้ทวนตอนนับของ)
-- 4) STEP 0 เช็คชื่อเมนูในระบบก่อน — สูตรผูกด้วยชื่อเป๊ะ ๆ 6 ชื่อนี้:
--    Smash Homemade S / M / L · Wrap-Z ไก่ · Wrap-Z เนื้อ · Chicky Cheese
--    ถ้าในระบบสะกดต่าง (เช่น "Smash S") ให้แก้ชื่อในเมนูหรือในไฟล์นี้
--    ให้ตรงกันก่อน ไม่งั้นจะได้เมนูซ้ำสองอัน

-- ═══ STEP 0 · อ่านอย่างเดียว — ดูของเดิมก่อนตัดสินใจ ═══════════════

SELECT name, sell_price, is_active
FROM pos_products
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
  AND (name ILIKE '%smash%' OR name ILIKE '%wrap%' OR name ILIKE '%chicky%')
ORDER BY name;

SELECT COUNT(*) AS old_ingredients,
       (SELECT COUNT(*) FROM ingredient_stock_movements
        WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com'))
       AS old_movements
FROM ingredients
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com');

-- ═══ STEP 1 · wipe + seed (atomic — พังตรงไหน rollback ทั้งก้อน) ═══

DO $$
DECLARE
  uid UUID;
  ing RECORD;
  rec RECORD;
  prod RECORD;
  pid UUID;
  iid UUID;
  gid_cheese  UUID;  -- กลุ่ม "เพิ่มชีส"     (+ชีสแผ่น 1)
  gid_cheese2 UUID;  -- กลุ่ม "เพิ่มชีส ×2"  (+ชีสแผ่น 2 — เฉพาะ L)
  mid UUID;
BEGIN
  SELECT id INTO uid FROM users WHERE email = 'ninenon2026@gmail.com';
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ user ninenon2026@gmail.com';
  END IF;

  -- ── 1a. ล้างของเก่า ──────────────────────────────────────────
  DELETE FROM ingredient_stock_movements WHERE user_id = uid;
  DELETE FROM pos_product_ingredients
    WHERE product_id IN (SELECT id FROM pos_products WHERE user_id = uid);
  DELETE FROM pos_modifier_ingredients
    WHERE modifier_id IN (
      SELECT m.id FROM pos_modifiers m
      JOIN pos_modifier_groups g ON g.id = m.group_id
      WHERE g.user_id = uid);
  -- สูตรโหมดคิดราคา (pricing) อ้าง ingredients แบบ RESTRICT — ต้องล้างก่อน
  DELETE FROM recipe_items
    WHERE ingredient_id IN (SELECT id FROM ingredients WHERE user_id = uid);
  DELETE FROM ingredients WHERE user_id = uid;

  -- ── 1b. วัตถุดิบ + บรรจุภัณฑ์ (สต็อกตามนับจริง) ─────────────
  -- หน่วยชั่งใช้ g ทั้งหมด (10 kg → 10000 g) เพราะสูตรตัดเป็น g
  -- ราคาซื้อใส่ 0 ไว้ก่อน — ร้านกรอกผ่าน "โหมดไปตลาด" แล้ว avg_cost คิดเอง
  FOR ing IN SELECT * FROM (VALUES
    -- name              unit      stock     category
    ('เนื้อ',            'g',      2500,     'วัตถุดิบ'),
    ('ไก่บด',            'g',      1000,     'วัตถุดิบ'),
    ('แป้งเบอร์เกอร์',   'ลูก',    47,       'วัตถุดิบ'),
    ('แป้ง Wrap',        'แผ่น',   60,       'วัตถุดิบ'),
    ('ชีสแผ่น',          'แผ่น',   64,       'วัตถุดิบ'),
    ('ชีส',              'g',      1700,     'วัตถุดิบ'),
    ('ซอส Homemade',     'g',      0,        'วัตถุดิบ'),
    ('ซอสชีส',           'g',      0,        'วัตถุดิบ'),
    ('มอสมายองเนส',      'g',      3480,     'วัตถุดิบ'),
    ('ซอสมะเขือเทศ',     'g',      2000,     'วัตถุดิบ'),
    ('เนย',              'g',      800,      'วัตถุดิบ'),
    ('ผักสลัด',          'g',      1000,     'วัตถุดิบ'),
    ('หอมใหญ่',          'g',      10000,    'วัตถุดิบ'),
    ('มะเขือเทศ',        'g',      480,      'วัตถุดิบ'),
    ('เฟรนฟราย',         'g',      500,      'วัตถุดิบ'),
    ('ไข่',              'g',      1100,     'วัตถุดิบ'),
    ('พริกไทย',          'g',      280,      'วัตถุดิบ'),
    ('ออริกาโน่',        'g',      50,       'วัตถุดิบ'),
    ('พริกป่น',          'g',      50,       'วัตถุดิบ'),
    ('กระดาษห่อเบอร์เกอร์','ชิ้น', 113,      'บรรจุภัณฑ์'),
    ('กระดาษห่อ Wrap-Z', 'ชิ้น',   10,       'บรรจุภัณฑ์'),
    ('ถุงกระดาษ',        'ชิ้น',   27,       'บรรจุภัณฑ์'),
    ('ถุงมือ',           'คู่',    98,       'บรรจุภัณฑ์'),
    ('กระปุก 2 oz',      'ใบ',     30,       'บรรจุภัณฑ์')
  ) AS t(name, unit, stock, category)
  LOOP
    INSERT INTO ingredients
      (user_id, name, purchase_quantity, purchase_unit, purchase_price,
       track_stock, stock_qty, category)
    VALUES (uid, ing.name, 1, ing.unit, 0, true, ing.stock, ing.category);
  END LOOP;

  -- ── 1c. เมนู 6 ตัว — มีอยู่แล้วใช้ตัวเดิม ไม่มีค่อยสร้าง ────
  FOR prod IN SELECT * FROM (VALUES
    ('Smash Homemade S', 59),
    ('Smash Homemade M', 69),
    ('Smash Homemade L', 99),
    ('Wrap-Z ไก่',       55),
    ('Wrap-Z เนื้อ',     65),
    ('Chicky Cheese',    59)
  ) AS t(name, price)
  LOOP
    INSERT INTO pos_products (user_id, name, sell_price, track_stock)
    SELECT uid, prod.name, prod.price, false
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_products p WHERE p.user_id = uid AND p.name = prod.name
    );
    -- ⚠️ ตั้งใจไม่แก้ราคาเมนูที่มีอยู่แล้ว — STEP 2 จะโชว์ถ้าราคาไม่ตรง
  END LOOP;

  -- ── 1d. สูตรต่อ 1 หน่วยขาย ───────────────────────────────────
  -- ผักรวม 45g = ผักสลัด 20 + หอมใหญ่ 15 + มะเขือเทศ 10
  -- ชีสแผ่นไม่อยู่ในสูตรหลัก (ยกเว้น Chicky) — ตัดผ่าน modifier เพิ่มชีส
  FOR rec IN SELECT * FROM (VALUES
    -- Smash Homemade S (ซอสอย่างละ 20g ตามคำยืนยันล่าสุด)
    ('Smash Homemade S', 'เนื้อ',                40),
    ('Smash Homemade S', 'แป้งเบอร์เกอร์',       1),
    ('Smash Homemade S', 'ซอส Homemade',         20),
    ('Smash Homemade S', 'ซอสชีส',               20),
    ('Smash Homemade S', 'เนย',                  5),
    ('Smash Homemade S', 'ผักสลัด',              20),
    ('Smash Homemade S', 'หอมใหญ่',              15),
    ('Smash Homemade S', 'มะเขือเทศ',            10),
    ('Smash Homemade S', 'กระดาษห่อเบอร์เกอร์',  1),
    ('Smash Homemade S', 'ถุงกระดาษ',            1),
    -- Smash Homemade M
    ('Smash Homemade M', 'เนื้อ',                60),
    ('Smash Homemade M', 'แป้งเบอร์เกอร์',       1),
    ('Smash Homemade M', 'ซอส Homemade',         20),
    ('Smash Homemade M', 'ซอสชีส',               20),
    ('Smash Homemade M', 'เนย',                  5),
    ('Smash Homemade M', 'ผักสลัด',              20),
    ('Smash Homemade M', 'หอมใหญ่',              15),
    ('Smash Homemade M', 'มะเขือเทศ',            10),
    ('Smash Homemade M', 'กระดาษห่อเบอร์เกอร์',  1),
    ('Smash Homemade M', 'ถุงกระดาษ',            1),
    -- Smash Homemade L
    ('Smash Homemade L', 'เนื้อ',                100),
    ('Smash Homemade L', 'แป้งเบอร์เกอร์',       1),
    ('Smash Homemade L', 'ซอส Homemade',         20),
    ('Smash Homemade L', 'ซอสชีส',               20),
    ('Smash Homemade L', 'เนย',                  5),
    ('Smash Homemade L', 'ผักสลัด',              20),
    ('Smash Homemade L', 'หอมใหญ่',              15),
    ('Smash Homemade L', 'มะเขือเทศ',            10),
    ('Smash Homemade L', 'กระดาษห่อเบอร์เกอร์',  1),
    ('Smash Homemade L', 'ถุงกระดาษ',            1),
    -- Wrap-Z ไก่ (ซอส 10+10 ตามสเปคแรก · ไม่มีเนย/ถุงกระดาษในสเปค)
    ('Wrap-Z ไก่', 'แป้ง Wrap',                  1),
    ('Wrap-Z ไก่', 'ไก่บด',                      40),
    ('Wrap-Z ไก่', 'ซอส Homemade',               10),
    ('Wrap-Z ไก่', 'ซอสชีส',                     10),
    ('Wrap-Z ไก่', 'ผักสลัด',                    20),
    ('Wrap-Z ไก่', 'หอมใหญ่',                    15),
    ('Wrap-Z ไก่', 'มะเขือเทศ',                  10),
    ('Wrap-Z ไก่', 'กระดาษห่อ Wrap-Z',           1),
    -- Wrap-Z เนื้อ
    ('Wrap-Z เนื้อ', 'แป้ง Wrap',                1),
    ('Wrap-Z เนื้อ', 'เนื้อ',                    40),
    ('Wrap-Z เนื้อ', 'ซอส Homemade',             10),
    ('Wrap-Z เนื้อ', 'ซอสชีส',                   10),
    ('Wrap-Z เนื้อ', 'ผักสลัด',                  20),
    ('Wrap-Z เนื้อ', 'หอมใหญ่',                  15),
    ('Wrap-Z เนื้อ', 'มะเขือเทศ',                10),
    ('Wrap-Z เนื้อ', 'กระดาษห่อ Wrap-Z',         1),
    -- Chicky Cheese (ชีสแผ่น 1 อยู่ในสูตรหลัก · ซอส 10+10 ตามที่ยืนยัน)
    ('Chicky Cheese', 'ไก่บด',                   50),
    ('Chicky Cheese', 'แป้งเบอร์เกอร์',          1),
    ('Chicky Cheese', 'ชีสแผ่น',                 1),
    ('Chicky Cheese', 'ซอส Homemade',            10),
    ('Chicky Cheese', 'ซอสชีส',                  10),
    ('Chicky Cheese', 'กระดาษห่อเบอร์เกอร์',     1),
    ('Chicky Cheese', 'ถุงกระดาษ',               1)
  ) AS t(product, ingredient, qty)
  LOOP
    SELECT id INTO pid FROM pos_products
      WHERE user_id = uid AND name = rec.product;
    SELECT id INTO iid FROM ingredients
      WHERE user_id = uid AND name = rec.ingredient;
    IF pid IS NULL OR iid IS NULL THEN
      RAISE EXCEPTION 'สูตรผูกไม่ได้: % → % (ตรวจชื่อ)', rec.product, rec.ingredient;
    END IF;
    INSERT INTO pos_product_ingredients (product_id, ingredient_id, quantity)
    VALUES (pid, iid, rec.qty)
    ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  END LOOP;

  -- ── 1e. modifier เพิ่มชีส +10 ────────────────────────────────
  -- L ตัดชีส 2 แผ่น แต่ตารางผูกวัตถุดิบผูกที่ตัว modifier (ไม่ใช่คู่
  -- product×modifier) จึงต้องแยกเป็น 2 กลุ่ม — ราคาเท่ากัน ต่างแค่จำนวนตัด
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

  -- ตัวเลือกในกลุ่ม "เพิ่มชีส" → ตัดชีสแผ่น 1
  SELECT id INTO mid FROM pos_modifiers
    WHERE group_id = gid_cheese AND name = 'เพิ่มชีส';
  IF mid IS NULL THEN
    INSERT INTO pos_modifiers (group_id, name, price_delta)
    VALUES (gid_cheese, 'เพิ่มชีส', 10) RETURNING id INTO mid;
  END IF;
  INSERT INTO pos_modifier_ingredients (modifier_id, ingredient_id, quantity)
  VALUES (mid, iid, 1)
  ON CONFLICT (modifier_id, ingredient_id) DO UPDATE SET quantity = 1;

  -- ตัวเลือกในกลุ่ม "เพิ่มชีส ×2" → ตัดชีสแผ่น 2 (เฉพาะ L)
  SELECT id INTO mid FROM pos_modifiers
    WHERE group_id = gid_cheese2 AND name = 'เพิ่มชีส';
  IF mid IS NULL THEN
    INSERT INTO pos_modifiers (group_id, name, price_delta)
    VALUES (gid_cheese2, 'เพิ่มชีส', 10) RETURNING id INTO mid;
  END IF;
  INSERT INTO pos_modifier_ingredients (modifier_id, ingredient_id, quantity)
  VALUES (mid, iid, 2)
  ON CONFLICT (modifier_id, ingredient_id) DO UPDATE SET quantity = 2;

  -- ผูกกลุ่มเข้าเมนู: S, M, Wrap ×2 → เพิ่มชีส · L → เพิ่มชีส ×2
  FOR prod IN SELECT * FROM (VALUES
    ('Smash Homemade S'), ('Smash Homemade M'),
    ('Wrap-Z ไก่'), ('Wrap-Z เนื้อ')
  ) AS t(name)
  LOOP
    SELECT id INTO pid FROM pos_products WHERE user_id = uid AND name = prod.name;
    INSERT INTO pos_product_modifier_groups (product_id, group_id)
    VALUES (pid, gid_cheese) ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT id INTO pid FROM pos_products
    WHERE user_id = uid AND name = 'Smash Homemade L';
  INSERT INTO pos_product_modifier_groups (product_id, group_id)
  VALUES (pid, gid_cheese2) ON CONFLICT DO NOTHING;
END $$;

-- ═══ STEP 2 · ตรวจหลังรัน ═══════════════════════════════════════

-- 2a) สต็อก 24 รายการ ยอดตรงตามนับ
SELECT name, stock_qty, purchase_unit AS unit, category
FROM ingredients
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
ORDER BY category, name;

-- 2b) สูตรครบไหม — คาดหวัง: Smash S/M/L = 10 · Wrap-Z ×2 = 8 · Chicky = 7
SELECT p.name, COUNT(*) AS recipe_lines
FROM pos_products p
JOIN pos_product_ingredients pi ON pi.product_id = p.id
WHERE p.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
GROUP BY p.name ORDER BY p.name;

-- 2c) modifier เพิ่มชีสผูกถูกตัว — L ต้องเป็นกลุ่ม ×2 (ตัด 2 แผ่น)
SELECT p.name AS product, g.name AS grp, m.name AS modifier,
       m.price_delta, mi.quantity AS cheese_slices
FROM pos_product_modifier_groups pg
JOIN pos_products p        ON p.id = pg.product_id
JOIN pos_modifier_groups g ON g.id = pg.group_id
JOIN pos_modifiers m       ON m.group_id = g.id
JOIN pos_modifier_ingredients mi ON mi.modifier_id = m.id
WHERE p.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
  AND g.name LIKE 'เพิ่มชีส%'
ORDER BY p.name;

-- 2d) ราคาเมนูตรงกับที่ตกลงไหม (ไฟล์นี้ไม่แก้ราคาของเดิมให้)
SELECT name, sell_price,
  CASE name
    WHEN 'Smash Homemade S' THEN 59 WHEN 'Smash Homemade M' THEN 69
    WHEN 'Smash Homemade L' THEN 99 WHEN 'Wrap-Z ไก่' THEN 55
    WHEN 'Wrap-Z เนื้อ' THEN 65 WHEN 'Chicky Cheese' THEN 59
  END AS expected
FROM pos_products
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
  AND name IN ('Smash Homemade S','Smash Homemade M','Smash Homemade L',
               'Wrap-Z ไก่','Wrap-Z เนื้อ','Chicky Cheese')
ORDER BY name;
