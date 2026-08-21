# HR Module — Rizance Codebase Audit & Architecture Proposal

> วันที่ audit: 21 ส.ค. 2569 · สถานะ: **รอคำสั่งก่อนแตะโค้ด**
> ขอบเขต: rizance-profit (backend + main app) + rizance-pos (POS frontend) ครบทุก migration 0001–0076

---

## 1. Existing Architecture

- **2 repos**: `rizance-profit` = backend (API ทั้งหมด) + main app · `rizance-pos` = POS frontend (แอปแยก origin, เรียก profit ผ่าน `NEXT_PUBLIC_PROFIT_API_URL`, cookie ข้าม subdomain)
- Next.js App Router + raw `pg` (ไม่มี ORM) + Supabase Postgres + Vercel
- เงินทุกจุดคำนวณแบบ cents-string (`lib/money.ts`) — ห้าม float
- Multi-tenancy = `WHERE user_id = $1` ทุก query · **1 user = 1 shop อย่างเข้มงวด** (เขียนกำกับใน migration 0073/0074)
- Business day มี cutoff hour อยู่แล้ว (`lib/businessDay.ts` + pos_shop_settings) — attendance ควรใช้ตัวเดียวกัน
- Testing doctrine ของโปรเจกต์: PGlite รัน migration จริงทั้งหมด + execute โค้ด TS จริง (transpiled) ก่อน deploy

## 2. Existing Database (ที่เกี่ยวกับ HR)

**ไม่มีตาราง HR เลย** — ไม่มี employees / attendance / shifts / payroll / businesses / branches ใน 0001–0076

ที่ใกล้ที่สุด (ห้ามสับสน — ไม่ใช่ HR):

| ตาราง | คืออะไร | ใช้เป็นฐาน HR ได้ไหม |
|---|---|---|
| `booth_members` (0004/0006) | ทีมงานต่ออีเวนต์ มี wage_amount/wage_type (daily/event) — ค่าแรง**ไม่ลง ledger** คำนวณสดใน `lib/booth-split.ts` | ไม่ได้ (ผูก booth ไม่ใช่ร้าน) |
| `shop_members` (0017) | cap table (investor/manager) ไม่มี wage | ไม่ได้ |
| `pos_riders` (0061) | คนส่ง: `id, user_id, name, phone, access_token UUID, is_active` เข้าใช้ผ่านลิงก์ `/r/<token>` ไม่มี session | **เป็นแม่แบบ identity ของ staff ที่ดีที่สุดในระบบ** |
| `overheads` category `'wages'` (0003) | ค่าแรงรายเดือนแบบก้อน ใช้คิด overhead/แก้ว | ไม่ใช่ payroll |

`users` ไม่มี role/is_admin/pin — มีแค่ subscription_plan (free/personal_plus/event_pass/business)

## 3. Existing Finance System

- **`expense_entries`**: category CHECK 8 ค่า — **มี `'wage'` อยู่แล้ว** (label "ค่าแรง", type fixed, legacy `'salary'` ถูก map มาแล้วใน 0009) → payroll ลง expense ได้โดยไม่แตะ constraint
- **Journal engine (0045)**: `journal_entries` + `journal_lines` double-entry, append-only, reversal-based, idempotent ด้วย `UNIQUE (source_module, source_event_id, source_event_type)` — มี adapter 3 ตัว: `pos`, `shop_capital`, `shop_transfer`
- 🔴 **ข้อเท็จจริงสำคัญ**: `expense_entries` (manual) **ไม่ post journal** — double-entry ครอบเฉพาะ POS bills/capital/transfer · Chart of accounts ไม่มีบัญชีค่าแรง (มีถึง 5900)
- Restock วัตถุดิบ → expense_entries category `'materials'` อยู่แล้ว (แม่แบบ flow "โมดูลอื่นสร้าง expense" ที่พิสูจน์แล้ว: `restockIngredientsBatch`)

**ผลต่อ HR**: Payroll → `expense_entries` category `'wage'` = สอดคล้องระบบเดิม 100% และเข้า Dashboard ค่าใช้จ่าย/กำไรทันที · การ post journal ค่าแรง**ยังไม่ควรทำ**จนกว่า expense ทั้งระบบจะเข้า journal (ไม่งั้น ledger เอียงข้าง)

