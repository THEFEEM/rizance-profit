-- 0030_chat_image_thumb — thumbnail สลิปสำหรับแสดงในแชท
-- เก็บ base64 ขนาดเล็ก (~200px, ~10-15KB) ไม่ใช่รูปเต็ม
BEGIN;

ALTER TABLE chat_messages
  ADD COLUMN image_thumb TEXT;

COMMIT;
