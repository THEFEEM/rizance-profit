-- Seed เมนู Iqtishoduna Café & Bakery — ร้านของ Narong76777@gmail.com
-- ที่มา: เมนู 3 หน้า (COFFEE / NON COFFEE ×2) · 17 ส.ค. 2569
--
-- Idempotent: รันซ้ำไม่เบิ้ล (เช็คชื่อก่อน insert ทุกตัว)
-- track_stock = false ทุกรายการ (เครื่องดื่มชงตามสั่ง ไม่นับสต๊อกเป็นแก้ว)
--
-- ⚠️ ราคาที่เมนูไม่ระบุ — ตั้งไว้ให้ก่อน ร้านแก้เองใน POS ได้:
--    ชากลิ่นต่าง ๆ (Tea pot): ตั้ง 35 ตามราคา "ชากา teapot 35.-"
--    ชาสตอเบอรี่/แอปเปิ้ล/ราสเบอร์รี่/แบล็คเคอแรนท์/พีชเสาวรส/เลม่อน (กา)

DO $$
DECLARE
  uid UUID;
  cid UUID;
  cat RECORD;
  itm RECORD;
BEGIN
  SELECT id INTO uid FROM users WHERE lower(email) = lower('Narong76777@gmail.com');
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ user Narong76777@gmail.com — ให้สมัครก่อนแล้วค่อยรัน';
  END IF;

  -- ── หมวดหมู่ (สีโทนฟ้าตามแบรนด์คาเฟ่) ──────────────────────
  FOR cat IN SELECT * FROM (VALUES
    ('กาแฟ',          '#8B5E3C', 0),
    ('กาแฟร้อน',      '#6B4226', 1),
    ('มัจฉะ',         '#4ade9e', 2),
    ('Italian Soda',  '#38bdf8', 3),
    ('ชา',            '#f59e0b', 4),
    ('ชากา (Tea pot)','#ef9f27', 5),
    ('นมสด',          '#f9a8d4', 6),
    ('โกโก้',         '#a16207', 7)
  ) AS t(name, color, sort_order)
  LOOP
    INSERT INTO pos_categories (user_id, name, color, sort_order)
    SELECT uid, cat.name, cat.color, cat.sort_order
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_categories c WHERE c.user_id = uid AND c.name = cat.name
    );
  END LOOP;

  -- ── สินค้า ──────────────────────────────────────────────────
  FOR itm IN SELECT * FROM (VALUES
    -- กาแฟ (เย็น)
    ('กาแฟ', 'อเมริกาโน่ (Americano)',            45),
    ('กาแฟ', 'ลาเต้ (Latte)',                     50),
    ('กาแฟ', 'เอสเย็น (Espresso)',                50),
    ('กาแฟ', 'คาปูชิโน่ (Cappuccino)',            50),
    ('กาแฟ', 'มอคค่า (Mocha)',                    60),
    ('กาแฟ', 'มัคคิอาโต้ (Macchiato)',            55),
    ('กาแฟ', 'อเมน้ำผึ้ง (Black Honey)',          55),
    ('กาแฟ', 'อเมพีช (Peach Americano)',          55),
    ('กาแฟ', 'อเมส้ม (Black Orange)',             60),
    -- กาแฟร้อน
    ('กาแฟร้อน', 'อเมริกาโน่ร้อน',                40),
    ('กาแฟร้อน', 'ลาเต้ร้อน',                     50),
    ('กาแฟร้อน', 'คาปูชิโน่ร้อน',                 50),
    ('กาแฟร้อน', 'มอคค่าร้อน',                    55),
    ('กาแฟร้อน', 'มัคคิอาโต้ร้อน',                55),
    ('กาแฟร้อน', 'ช็อกโกแลตร้อน',                 30),
    ('กาแฟร้อน', 'มัจฉะร้อน',                     40),
    -- มัจฉะ
    ('มัจฉะ', 'มัจฉะลาเต้ (Matcha)',              65),
    ('มัจฉะ', 'เพียวมัจฉะ (Pure Matcha)',         60),
    ('มัจฉะ', 'มัจฉะสตอเบอรี',                    75),
    ('มัจฉะ', 'มัจฉะโกโก้',                       70),
    ('มัจฉะ', 'มัจฉะชาไทย',                       70),
    ('มัจฉะ', 'มัจฉะน้ำผึ้งมะนาว',                65),
    ('มัจฉะ', 'มัจฉะน้ำส้ม',                      65),
    ('มัจฉะ', 'มัจฉะมะพร้าวอ่อน',                 65),
    ('มัจฉะ', 'มัจฉะวานิลา',                      65),
    ('มัจฉะ', 'มัจฉะคาราเมล',                     65),
    -- Italian Soda
    ('Italian Soda', 'สตอเบอรี่โซดา',             25),
    ('Italian Soda', 'แอปเปิ้ลเขียวโซดา',         25),
    ('Italian Soda', 'บลูเลม่อนโซดา',             25),
    ('Italian Soda', 'ลิ้นจี่โซดา',               25),
    ('Italian Soda', 'บลูเบอร์รี่โซดา',           25),
    ('Italian Soda', 'ยูซุโซดา',                  30),
    ('Italian Soda', 'น้ำผึ้งมะนาวโซดา',          30),
    ('Italian Soda', 'พีชโซดา',                   30),
    -- ชา
    ('ชา', 'ชาไทย',                               25),
    ('ชา', 'ชาเขียว',                             25),
    ('ชา', 'ชามะนาว',                             25),
    ('ชา', 'ชาเขียวแอปเปิ้ล',                     25),
    ('ชา', 'ชาพีช',                               35),
    ('ชา', 'ชาลิ้นจี่',                           25),
    ('ชา', 'ชาไทยร้อน',                           30),
    ('ชา', 'ชาเขียวร้อน',                         30),
    -- ชากา (Tea pot) — เมนูไม่ระบุราคารายกลิ่น ตั้งตาม "ชากา 35"
    ('ชากา (Tea pot)', 'ชากา (Teapot)',           35),
    ('ชากา (Tea pot)', 'แก้วร้อน (Hot cup)',      30),
    ('ชากา (Tea pot)', 'ชาสตอเบอรี่ (กา)',        35),
    ('ชากา (Tea pot)', 'ชาแอปเปิ้ล (กา)',         35),
    ('ชากา (Tea pot)', 'ชาราสเบอร์รี่ (กา)',      35),
    ('ชากา (Tea pot)', 'ชาแบล็คเคอแรนท์ (กา)',    35),
    ('ชากา (Tea pot)', 'ชาพีชเสาวรส (กา)',        35),
    ('ชากา (Tea pot)', 'ชาเลม่อน (กา)',           35),
    -- นมสด
    ('นมสด', 'นมสดเย็น',                          20),
    ('นมสด', 'นมชมพู',                            25),
    ('นมสด', 'นมสดมิ้นท์',                        25),
    ('นมสด', 'นมสดวานิลา',                        25),
    ('นมสด', 'นมสดน้ำผึ้ง',                       30),
    ('นมสด', 'นมสดเฮเซลนัท',                      25),
    ('นมสด', 'นมสดคาราเมล',                       25),
    ('นมสด', 'นมสดมะพร้าวอ่อน',                   25),
    ('นมสด', 'ชาไทยนมสด',                         30),
    ('นมสด', 'ชาเขียวนมสด',                       30),
    ('นมสด', 'สตอเบอรี่นมสด',                     45),
    ('นมสด', 'โกโก้นมสดสตอเบอรี่',                50),
    ('นมสด', 'สตอเบอรี่ชาไทย',                    50),
    ('นมสด', 'สตอเบอรี่มิ้นท์',                   50),
    -- โกโก้
    ('โกโก้', 'โกโก้ (Original)',                 25),
    ('โกโก้', 'โกโก้นมชมพู',                      30),
    ('โกโก้', 'โกโก้มิ้นท์',                      30),
    ('โกโก้', 'โกโก้คาราเมล',                     30),
    ('โกโก้', 'โกโก้วานิลา',                      30),
    ('โกโก้', 'โกโก้นมสดน้ำผึ้ง',                 35),
    ('โกโก้', 'โกโก้เฮเซลนัท',                    30),
    ('โกโก้', 'โกโก้นมสด',                        30)
  ) AS t(cat_name, name, price)
  LOOP
    SELECT id INTO cid FROM pos_categories
    WHERE user_id = uid AND name = itm.cat_name;

    INSERT INTO pos_products (user_id, name, sell_price, track_stock, category_id)
    SELECT uid, itm.name, itm.price, false, cid
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_products p WHERE p.user_id = uid AND p.name = itm.name
    );
  END LOOP;
END $$;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
SELECT c.name AS category, COUNT(p.id) AS items
FROM pos_categories c
LEFT JOIN pos_products p ON p.category_id = c.id
WHERE c.user_id = (SELECT id FROM users WHERE lower(email) = lower('Narong76777@gmail.com'))
GROUP BY c.name, c.sort_order ORDER BY c.sort_order;
-- คาดหวัง: กาแฟ 9 · กาแฟร้อน 7 · มัจฉะ 10 · Italian Soda 8 · ชา 8
--          ชากา 8 · นมสด 14 · โกโก้ 8 — รวม 72 รายการ