## 4. Existing Auth & Permission

- JWT (HS256, jose) ใน httpOnly cookie `rizance_session` TTL 7 วัน · payload มีแค่ `sub=userId` · bcrypt rounds 10 · Google OAuth มี · rate-limit login มี
- POS API: `requirePosSessionAndPlan(req)` → sentinel `NextResponse` pattern ทุก route
- **ไม่มี RBAC เลย** — คนที่ login = owner เต็มสิทธิ์ ไม่มี manager/staff tier ไม่มี PIN
- Identity ชั้นสอง = **capability URL**: UUID token ต่อคน (riders/members/orders) revoke-rotate ได้ — พิสูจน์ในสนามแล้วกับไรเดอร์

## 5. Existing UI Components (rizance-pos)

- Design system ครบ: `Button(primary/pay/secondary/danger/ghost, sm/md/lg)`, `Card`, `Badge(success/warn/voided)`, `Sheet` (bottom-sheet mobile/modal desktop), `Toast`, `Switch`, `EmptyState`, `Skeleton`, `MoneyBar` (ตัวเลขเงิน signature), `InstallCardButton` (PWA)
- ธีมมืด: tokens `ink/ink-soft/paper/card/line/money-in/danger/warn` + soft variants · ฟอนต์ IBM Plex Sans Thai (display) + Noto Sans Thai (body)
- Nav: `PosNav` 6 แท็บ (ขาย/ออเดอร์/บิล/สินค้า/คลัง/สรุป) mobile bottom bar `grid-cols-6` — **เพิ่มแท็บที่ 7 ต้องแก้ grid + ระวังจอ 390px แน่น**
- Pattern เพจ: ทุกหน้า staff ทำ getSession → 401 → loginUrl ซ้ำ ๆ ~30 บรรทัด/หน้า (ควร extract hook ตอนเพิ่มหน้า HR หลายหน้า)
- ห้ามลืม: หน้า staff = แบรนด์ Rizance POS · หน้า customer = NINENON (HR เป็น staff-side ทั้งหมด → Rizance POS)

## 6. Recommended HR Architecture

หลักการ: **ต่อยอด ไม่สร้างซ้ำ** — ยืม pattern ที่พิสูจน์แล้วทั้งหมด

```
identity   : owner = JWT เดิม · staff = access_token ต่อคน (แบบ pos_riders)
             หน้า staff = /e/<token> (mobile-first, เห็นแค่ของตัวเอง — token คือ scope โดยธรรมชาติ)
tenancy    : user_id = business (ตามระบบเดิม) + ตาราง branches ใหม่ (optional FK)
             → Ninenon วันนี้ = 1 branch · อนาคตเพิ่ม branch ได้โดยไม่ rewrite
attendance : clock in/out ผูก business_date จาก businessDay cutoff เดิม
payroll    : draft → approve → INSERT expense_entries(category='wage')
             idempotent ด้วย UNIQUE + expense_entry_id บน payroll period
labor cost : คำนวณสด = Σ wage expense (หรือ payroll items) ÷ POS paidTotal จาก
             pos-summary เดิม — ไม่มีตัวเลข hardcode (แนวเดียวกับ menu cost 0076)
config     : hr_settings ต่อร้าน (OT multiplier, labor target %, payroll cycle,
             leave types JSONB, performance weights JSONB) — ไม่ hardcode rule
```

**จุดที่จงใจต่างจากสเปค (พร้อมเหตุผล):**

1. **Business → Branch เต็มรูป**: ระบบเดิมคือ 1 user = 1 shop ทุกตาราง pos_* ยึด convention นี้ (เขียนกำกับใน 0073/0074) การใส่ business layer ตอนนี้ = rewrite ทุก query ทั้งระบบ → เสนอ: `branches` ใหม่ + `employees.branch_id` (nullable) เตรียม dimension ไว้ ส่วน business = user_id (บัญชี Rizance หนึ่ง = ธุรกิจหนึ่ง เปิดธุรกิจใหม่ = บัญชีใหม่ ซึ่งตรงกับที่ Ninenon/Iqtishoduna ใช้อยู่จริงวันนี้)
2. **Manager role**: ยังไม่มี manager identity ใน auth เดิม → MVP: owner = ทุกสิทธิ์, staff = token ของตัวเอง · `employees.hr_role ('staff'|'manager')` ใส่ใน schema ตั้งแต่วันแรก แต่ endpoint ฝั่ง manager (approve leave/payroll ผ่านมือถือตัวเอง) เป็น Phase หลัง
3. **Journal posting ของค่าแรง**: ข้ามใน MVP (ดูข้อ 3) — เดินตาม expense_entries เหมือน restock

