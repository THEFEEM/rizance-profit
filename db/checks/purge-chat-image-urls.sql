-- เคลียร์ URL รูปในแชตออเดอร์ที่ถูกลบออกจาก Storage แล้ว — 24 ส.ค. 2569
--
-- ═══ ใช้เมื่อไหร่ ═══════════════════════════════════════════════
-- หลังรัน: node scripts/storage-cleanup.mjs --delete-orphans --chat-older-than=7
-- (สคริปต์ลบ "ไฟล์" ออกจาก Storage · ไฟล์นี้ลบ "ลิงก์" ที่ค้างใน DB)
--
-- ไม่ทำจะเป็นอะไร: แชตยังเก็บ URL ที่ชี้ไฟล์ที่ไม่มีอยู่แล้ว
-- → เปิดแชตออเดอร์เก่าจะเห็นรูปแตก (icon รูปเสีย) ทั้งฝั่งร้านและลูกค้า
--
-- ═══ ทำไมต้องมี 2 คำสั่ง (บทเรียนจากรอบแรก) ═══════════════════
-- 0062 กำหนด CHECK (body IS NOT NULL OR image_url IS NOT NULL)
-- คือ "หนึ่งข้อความต้องมีอย่างน้อยข้อความหรือรูป"
--
--   แถวที่มีข้อความ + รูป  → SET image_url = NULL ได้ (ข้อความยังอยู่ CHECK ผ่าน)
--   แถวที่มีแต่รูป         → SET NULL ไม่ได้ (จะกลายเป็นแถวว่าง CHECK ไม่ผ่าน)
--                            ต้อง DELETE ทั้งแถว
--
-- error ที่เจอถ้าทำผิด: 23514 violates check constraint
--                       "pos_order_messages_check"
--
-- ═══ กระทบอะไรบ้าง ═════════════════════════════════════════════
-- ✓ ข้อความที่พิมพ์คุยกันอยู่ครบทุกบรรทัด (STEP 2 แตะแค่ช่องรูป)
-- ✓ ไม่แตะยอดเงิน บิล ออเดอร์ บัญชี
-- ✓ ไม่แตะสลิปโอนเงิน (pos_orders.slip_url) — คนละคอลัมน์ คนละไฟล์
-- ⚠️ STEP 1 ลบแถวข้อความที่มีแต่รูปทิ้ง (รูปถูกลบจาก Storage แล้ว
--    แถวจึงเหลือแต่ลิงก์เสีย) — รวมถึง kind='proof' (รูปยืนยันการส่ง)
--
-- ⚠️ ตัวเลข 7 ต้องตรงกับ --chat-older-than=7 ที่ใช้ในสคริปต์
--    ถ้าใช้เลขอื่น แก้ทั้ง 5 จุดในไฟล์นี้ให้ตรงกัน

-- ═══ STEP 0 · ดูก่อนว่าจะกระทบกี่แถว (อ่านอย่างเดียว ยังไม่แก้อะไร) ═══
-- to_delete = แถวที่มีแต่รูป → STEP 1 ลบทั้งแถว
-- to_clear  = แถวที่มีข้อความด้วย → STEP 2 ล้างแค่รูป ข้อความอยู่ครบ

SELECT
  COUNT(*) FILTER (
    WHERE created_at < now() - interval '7 days' AND body IS NULL
  ) AS rows_to_delete,
  COUNT(*) FILTER (
    WHERE created_at < now() - interval '7 days' AND body IS NOT NULL
  ) AS urls_to_clear,
  COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS keep_new,
  COUNT(*)                                                        AS images_total
FROM pos_order_messages
WHERE image_url IS NOT NULL;

-- ═══ STEP 1 · ลบแถวที่มีแต่รูป (ไม่มีข้อความ) ═══════════════════
-- จำนวนแถวที่ลบต้องเท่ากับ rows_to_delete จาก STEP 0

DELETE FROM pos_order_messages
WHERE image_url IS NOT NULL
  AND body IS NULL
  AND created_at < now() - interval '7 days';

-- ═══ STEP 2 · ล้างแค่รูปในแถวที่มีข้อความ (ข้อความอยู่ครบ) ══════
-- จำนวนแถวที่แก้ต้องเท่ากับ urls_to_clear จาก STEP 0

UPDATE pos_order_messages
SET image_url = NULL
WHERE image_url IS NOT NULL
  AND body IS NOT NULL
  AND created_at < now() - interval '7 days';

-- ═══ STEP 3 · ตรวจ — ต้องได้ 0 ═══════════════════════════════════

SELECT COUNT(*) AS images_left
FROM pos_order_messages
WHERE image_url IS NOT NULL
  AND created_at < now() - interval '7 days';
