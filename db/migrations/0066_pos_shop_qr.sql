-- 0066_pos_shop_qr — QR รับเงินของร้าน (Thai QR แบบคงที่) ควบคู่กับ PromptPay ที่ระบบสร้าง
--
-- ที่มา: NINENON มี Thai QR Payment ของกรุงไทย (รหัสร้าน YP194090WL0346523YS)
--        รับได้ทุกแอปธนาคาร + วอลเล็ต + พอยท์ + Alipay/WeChat
--
-- ⚠️ ข้อจำกัด: Thai QR แบบคงที่ "ฝังยอดเงินไม่ได้" ลูกค้าต้องพิมพ์ยอดเอง
--    ต่างจาก PromptPay ที่ระบบ generate ซึ่งใส่ยอดให้อัตโนมัติ
--    → UI จึงทำ 2 แท็บ: ดีฟอลต์ PromptPay (กันกดผิดยอด) · สลับไป QR ร้านได้
--
-- ⚠️ บัญชี: ทั้งสองแท็บลง payment_method = 'promptpay' เหมือนกัน
--    ไม่มี enum ใหม่ ไม่แตะ posting adapter ไม่มี journal ใหม่

BEGIN;

-- URL รูป QR ใน Supabase Storage (bucket เดิม path shop-qr/)
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS shop_qr_url TEXT;

-- ข้อความใต้ QR เช่น "ชื่อบัญชี: ลุตฟี กาเจร์ · รหัสร้านค้า YP194090WL0346523YS"
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS shop_qr_note VARCHAR(200);

COMMIT;
