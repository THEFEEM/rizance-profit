-- Master Cost วัตถุดิบ + บรรจุภัณฑ์ NINENON — 21 ส.ค. 2569
--
-- ตัวที่มีในคลัง: อัปเดตราคา (ยอดสต็อกไม่แตะ)
-- ตัวที่ยังไม่มี: เพิ่มใหม่ สต็อกเริ่ม 0 (ไก่กรอบ, นักเก็ต, พริกระฆัง, เกลือ,
--   น้ำตาล, มายองเนส, มายองบอย, Carnation, น้ำมันปาล์ม, ถุงหิ้ว, แก้ว 20 oz,
--   ฝาแก้ว, Sticker)
--
-- การแปลงหน่วย (สต็อกนับเป็น g/ml — ราคาเก็บเป็น "ราคาต่อ x หน่วยสต็อก"):
--   240/kg      → 240 ต่อ 1000 g   → avg_cost 0.24/g
--   ไก่สามชั้น 96/แพ็ก(1 kg — ยืนยันแล้ว) → 96 ต่อ 1000 g
--   ชีสแผ่น 278/84 แผ่น → 3.3095/แผ่น
--   ถุงมือ 1 บาท/ชิ้น แต่คลังนับเป็น "คู่" → 2 บาท/คู่
--   แก้ว 20 oz 70/50 ใบ → 1.40/ใบ
--
-- mapping ชื่อ: เนื้อบด→เนื้อ · ไก่ 3 ชั้น→ไก่สามชั้น · กระดาษห่อ Burger→
--   กระดาษห่อเบอร์เกอร์ (ยืนยันแล้วว่า มอสมายองเนส ≠ มายองเนส ≠ มายองบอย)
--
-- ตัวที่ master ไม่มีราคา — ไม่แตะ: ซอส Homemade, ซอสชีสที่ผสมเอง(ใช้ราคา
--   75/kg ตาม master), มอสมายองเนส, ชีส(ก้อน), ไข่, พริกป่น
--
-- รันซ้ำได้: ผลเท่าเดิม

DO $$
DECLARE
  uid UUID;
  itm RECORD;
  n_upd INT := 0;
  n_new INT := 0;