## 7. Database Schema Proposal (migration 0077)

ทุกตาราง `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` + created_at/updated_at + index ตาม query จริง

```
branches              id, user_id, name, is_active, sort_order
                      UNIQUE(user_id, name)

employees             id, user_id, branch_id FK branches NULL, code VARCHAR(20),
                      name, nickname, phone, photo_url, position,
                      employment_type CHECK (full_time|part_time|temporary|intern),
                      start_date DATE, wage_type CHECK (hourly|daily|monthly),
                      wage_rate NUMERIC(12,2), status CHECK (active|inactive|suspended),
                      hr_role CHECK (staff|manager) DEFAULT 'staff',
                      access_token UUID UNIQUE DEFAULT gen_random_uuid(),  -- /e/<token>
                      emergency_name, emergency_phone
                      UNIQUE(user_id, code)

employee_wage_history id, employee_id, wage_type, wage_rate, effective_date, note
                      -- ค่าแรงย้อนหลังตรวจได้ แบบเดียวกับ ingredient_price_history (0076)

shift_templates       id, user_id, name, start_min SMALLINT, end_min SMALLINT, is_active
                      -- เที่ยงคืนข้ามวันใช้ convention เดียวกับ pos_campaigns time window

shifts                id, user_id, branch_id NULL, employee_id FK employees,
                      shift_date DATE, start_min, end_min, position, note,
                      status CHECK (scheduled|working|completed|absent|cancelled)
                      INDEX (user_id, shift_date) · INDEX (employee_id, shift_date)

attendance            id, user_id, employee_id, business_date DATE,
                      shift_id FK shifts NULL,
                      clock_in_at TIMESTAMPTZ, clock_out_at TIMESTAMPTZ NULL,
                      late_minutes INT DEFAULT 0, ot_minutes INT DEFAULT 0,
                      status CHECK (working|completed|absent|leave),
                      source CHECK (staff_link|owner_manual), note
                      partial UNIQUE (employee_id, business_date) WHERE clock_out_at IS NULL
                      -- DB กัน clock-in ซ้อน แบบเดียวกับ open-order-per-table (0075)

attendance_adjustments id, attendance_id, user_id, field, old_value, new_value,
                      reason, created_at   -- แก้มือทุกครั้งมีรอย (audit)

leave_requests        id, user_id, employee_id, leave_type CHECK (sick|personal|vacation|other),
                      date_from, date_to, reason,
                      status CHECK (pending|approved|rejected|cancelled),
                      decided_at, decided_note

payroll_periods       id, user_id, period_start DATE, period_end DATE,
                      status CHECK (draft|approved|paid),
                      approved_at, expense_entry_id UUID REFERENCES expense_entries NULL,
                      total_amount NUMERIC(12,2)
                      UNIQUE(user_id, period_start, period_end)   -- idempotency ชั้น 1
                      -- approve = สร้าง expense + เซ็ต expense_entry_id ใน tx เดียว
                      -- WHERE expense_entry_id IS NULL             -- idempotency ชั้น 2 (atomic gate
                      --                                               แบบ campaign usage 0074)

payroll_items         id, period_id, employee_id,
                      regular_minutes INT, ot_minutes INT,
                      wage_type, wage_rate NUMERIC(12,2),        -- snapshot ณ วันคิด
                      base_pay, ot_pay, bonus, incentive, deduction, net_pay NUMERIC(12,2)
                      UNIQUE(period_id, employee_id)
                      -- invariant: net_pay = base+ot+bonus+incentive-deduction (CHECK)
                      -- และ Σ payroll_items.net_pay = periods.total_amount = expense amount

hr_settings           user_id PK, ot_multiplier NUMERIC(4,2) DEFAULT 1.5,
                      labor_target_pct NUMERIC(5,2) DEFAULT 30,
                      payroll_cycle CHECK (monthly|semimonthly|weekly) DEFAULT 'monthly',
                      late_grace_minutes INT DEFAULT 5,
                      leave_types JSONB, performance_weights JSONB,
                      incentive แยกเฟส

hr_audit_logs         id, user_id, actor CHECK (owner|staff), employee_id NULL,
                      action, detail JSONB, created_at

-- Phase 7+ (โครงรอไว้ ยังไม่สร้างใน 0077):
-- incentive_rules (id, user_id, name, condition JSONB, reward JSONB, is_active)
-- incentive_results (rule_id, employee_id, period_id, amount)  → รวมเข้า payroll_items.incentive
-- performance_reviews / performance_scores
```

