-- เคลียร์ URL ที่ชี้ไฟล์สลิป/รูปแชตที่ถูกลบไปแล้ว — 24 ส.ค. 2569
--
-- ใช้คู่กับ: node scripts/storage-cleanup.mjs --delete-orphans --slips-older-than=30
-- รันสคริปต์ (ลบไฟล์) ก่อน แล้วรันไฟล์นี้ (เคลียร์ URL) — ไม่งั้นหน้าเว็บจะโชว์รูปเสีย
--
-- ⚠️ ปรับเลข 30 ให้ตรงกับที่ใช้ในสคริปต์ทั้ง 3 จุด
-- ⚠️ ลบเฉพาะ "หลักฐานการโอน" ที่เก่าและออเดอร์ปิดแล้ว — ยอดเงิน/บิล/บัญชี
--    ไม่ถูกแตะเลย (slip_url เป็นแค่รูปอ้างอิง ไม่ได้ใช้คำนวณอะไร)

-- ═══ STEP 0 · ดูก่อนว่าจะกระทบกี่แถว (อ่านอย่างเดียว) ═══════════

SELECT
  (SELECT COUNT(*) FROM pos_orders
   WHERE slip_url IS NOT NULL AND created_at < now() - interval '30 days')  AS slips_to_clear,
  (SELECT COUNT(*) FROM pos_order_messages
   WHERE image_url IS NOT NULL AND created_at < now() - interval '30 days') AS chat_images_to_clear,
  (SELECT COUNT(*) FROM pos_orders WHERE slip_url IS NOT NULL)              AS slips_total,
  (SELECT COUNT(*) FROM pos_order_messages WHERE image_url IS NOT NULL)     AS chat_images_total;

-- ═══ STEP 1 · เคลียร์ URL ของสลิปเก่า ═══════════════════════════

UPDATE pos_orders
SET slip_url = NULL
WHERE slip_url IS NOT NULL
  AND created_at < now() - interval '30 days';

-- ═══ STEP 2 · เคลียร์ URL รูปในแชตเก่า ══════════════════════════
-- ข้อความยังอยู่ครบ (ประวัติคุยกับลูกค้าไม่หาย) หายแค่รูป

UPDATE pos_order_messages
SET image_url = NULL
WHERE image_url IS NOT NULL
  AND created_at < now() - interval '30 days';

-- ═══ STEP 3 · ตรวจ — ต้องได้ 0 ทั้งสองช่อง ══════════════════════

SELECT
  (SELECT COUNT(*) FROM pos_orders
   WHERE slip_url IS NOT NULL AND created_at < now() - interval '30 days')  AS slips_left,
  (SELECT COUNT(*) FROM pos_order_messages
   WHERE image_url IS NOT NULL AND created_at < now() - interval '30 days') AS chat_images_left;