BEGIN
  SELECT id INTO uid FROM users WHERE email = 'ninenon2026@gmail.com';
  IF uid IS NULL THEN RAISE EXCEPTION 'ไม่พบ user ninenon2026@gmail.com'; END IF;

  FOR itm IN SELECT * FROM (VALUES
    -- name              unit    qty     price    category
    -- ── วัตถุดิบ ──
    ('เนื้อ',            'g',    1000,   240.00,  'วัตถุดิบ'),
    ('ไก่บด',            'g',    1000,   75.00,   'วัตถุดิบ'),
    ('ไก่กรอบ',          'g',    1000,   92.00,   'วัตถุดิบ'),
    ('นักเก็ต',          'g',    1000,   108.00,  'วัตถุดิบ'),
    ('เฟรนฟราย',         'g',    1000,   60.00,   'วัตถุดิบ'),
    ('ไก่สามชั้น',       'g',    1000,   96.00,   'วัตถุดิบ'),
    ('แป้งเบอร์เกอร์',   'ลูก',  6,      35.00,   'วัตถุดิบ'),
    ('แป้ง Wrap',        'แผ่น', 1,      9.00,    'วัตถุดิบ'),
    ('ชีสแผ่น',          'แผ่น', 84,     278.00,  'วัตถุดิบ'),
    ('ซอสชีส',           'g',    1000,   75.00,   'วัตถุดิบ'),
    ('เนย',              'g',    1000,   73.00,   'วัตถุดิบ'),
    ('ผักสลัด',          'g',    1000,   70.00,   'วัตถุดิบ'),
    ('มะเขือเทศ',        'g',    1000,   40.00,   'วัตถุดิบ'),
    ('หอมใหญ่',          'g',    10000,  250.00,  'วัตถุดิบ'),
    ('พริกไทย',          'g',    70,     15.00,   'วัตถุดิบ'),
    ('พริกระฆัง',        'g',    100,    15.00,   'วัตถุดิบ'),
    ('ออริกาโน่',        'g',    500,    62.00,   'วัตถุดิบ'),
    ('เกลือ',            'g',    220,    4.00,    'วัตถุดิบ'),
    ('น้ำตาล',           'g',    1000,   25.00,   'วัตถุดิบ'),
    ('มายองเนส',         'g',    1000,   50.00,   'วัตถุดิบ'),
    ('มายองบอย',         'g',    3000,   175.00,  'วัตถุดิบ'),
    ('ซอสมะเขือเทศ',     'g',    1000,   40.00,   'วัตถุดิบ'),
    ('Carnation',        'ml',   1000,   67.00,   'วัตถุดิบ'),
    ('น้ำมันปาล์ม',      'ml',   1000,   50.00,   'วัตถุดิบ'),
    -- ── บรรจุภัณฑ์ ──
    ('กระดาษห่อเบอร์เกอร์','ชิ้น', 1,    0.50,    'บรรจุภัณฑ์'),
    ('กระดาษห่อ Wrap-Z', 'ชิ้น', 1,      0.50,    'บรรจุภัณฑ์'),
    ('ถุงกระดาษ',        'ชิ้น', 1,      0.95,    'บรรจุภัณฑ์'),
    ('ถุงหิ้ว',          'ใบ',   1,      0.20,    'บรรจุภัณฑ์'),
    ('กระปุก 2 oz',      'ใบ',   1,      1.00,    'บรรจุภัณฑ์'),
    ('แก้ว 20 oz',       'ใบ',   50,     70.00,   'บรรจุภัณฑ์'),
    ('ฝาแก้ว',           'ใบ',   1,      0.60,    'บรรจุภัณฑ์'),
    ('Sticker',          'ชิ้น', 1,      1.00,    'บรรจุภัณฑ์'),
    ('ถุงมือ',           'คู่',  1,      2.00,    'บรรจุภัณฑ์')  -- 1/ชิ้น ×2
  ) AS t(name, unit, qty, price, category)
  LOOP
    UPDATE ingredients SET
      purchase_quantity   = itm.qty,
      purchase_unit       = itm.unit,
      purchase_price      = itm.price,
      last_purchase_price = ROUND(itm.price / itm.qty, 2),
      avg_cost            = ROUND(itm.price / itm.qty, 4),
      last_purchased_at   = now(),
      category            = COALESCE(category, itm.category),
      updated_at          = now()
    WHERE user_id = uid AND name = itm.name;

    IF FOUND THEN
      n_upd := n_upd + 1;
    ELSE
      INSERT INTO ingredients
        (user_id, name, purchase_quantity, purchase_unit, purchase_price,
         last_purchase_price, avg_cost, last_purchased_at,
         track_stock, stock_qty, category)
      VALUES
        (uid, itm.name, itm.qty, itm.unit, itm.price,
         ROUND(itm.price / itm.qty, 2), ROUND(itm.price / itm.qty, 4), now(),
         true, 0, itm.category);
      n_new := n_new + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'อัปเดตราคา % ตัว · เพิ่มใหม่ % ตัว', n_upd, n_new;
END $$;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
-- ต้นทุนต่อหน่วยสต็อก — จุดเช็คเร็ว: เนื้อ 0.24/g · ชีสแผ่น 3.3095/แผ่น
-- หอมใหญ่ 0.025/g · แก้ว 20 oz 1.40/ใบ · ถุงมือ 2/คู่ · แป้งเบอร์เกอร์ 5.8333/ลูก
SELECT name, stock_qty, purchase_unit AS unit, avg_cost AS cost_per_unit,
       purchase_price || '/' || purchase_quantity || ' ' || purchase_unit AS master,
       category
FROM ingredients
WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
ORDER BY category, name;

-- ต้นทุนวัตถุดิบต่อ 1 หน่วยขาย ของเมนูที่ผูกสูตรแล้ว (food cost ทันที)
SELECT p.name, p.sell_price,
       ROUND(SUM(pi.quantity * i.avg_cost), 2) AS ingredient_cost,
       ROUND(SUM(pi.quantity * i.avg_cost) / NULLIF(p.sell_price, 0) * 100, 1)
         AS cost_pct
FROM pos_products p
JOIN pos_product_ingredients pi ON pi.product_id = p.id
JOIN ingredients i ON i.id = pi.ingredient_id
WHERE p.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
GROUP BY p.id, p.name, p.sell_price
ORDER BY p.name;
