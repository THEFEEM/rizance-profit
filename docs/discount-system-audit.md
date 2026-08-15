# Discount System Audit — Ninenon Campaigns (PHASE 0)

วันที่ audit: 15 ส.ค. 2569 · ก่อนเขียนโค้ดใด ๆ ตามข้อบังคับของสเปค

## Current architecture

| ด้าน | ของจริงใน repo |
|---|---|
| Framework | Next.js App Router + TS ทั้งสอง repo · profit = API/DB · pos = client |
| DB | Supabase Postgres · raw `pg` (ไม่มี ORM) · migration = ไฟล์ SQL รันมือใน SQL Editor |
| Money | cents-safe: `toCents/centsToDecimalString/sumDecimals` (`lib/money.ts`) — **ห้าม float** |
| Auth | JWT session ระดับร้าน (`requirePosSessionAndPlan`) · **ไม่มี role/permission หลายระดับใน POS** — ร้านเดียว เจ้าของ login เครื่องเดียว พนักงานใช้เครื่องร่วม |
| Validation | zod ใน `lib/pos-validation.ts` |
| UI | Sheet-based (ไม่มี /admin route) · components/ui/* · Thai/THB/พุทธศักราช |
| Testing | ไม่มี test framework — ใช้ PGlite (Postgres WASM) รัน migration จริง + เทสจริง (ทำแล้วกับ feedback 0073) |

## Existing discount infrastructure — ⭐ สำคัญที่สุดของ audit นี้

**ระบบส่วนลดต่อบรรทัดมีอยู่แล้วตั้งแต่ 0071** และใช้งานจริงกับคอมโบ:

- `pos_bill_items.list_unit_price` — ราคาป้าย (NULL = ไม่มีส่วนลด)
- `pos_bill_items.discount_source` — CHECK `('combo','coupon','manual','reward')`
  → ค่า `'coupon'` **ถูกเตรียมรอไว้แล้ว** แต่ยังไม่มีใครเขียน
- `lib/pos-combo-pricing.ts` — pro-rata allocation cents-safe (เศษ→บรรทัดแพงสุด + guard mismatch)
  → **reuse pattern นี้กับ campaign discount ได้ตรง ๆ**
- invariant ศักดิ์สิทธิ์: `Σ line_total = total_amount = journal debit = credit`
  → ส่วนลดต้อง "ฝังในราคาบรรทัด" ไม่ใช่บรรทัดติดลบ — รายงาน/บัญชีเดิมทำงานต่อโดยไม่แก้

**การตัดสินใจธุรกิจที่ล็อกไว้แล้ว (จากเจ้าของ):** Coupon = Revenue Reduction
→ line_total ที่ลดแล้วไหลเข้า income/journal ตามปกติ = รายได้ลดจริง ไม่มี journal เพิ่ม

## Relevant modules

- `lib/pos-close-bill-queries.ts` → `closePosBill()` — จุด integrate เดียว
  จังหวะ: `computedLines` เสร็จ (บรรทัดปกติ+คอมโบ) → **[แทรก campaign ตรงนี้]** → surcharges → `totalAmount` → payments check → INSERT
- `lib/pos-member-queries.ts` — สมาชิก (eligibility MEMBERS_ONLY + per-customer limit ผูกที่นี่)
- `lib/pos-validation.ts` → `closePosBillSchema` — เพิ่ม field campaign
- `pos_upsell_rules` (0071) — มีตารางแต่ไม่มี logic; ไม่ชนกัน
- POS UI: ชีตเก็บเงินใน `rizance-pos/app/page.tsx` · pattern จัดการ = Sheet (เช่น `ComboManagerSheet`)

## Potential conflicts

1. **คอมโบก็เป็นส่วนลด** — ราคาคอมโบลดจากป้ายแล้ว
   กติกา: campaign % คิดจาก "ราคาหลังคอมโบ" (net ปัจจุบันของบรรทัด) — ไม่ลดซ้อนจากราคาป้าย
2. บรรทัดที่มี `discount_source` แล้ว (combo) ถ้าโดน campaign ทับ → เก็บ source เดิมไว้ไม่ได้สองค่า
   กติกา MVP: campaign ลดทับได้ แต่ `discount_source` เปลี่ยนเป็น `'coupon'` เฉพาะบรรทัดที่ campaign แตะและยังไม่มี source · บรรทัดคอมโบคง `'combo'` แต่ line_total ลดลง (list_unit_price ยังเป็นป้ายเดิม = ประวัติถูก)
   → เรียบง่ายกว่า: **MVP ไม่ให้ campaign ซ้อนบนบรรทัดคอมโบ** (eligible เฉพาะบรรทัดปกติ + คิดยอดขั้นต่ำจากทั้งบิล) — กันรายงานตีกัน ตัดสินใจนี้กลับได้ภายหลัง
3. Surcharge (ค่าส่ง) ต้อง **ไม่เข้าฐานคำนวณส่วนลด** และไม่นับในยอดขั้นต่ำ

## สิ่งที่สเปคขอแต่ codebase จริงไม่มีฐานรองรับ → เลื่อน (พร้อมเหตุผล)

- **Approval tiers (STAFF/SUPERVISOR/MANAGER/OWNER)** — POS นี้ไม่มีระบบ role หลายระดับ (session เดียวต่อร้าน) การสร้าง role ใหม่ = สร้าง authentication ใหม่ ซึ่งสเปคห้ามเอง
  → MVP: manual discount ยังไม่ทำ · campaign เท่านั้น · schema เผื่อ `applied_by` ไว้แล้ว
- **CUSTOMER_GROUP / SPECIFIC_CUSTOMER** — ยังไม่มี segment ในระบบสมาชิก → รองรับ `ALL / MEMBERS_ONLY` ก่อน โครง eligibility เป็นคอลัมน์เดียวขยายค่าได้
- **BUY_X_GET_Y / BUNDLE** — bundle มีแล้วในรูปคอมโบ · BXGY เป็น discount_type ที่เผื่อ CHECK ไว้ ไม่ implement
- **ROI analytics** — ไม่มีข้อมูล incremental จริง สเปคห้ามสร้างตัวเลขไม่มีรองรับ → แสดง usage/discount/sales เท่านั้น

## Implementation plan (ตามที่ทำจริง)

- 0074: `pos_campaigns` + `pos_campaign_products` (scope) + `pos_campaign_usages` (audit log)
  + เพิ่ม `'campaign'`? — ไม่ ใช้ `'coupon'` ที่ CHECK เตรียมไว้แล้ว (ไม่แตะ CHECK เดิม)
  + `used_count` บนตัว campaign — กัน race ด้วย atomic `UPDATE ... WHERE used_count < usage_limit`
- Engine แยกเป็น pure function (`lib/pos-campaign-engine.ts`) เทสได้โดยไม่ต่อ DB
- Queries + validate + recordUsage ใน `lib/pos-campaign-queries.ts`
- integrate `closePosBill` · client ส่งแค่ `campaignId` — **server คำนวณเองทั้งหมด**
- API: `/api/pos/campaigns` CRUD + `/preview` (คำนวณก่อนเก็บเงิน)
- UI: `CampaignManagerSheet` (จัดการ+สถิติ) + ปุ่มส่วนลดในชีตเก็บเงิน
- เทสด้วย PGlite: 9 เคสตามสเปค + concurrency
