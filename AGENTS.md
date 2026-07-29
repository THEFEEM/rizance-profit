# กฎเหล็ก: ห้าม e2e / สคริปต์ทดสอบ แตะ DATABASE ของ production

**เหตุการณ์จริง 29 ก.ค. 2569** — สคริปต์ e2e รันใส่ prod DB ผลคือ:

- ออเดอร์เทสต์ 66 รายการปนกับออเดอร์ลูกค้าจริง (วันนั้นขายจริง 3 บิล แต่ระบบนับ 69 ออเดอร์)
- `pos_order_counters` หลุดไปต่ำกว่าเลขที่ใช้แล้ว (6 vs 69)
- `nextOrderNo()` วนสร้างเลขซ้ำ → ชน `UNIQUE (user_id, order_no)` → `POST /api/pos/orders` ตอบ 500
- **ร้านสร้างออเดอร์ไม่ได้เลยทั้งวัน** และใช้เวลาไล่หาสาเหตุหลายชั่วโมงเพราะ toast กลืน error

## ทำอย่างไร

1. ก่อนรันสคริปต์ใดๆ ที่เขียน DB ให้ชี้ `DATABASE_URL` ไป **dev DB** เท่านั้น
2. `scripts/pg-config.mjs` มี guard อยู่แล้ว — สคริปต์ที่ต่อ DB ผ่าน `pgClientOptions()`
   จะถูกบล็อกอัตโนมัติถ้าปลายทางเป็น prod (ตรวจจาก project ref)
3. ถ้าตั้งใจจะรันใส่ prod จริงๆ (backfill / migration) ต้องประกาศเจตนาชัดเจน:
   ```powershell
   $env:ALLOW_PROD_DB=1; node scripts/backfill-xxx.mjs
   ```
4. สคริปต์ใหม่ที่ต่อ DB **ต้องใช้ `pgClientOptions()`** ห้ามสร้าง `pg.Client` ด้วย
   connection string ตรงๆ (จะข้าม guard) — ถ้าจำเป็นให้เรียก `assertNotProductionDb()` เอง
5. เปลี่ยนรายชื่อ DB ที่ถือว่าเป็น prod → env `PROD_DB_REFS` (คั่นด้วย comma)

## ข้อควรจำอื่นจากเคสนี้

- **อย่ากลืน error code** ตอน API ล้ม — โชว์โค้ดจริงให้เห็นเสมอ (เสียเวลาหลายชั่วโมงเพราะข้อนี้)
- Counter/sequence ทุกตัวควร **self-healing** ไม่ควรเชื่อว่าตัวเลขในตารางถูกเสมอ
- migration รันบน **ทั้ง dev และ prod** ไม่งั้น dev ผ่านแต่ prod พัง

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
