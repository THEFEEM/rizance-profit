-- เปิดสิทธิ์ POS ให้ Narong76777@gmail.com
-- กลไก: POS อนุญาต plan ใน POS_ALLOWED_PLANS (default: business, business_pro)
-- และเช็ค subscription_expires_at ทุกครั้ง — จึงตั้ง plan + วันหมดอายุที่ users

-- ═══ STEP 1 · หา user ก่อน (email เก็บ lowercase หรือไม่ต้องเช็ค) ═══
SELECT id, email, shop_name, subscription_plan, subscription_expires_at
FROM users
WHERE lower(email) = lower('Narong76777@gmail.com');
-- ต้องได้ 1 แถว — ถ้า 0 แถว = เขายังไม่สมัคร ให้เขาสมัครที่หน้า register ก่อน
-- แล้วค่อยรัน STEP 2

-- ═══ STEP 2 · เปิดสิทธิ์ (แก้วันหมดอายุตามที่ตกลงกับเขา) ═══════════
UPDATE users
SET subscription_plan       = 'business',
    -- ⚠️ ตั้งวันหมดอายุเสมอ อย่าปล่อย NULL โดยไม่ตั้งใจ
    --    ตัวอย่างนี้ให้ 1 ปี — ปรับได้ตามดีล
    subscription_expires_at = now() + interval '1 year'
WHERE lower(email) = lower('Narong76777@gmail.com');

-- ═══ STEP 3 · ตรวจ ═══════════════════════════════════════════════
SELECT email, subscription_plan, subscription_expires_at
FROM users
WHERE lower(email) = lower('Narong76777@gmail.com');
-- subscription_plan = 'business' · expires_at = ~17 ส.ค. 2570
