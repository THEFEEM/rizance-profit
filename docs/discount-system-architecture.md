# Ninenon Campaigns — Architecture

## ภาพรวม

```
Campaign (pos_campaigns)
   ↓ Conditions   status · start/end · time window · day of week
   ↓ Eligibility  all | members (per-customer limit บังคับเป็นสมาชิก)
   ↓ Scope        entire_order | products (pos_campaign_products)
   ↓ Engine       lib/pos-campaign-engine.ts — pure, cents-safe, เทสได้ไม่ต่อ DB
   ↓ Apply        closePosBill: ฝังส่วนลดในราคาบรรทัด (list_unit_price + discount_source='coupon')
   ↓ Usage        recordCampaignUsage — atomic, transaction เดียวกับบิล
   ↓ Analytics    pos_campaign_usages (append-only)
```

## หลักการเงิน (ห้ามละเมิด)

1. **ส่วนลดฝังในราคาบรรทัด** ไม่ใช่บรรทัดติดลบ → `Σ line_total = total_amount = journal debit = credit` ยังจริง — รายงาน/บัญชี/void เดิมทำงานโดยไม่แก้สักบรรทัด
2. **Coupon = Revenue Reduction** — line_total หลังลดไหลเข้ารายได้ตามปกติ
3. **client ส่งได้แค่ `campaignId`/`couponCode`** — จำนวนเงินเกิดที่ server เท่านั้น
4. percentage ปัดลง (`Math.floor`) เข้าข้างร้าน สม่ำเสมอกับระบบแต้ม
5. pro-rata allocation + เศษให้บรรทัดแพงสุด + guard mismatch (pattern จาก pos-combo-pricing)
6. surcharge (ค่าส่ง) ไม่เข้าฐานส่วนลดและไม่นับยอดขั้นต่ำ... **ยกเว้นยอดขั้นต่ำนับจากสินค้าทั้งบิล** (รวมคอมโบ) — คอมโบนับเข้าขั้นต่ำแต่ไม่ถูกลดซ้อน

## Concurrency (จุดที่พังง่ายสุดของระบบส่วนลด)

- **usage_limit**: `UPDATE ... SET used_count = used_count + 1 WHERE used_count < usage_limit`
  — Postgres row lock ทำให้ concurrent 20 requests ผ่านได้เท่า limit เป๊ะ (เทสแล้ว: 20 ยิง limit 5 → ผ่าน 5)
- **per-customer**: นับ usages หลังได้ row lock จาก UPDATE ข้างบน (serialize ต่อ campaign)
- **double-apply**: unique index บน `pos_campaign_usages(bill_id)`
- ทั้งหมดอยู่ใน transaction เดียวกับการปิดบิล — ล้มข้อใดข้อหนึ่ง = บิลไม่เกิด

## Extension points

- discount_type: CHECK เผื่อ `buy_x_get_y`, `free_item` — engine ปฏิเสธชัดเจน (`UNSUPPORTED_DISCOUNT_TYPE`) ไม่ apply เงียบ ๆ
- eligibility: คอลัมน์เดียว ขยายค่า (`customer_group` เมื่อมี segment)
- category scope: UI แปลงหมวด→รายสินค้าเข้า campaign_products (ผูกระดับสินค้า ประวัติไม่เพี้ยนเมื่อย้ายหมวด)
- QR/online ordering: engine เป็น pure function — เรียกจาก createPublicOrder ได้ทันทีเมื่อต้องการ
- `expired` เป็น computed state จาก end_at ไม่เก็บใน DB (ไม่มี cron ให้พลิก status)

## สิ่งที่เลื่อน (มีเหตุผลใน audit)

Manual discount + approval tiers (POS ไม่มี role หลายระดับ) · customer groups · BXGY · ROI analytics

# API

Base: `/api/pos/*` (JWT session) — public ไม่มีทางเข้าถึง

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/pos/campaigns?archived=1` | ลิสต์ + displayStatus |
| POST | `/api/pos/campaigns` | สร้าง (draft เสมอ) · 409 `code_taken` |
| GET | `/api/pos/campaigns/:id` | รายละเอียด + analytics |
| PATCH | `/api/pos/campaigns/:id` | `{action: activate\|pause\|archive\|duplicate}` หรือแก้ field · 409 `campaign_has_usage` เมื่อแก้กติกาที่มี usage |
| POST | `/api/pos/campaigns/preview` | คำนวณก่อนเก็บเงิน (read-only, ราคาอ่านจาก DB) |
| POST | `/api/pos/bills` | ปิดบิล + `campaignId`/`couponCode` · 409 `campaign_rejected {reason}` |

reason codes: `CAMPAIGN_NOT_ACTIVE · CAMPAIGN_NOT_STARTED · CAMPAIGN_EXPIRED · OUTSIDE_TIME_WINDOW · WRONG_DAY_OF_WEEK · MEMBER_REQUIRED · MINIMUM_ORDER_NOT_REACHED · USAGE_LIMIT_REACHED · CUSTOMER_USAGE_LIMIT_REACHED · NO_ELIGIBLE_ITEMS · UNSUPPORTED_DISCOUNT_TYPE`

# Testing

PGlite (Postgres จริงแบบ WASM) รัน migration ทั้ง 74 ไฟล์แล้วเทส — ผ่านทั้งหมด:

- seed 3 campaigns เป็น draft (GRAD-FATONI-69 / Member Welcome / Happy Hour 14:00–17:00)
- 10% ของ 100 = 10.00 · 10% ของ 1,000 cap 50 = 50.00 · 10% ของ 159 = 15.90
- usage limit 3: ยิง 6 → ผ่าน 3 ปฏิเสธ 3, used_count = 3 เป๊ะ
- **concurrent 20 requests, limit 5 → ผ่าน 5 เป๊ะ** (atomic UPDATE)
- per-customer 1: ครั้งที่ 2 ถูกปฏิเสธ
- double-apply บิลเดิมถูก unique index บล็อก
- ส่วนลด > ยอด ถูก CHECK ปฏิเสธ · percentage 150 ถูก CHECK ปฏิเสธ
- code ซ้ำ (case-insensitive) ถูกบล็อก · archive แล้ว reuse ได้
- scope รายสินค้า: Burger ลด Drink ไม่ลด

เทสหลัง deploy (มือ): บิล 159 + GRAD-FATONI-69 → ลด 15.90 · บิล 99 → MINIMUM_ORDER_NOT_REACHED
· ใช้ครั้งที่ 2 เบอร์เดิม → CUSTOMER_USAGE_LIMIT_REACHED · void บิลที่มีส่วนลด → invariant ยังจริง (รัน verify-feedback.sql STEP 4)