**Invariant การเงินของ HR** (คู่กับ invariant บัญชีเดิม):
`Σ payroll_items.net_pay = payroll_periods.total_amount = expense_entries.amount` — ตรวจใน SQL check + test

## 8. API / Server Action Proposal (rizance-profit)

ตาม pattern `requirePosSessionAndPlan` + envelope `{data}/{error:"code"}` เดิมทุกตัว:

```
Owner (JWT):
/api/pos/hr/employees        GET·POST         /api/pos/hr/employees/[id]  GET·PATCH (รวม rotate token)
/api/pos/hr/branches         GET·POST·PATCH
/api/pos/hr/shifts           GET(?from&to)·POST·PATCH(action: cancel|duplicate|assign)
/api/pos/hr/shift-templates  GET·POST·PATCH
/api/pos/hr/attendance       GET(?date)·POST (manual adjust → attendance_adjustments)
/api/pos/hr/leave            GET·PATCH (approve/reject → sync attendance)
/api/pos/hr/payroll          GET·POST(generate draft จาก attendance)·
                             PATCH [id] (action: approve → expense ใน tx เดียว + atomic gate)
/api/pos/hr/summary          GET — dashboard: people/attendance today/labor cost วันนี้+เดือน
                             (labor% = wage จาก payroll ÷ paidTotal จาก pos-summary เดิม)
/api/pos/hr/settings         GET·PATCH

Staff (token — แบบ /api/public/rider):
/api/public/hr/[token]       GET   ข้อมูลตัวเอง + กะวันนี้ + สถานะ clock
/api/public/hr/[token]/clock POST  {action: in|out} — server ตัดสินเวลา/late/OT เอง client ไม่ส่งเวลา
/api/public/hr/[token]/attendance · /schedule · /payroll · /leave (POST ขอลา)
```

## 9. Page / Route Proposal (rizance-pos)

```
Staff-facing (owner/manager · PosNav แท็บใหม่ "พนักงาน" — grid-cols-6→7):
/hr                หน้าแรก People: การ์ดวันนี้ (มากี่คน สาย ขาด · labor ฿ + % vs target)
                   + ลิงก์เข้าส่วนย่อย   ← ทำเป็นหน้าเดียว + Sheet ตาม pattern เดิม
/hr/employees      ตาราง + สร้าง/แก้/ปิดใช้ + ปุ่มลิงก์พนักงาน (copy /e/<token>) — แบบชีตคนส่ง
/hr/schedule       ตารางกะรายสัปดาห์ (template + custom + duplicate)
/hr/payroll        งวด → draft → รีวิวรายคน → Approve (ยืนยัน 2 ชั้น เพราะสร้าง expense จริง)

Employee self-service (token, mobile-first — แบบ /r/<token>):
/e/<token>         สวัสดี <ชื่อเล่น> · กะวันนี้ · ปุ่มใหญ่ CLOCK IN/OUT (แบบปุ่ม MoneyBar)
                   · เมนู: ตารางกะ / เวลาของฉัน / เงินของฉัน / ขอลา
                   เห็นเฉพาะของตัวเอง — token = scope, เปลี่ยนโทรศัพท์ = rotate token
```

Attendance เต็มหน้า + Leave inbox + Performance + Incentives = Sheet/หน้าใน Phase ถัดไป

## 10. Implementation Roadmap

| Phase | ส่งมอบ | ต้องมี |
|---|---|---|
| 1 | 0077 (branches, employees, wage_history, hr_settings, audit) + CRUD + หน้า /hr/employees + แท็บพนักงาน | — |
| 2 | Attendance: /e/<token> clock in/out + late/OT calc + manual adjust + หน้า /hr วันนี้ | 1 |
| 3 | Shifts: templates + ตารางกะ + ผูก attendance กับกะ (late คิดจากกะจริง) | 2 |
| 4 | Payroll: generate draft จาก attendance + รีวิว + คำนวณ (hourly/daily/monthly + OT) | 2 |
| 5 | **Approve → expense_entries('wage')** + idempotency + Labor Cost บน /hr + /dashboard | 4 |
| 6 | Leave workflow + sync attendance | 2 |
| 7 | Performance (weights ใน hr_settings) + Incentive engine (rule JSONB) → payroll_items | 4 |
| 8 | Analytics: labor % trend, sales/labor-hour, พร้อมข้อมูลสำหรับ staffing suggestion | 5 |

ทุก Phase: PGlite (migration จริง + โค้ดจริง) → tsc ทั้ง 2 repo → migration ให้ Dev รีวิวก่อนรัน → deploy profit ก่อน pos

## 11. Risks / Breaking Changes

1. **Branch/business layer เต็มรูปขัด convention 1 user = 1 shop** — เสนอ branches เป็น dimension เบา ๆ; ถ้าอนาคตต้องการ business layer จริงเป็นงาน foundational แยกต่างหาก
2. **Nav 7 แท็บบนจอ 390px แน่น** — อาจต้องย่อ label หรือรวม "คลัง" เข้า "สินค้า" ภายหลัง (มี script เทส breakpoint อยู่แล้ว)
3. **Staff token ทำ write ได้ (clock in/out)** — ความเสี่ยงเดียวกับไรเดอร์ที่ยอมรับกันแล้ว; ลด risk: clock ทำได้เฉพาะของตัวเอง + rate limit + เวลาตัดสินที่ server เท่านั้น
4. **Payroll แก้หลัง approve** — ห้าม: period ที่ approved แล้วแก้ไม่ได้ (แบบ campaign มี usage 0074) ต้องทำงวดปรับปรุง (adjustment) แทน
5. **expense_entries ไม่ post journal** — Labor cost ใน P&L มาจาก expense ปกติ ถ้าวันหน้าจะให้ journal ครอบ expense ทั้งระบบ ค่อยทำ adapter เดียวครอบทุก category
6. **ไม่มี manager identity** — MVP ให้ owner ทำหน้าที่ manager; hr_role เตรียมไว้แล้วใน schema
7. `.env.local` ใน rizance-pos ถูก commit และมี VERCEL_OIDC_TOKEN (หมดอายุ) — ควรถอดออกจาก repo (พบระหว่าง audit ไม่เกี่ยว HR)

## 12. Phase 1 Implementation Plan (รอคำสั่งก่อนเริ่ม)

1. `db/migrations/0077_hr_core.sql` — branches, employees (+access_token), employee_wage_history (trigger บันทึกเมื่อ wage เปลี่ยน แบบ 0076), hr_settings, hr_audit_logs + seed branch "Ninenon" + hr_settings default ให้ร้านที่มี pos_shop_settings
2. profit: `lib/hr-employee-queries.ts` (CRUD + rotate token + wage history) · `lib/hr-validation.ts` (zod) · routes `/api/pos/hr/employees[...]`, `/api/pos/hr/branches`, `/api/pos/hr/settings`
3. pos: `lib/hr-api.ts` (posFetch wrappers — เริ่มแยกไฟล์ ไม่บวมใส่ api.ts) · หน้า `/hr` + `/hr/employees` (ตาราง + ชีตเพิ่ม/แก้ + ปุ่ม copy ลิงก์พนักงาน + Badge สถานะ) · PosNav แท็บ "พนักงาน" (grid-cols-7)
4. Verify: PGlite — migration 0077 + CRUD จริง + wage history trigger + rerun idempotent · tsc 2 repo · เช็คลิสต์ UI 390px/desktop
5. ส่ง migration ให้รีวิว → deploy profit → pos

---
*หมายเหตุ: สเปคเต็ม (Performance/Incentive/Staff PIN/QR clock-in) ถูกวางโครง schema รอไว้แล้ว — เพิ่มเป็น configuration/rule JSONB ได้โดยไม่แก้ core*
