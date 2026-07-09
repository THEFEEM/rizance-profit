# POS Schema Discovery — Rizance Profit (Shop Mode)

> **Scope:** Read-only survey of `rizance-profit` codebase for a future POS web app sharing the same Supabase Postgres database.  
> **Survey date:** 2026-07-05  
> **Branch surveyed:** `feature/clear-data-and-partners` (representative of current schema)

---

## Executive summary (POS-relevant)

| Concept | Reality in this codebase |
|---------|--------------------------|
| “Shop” entity | **No `shops` table.** Shop mode = one `users` row per owner; shop display name is `users.shop_name`. |
| Shop income | Table **`income_entries`**, scoped by **`user_id`** → `users(id)`. |
| Shop expense | Table **`expense_entries`**, same scoping. |
| RLS | **ไม่พบ** ใน migrations / schema / app SQL. Access control is **app-layer** (JWT session + `user_id` in queries). |
| DB triggers / Postgres RPC | **ไม่พบ** ใน `db/`. Multi-step writes use **Node `pg` pool + `BEGIN`/`COMMIT`** in TypeScript. |
| On-hand balances | **Not cached.** `cashOnHand` / `transferOnHand` are **derived at read time** from `SUM(...)` over entries (see `lib/shop-on-hand.ts`). |
| Income insert side effects | **`createIncome`** = single `INSERT`; no ledger sync (contrast: `capital_transactions` → syncs `shop_members.investment_amount`). |
| Active subscription check | **`users.subscription_plan`** + **`users.subscription_expires_at`** via `getActiveSubscriptionPlan()` (`lib/subscription-user.ts`). Legacy **`user_subscriptions`** table still exists but is separate (Omise-era). |

---

## 1. ตาราง Shop

### 1.1 ชื่อตารางจริง

**ไม่พบตาราง `shops`.**

Shop mode ในระบบนี้ model เป็น **1 user = 1 ร้าน (MVP)**:

- ข้อมูล “ร้าน” อยู่บนตาราง **`users`**
- หุ้นส่วน/สมาชิกร้าน อยู่บนตาราง **`shop_members`**

ยืนยันจาก:

```30:31:c:\Rizance\rizance-profit\app\api\settings\clear-all-data\route.ts
/** Regular shop mode — one shop per user (no shops table; scoped by user_id). */
```

```8:9:c:\Rizance\rizance-profit\db\schema.sql
-- users  (the shop owner; one owner == one shop in the MVP)
-- =========================================================
```

### 1.2 โครงสร้าง `users` (ตัวแทน “ร้าน” + owner)

Canonical definition ใน `db/schema.sql` (บรรทัด 11–25) รวม migrations ที่เกี่ยวข้อง:

| Column | Type | Nullable | Default | Source |
|--------|------|----------|---------|--------|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | `db/schema.sql:12` |
| `email` | `VARCHAR(255)` | NOT NULL | — | `db/schema.sql:13` (UNIQUE) |
| `password_hash` | `VARCHAR(255)` | **NULL allowed** | — | `db/schema.sql:14`; nullable since `db/migrations/0018_google_auth.sql:7-8` |
| `shop_name` | `VARCHAR(120)` | NOT NULL | — | `db/schema.sql:15` |
| `currency` | `CHAR(3)` | NOT NULL | `'THB'` | `db/schema.sql:16` |
| `monthly_budget` | `NUMERIC(12,2)` | NULL | — | `db/migrations/0016_personal_mode.sql:41-42` |
| `google_id` | `VARCHAR(255)` | NULL | — | `db/migrations/0018_google_auth.sql:10-11` (UNIQUE) |
| `display_name` | `VARCHAR(160)` | NULL | — | `db/migrations/0018_google_auth.sql:13-14` |
| `avatar_url` | `TEXT` | NULL | — | `db/migrations/0018_google_auth.sql:16-17` |
| `auth_provider` | `VARCHAR(20)` | NOT NULL | `'email'` | `db/migrations/0018_google_auth.sql:19-20`; CHECK `('email','google','both')` lines 36-38 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | `db/schema.sql:23` |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | `db/schema.sql:24` |
| `subscription_plan` | `TEXT` | NOT NULL | `'free'` | `db/migrations/0032_subscription.sql:9-11` |
| `subscription_expires_at` | `TIMESTAMPTZ` | NULL | — | `db/migrations/0032_subscription.sql:12` |
| `stripe_customer_id` | `TEXT` | NULL | — | `db/migrations/0032_subscription.sql:13` |
| `stripe_subscription_id` | `TEXT` | NULL | — | `db/migrations/0032_subscription.sql:14` |

**หมายเหตุ:** `subscription_plan` CHECK constraint ถูกขยายใน `db/migrations/0034_personal_plus.sql:9-13` เป็น:

`'free', 'personal_plus', 'event_pass', 'business'`

**ไม่พบ** `subscription_*` columns ใน `db/schema.sql` (มีแค่ใน migrations 0032/0034).

### 1.3 Primary key และ owner

- **PK:** `users.id` (`db/schema.sql:12`)
- **Owner ของร้าน:** คือ row ใน `users` เอง — ไม่มี FK แยก
- ทุก transaction ของ Shop mode อ้าง **`user_id`** → `users(id) ON DELETE CASCADE`

### 1.4 ตาราง `shop_members` (หุ้นส่วน — ไม่ใช่ entity ร้าน)

```99:107:c:\Rizance\rizance-profit\db\schema.sql
CREATE TABLE IF NOT EXISTS shop_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(120) NOT NULL,
  role              VARCHAR(20) NOT NULL DEFAULT 'investor'
    CHECK (role IN ('investor', 'manager')),
  investment_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (investment_amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- **PK:** `shop_members.id`
- **Owner link:** `shop_members.user_id` → `users.id` (`db/migrations/0017_shop_members.sql:9`)

### 1.5 RLS policies

**ไม่พบ**

ค้นหาแล้วใน:

- `db/migrations/*.sql` — ไม่มี `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`
- `db/schema.sql` — ไม่มี RLS
- ทั้ง repo (`grep ROW LEVEL SECURITY|CREATE POLICY`) — ไม่พบ

ระบบใช้ **Postgres ผ่าน `DATABASE_URL` + app auth** (`lib/db.ts`), ไม่ใช่ Supabase client SDK + RLS ใน codebase นี้

---

## 2. ตารางรายรับ (Income) — Shop mode

### 2.1 ชื่อตาราง

**`income_entries`** — ใช้เฉพาะ Shop/Regular mode

```28:44:c:\Rizance\rizance-profit\db\schema.sql
-- income_entries  (money in)
-- category: storefront | online | delivery | service | other_income | misc
-- =========================================================
CREATE TABLE IF NOT EXISTS income_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category   VARCHAR(40) NOT NULL DEFAULT 'storefront'
             CHECK (category IN (
               'storefront', 'online', 'delivery', 'service', 'other_income', 'misc'
             )),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
             CHECK (payment_method IN ('cash', 'transfer')),
  note       VARCHAR(255),
  entry_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2 Evolution (migrations)

| Migration | Change |
|-----------|--------|
| `0001_init.sql:14-21` | สร้างตาราง (ไม่มี category/payment_method) |
| `0002_drop_entry_date_default.sql:4` | ลบ DEFAULT ของ `entry_date` |
| `0005_income_category.sql:4-6` | เพิ่ม `category` (3 keys เริ่มต้น) |
| `0009_category_system_round1.sql:9-39` | ขยาย category CHECK เป็น 6 keys + เพิ่ม `payment_method` |

### 2.3 Foreign keys, constraints, triggers

**Foreign keys**

- `user_id` → `users(id) ON DELETE CASCADE` (`db/schema.sql:33`)

**CHECK constraints**

- `amount >= 0` (`db/schema.sql:34`)
- `income_entries_category_check` — 6 category keys (`db/schema.sql:36-38`, จาก `0009`)
- `income_entries_payment_method_check` — `'cash' | 'transfer'` (`db/schema.sql:39-40`, จาก `0009`)

**Indexes**

- `idx_income_user_date ON (user_id, entry_date)` (`db/schema.sql:73`)

**Triggers**

**ไม่พบ** — ค้นหา `CREATE TRIGGER` / `CREATE FUNCTION` ใน `db/` ทั้งหมด ไม่มีผลลัพธ์

### 2.4 Category system

**ไม่มีตาราง category แยก** — category เป็น **VARCHAR column + CHECK constraint** บน `income_entries`

ค่าที่อนุญาต (DB): `storefront`, `online`, `delivery`, `service`, `other_income`, `misc`

**Fixed list ใน app** (ไม่ให้ user สร้าง category เอง):

```6:13:c:\Rizance\rizance-profit\lib\expense-categories.ts
export const INCOME_CATEGORY_KEYS = [
  "storefront",
  "online",
  "delivery",
  "service",
  "other_income",
  "misc",
] as const;
```

Label/icon อยู่ใน `INCOME_CATEGORIES` (`lib/expense-categories.ts:45-52`) — เป็น constants ใน TypeScript เท่านั้น

**Default ตอน insert:** `"storefront"` (`lib/queries.ts:241`)

**POS implication:** ปิดบิล POS น่าจะใช้ category `'storefront'` (ขายหน้าร้าน) + `payment_method` ตามช่องทางรับเงิน

### 2.5 โค้ดที่ insert รายรับ Shop mode

#### Primary path — direct INSERT (ไม่ใช่ RPC)

**`lib/queries.ts` → `createIncome()`** (lines 239–250):

```239:250:c:\Rizance\rizance-profit\lib\queries.ts
export async function createIncome(userId: string, input: IncomeInput): Promise<Income> {
  const entryDate = input.entryDate ?? today();
  const category = input.category ?? "storefront";
  const paymentMethod = input.paymentMethod ?? "cash";
  const { rows } = await query<IncomeRow>(
    `INSERT INTO income_entries (user_id, amount, category, payment_method, note, entry_date)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     RETURNING id, amount, category, payment_method, note, entry_date::text AS entry_date, created_at`,
    [userId, input.amount.toFixed(2), category, paymentMethod, input.note ?? null, entryDate],
  );
  return mapIncome(rows[0]);
}
```

**Logic สรุป:**

1. Resolve `entryDate` (default `today()`)
2. Default `category = "storefront"`, `paymentMethod = "cash"`
3. Single `INSERT` via `pool.query` (`lib/db.ts:37-42`)
4. Return mapped row — **ไม่มี transaction wrapper**

#### API entry points ที่เรียก `createIncome`

| File | Path | Notes |
|------|------|-------|
| `app/api/income/route.ts:26` | `POST /api/income` | Manual entry form; validates `incomeSchema` |
| `app/api/chat/route.ts:60-66` | `POST /api/chat` | Rizq AI บันทึกรายรับ; หัก token ก่อน (see below) |
| `app/api/chat/scan/route.ts:125` | `POST /api/chat/scan` | Slip scan → income |

#### Other INSERT paths (ไม่ผ่าน `createIncome`)

| File | Context |
|------|---------|
| `app/api/chat/[messageId]/update-kind/route.ts:168` | Toggle card income↔expense; raw `INSERT INTO income_entries` ใน transaction |
| `app/api/chat/[messageId]/confirm-receipt/route.ts` | Receipt split → **expense only** (not income) |

**ไม่พบ** Postgres `CREATE FUNCTION` / Supabase RPC สำหรับ income insert

### 2.6 Side effects ของการ insert รายรับ

#### ภายใน `createIncome` เอง

**ไม่มี side effect ใน DB** — แค่ 1 row ใน `income_entries`

- ไม่ sync cache column ใดๆ
- ไม่ insert ตารางอื่น
- ไม่มี trigger

#### On-hand / ยอดเงินคงเหลือ (derived, not synced)

ยอด **เงินสด / เงินโอน** คำนวณตอน **อ่าน** จาก:

```17:41:c:\Rizance\rizance-profit\lib\shop-on-hand.ts
export async function computeShopOnHand(
  userId: string,
  client?: PoolClient,
): Promise<ShopOnHand> {
  const [income, expense, transfers, profitWd] = await Promise.all([
    allTimeIncomeByCashTransfer(userId, client),
    allTimeExpenseByCashTransfer(userId, client),
    allTimeTransfersByDirection(userId, client),
    allTimeProfitWithdrawalsByMethod(userId, client),
  ]);
  // cashOnHand = income.cash + transferToCash − expense.cash − cashToTransfer − cashWithdrawals
  // transferOnHand = income.transfer + cashToTransfer − expense.transfer − transferToCash − transferWithdrawals
```

Income ใหม่จะ **สะท้อนใน on-hand ทันทีเมื่อ query ครั้งถัดไป** — ไม่ต้อง sync แยก

`allTimeIncomeByCashTransfer` (`lib/queries.ts:667-681`):

```sql
SELECT COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0) AS cash_income,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END), 0) AS transfer_income
FROM income_entries WHERE user_id = $1
```

#### เปรียบเทียบกับ pattern `investment_amount` (capital)

`shop_members.investment_amount` **เป็น synced cache** ของ ledger:

```68:76:c:\Rizance\rizance-profit\lib\shop-capital-queries.ts
const SYNC_INVESTMENT_SQL = `
  UPDATE shop_members SET investment_amount = (
    SELECT COALESCE(SUM(
      CASE WHEN direction = 'contribution' THEN amount ELSE -amount END
    ), 0)
    FROM capital_transactions
    WHERE member_id = $2 AND user_id = $1
  )
  WHERE id = $2 AND user_id = $1`;
```

เรียกหลัง `INSERT INTO capital_transactions` ใน transaction (`createCapitalTx`, lines 148-175)

**Income ไม่มี pattern แบบนี้** — profit/on-hand เป็น derived aggregate

#### Side effects ผ่าน caller (ไม่ใช่ใน `createIncome`)

| Caller | Extra side effect |
|--------|-------------------|
| `POST /api/chat` | `insertChatMessage` (chat history) + `checkAndDeductTokens` (`lib/token-budget.ts`) ก่อนบันทึก |
| `POST /api/income` | ไม่มี — แค่ insert + JSON response |
| Rizq scan routes | Token budget + chat messages (ถ้าใช้ chat flow) |

#### Profit

Comment ใน schema: profit **never stored** — always derived (`db/schema.sql:2`)

---

## 3. ตารางรายจ่าย (Expense) — Shop mode (ย่อ)

### 3.1 ชื่อตาราง

**`expense_entries`**

```50:68:c:\Rizance\rizance-profit\db\schema.sql
CREATE TABLE IF NOT EXISTS expense_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category   VARCHAR(40) NOT NULL DEFAULT 'expense_misc'
             CHECK (category IN (
               'rent', 'wage', 'equipment', 'materials',
               'utilities', 'shipping', 'marketing', 'expense_misc'
             )),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
             CHECK (payment_method IN ('cash', 'transfer')),
  note       VARCHAR(255),
  entry_date DATE NOT NULL,
  is_advance BOOLEAN NOT NULL DEFAULT false,
  payer_name VARCHAR(120),
  payer_kind VARCHAR(20) DEFAULT 'external'
    CHECK (payer_kind IS NULL OR payer_kind IN ('member', 'external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.2 Key migrations

| Migration | Added |
|-----------|-------|
| `0001_init.sql` | Base table + category |
| `0009_category_system_round1.sql` | 8 category keys |
| `0019_fix_pack_h.sql:17-21` | `is_advance`, `payer_name` |
| `0022_phase3_expense_payment.sql` | `payment_method` |
| `0027_expense_payer_kind.sql` | `payer_kind` (advance rows) |

### 3.3 Insert pattern (void/reversal reference)

**`lib/queries.ts` → `createExpense()`** (lines 315-341) — single INSERT, same style as income

**Reversal pattern ในระบบ:** ไม่มี “void” flag — ใช้ **`DELETE`** (`deleteExpense`, line 279+) หรือ insert แถวใหม่ (creditor repayment สร้าง expense คู่กับ repayment record)

**Multi-row atomic insert ตัวอย่าง (receipt split):** `app/api/chat/[messageId]/confirm-receipt/route.ts:48-80` — `BEGIN` → loop `INSERT expense_entries` → `UPDATE chat_messages` → `COMMIT`

**On-hand note:** advance expenses (`is_advance = true`) **ถูก exclude** จาก on-hand calculation (`lib/queries.ts:713-714`)

---

## 4. Auth / Cookie

### 4.1 Session cookie

| Property | Value | Source |
|----------|-------|--------|
| Name | `rizance_session` | `lib/jwt.ts:5` (`SESSION_COOKIE`) |
| httpOnly | `true` | `lib/jwt.ts:40` |
| secure | `true` on Vercel; `false` on local HTTP | `lib/jwt.ts:41` via `useSecureCookies()` (`lib/env.ts:23-25`) |
| sameSite | `"lax"` | `lib/jwt.ts:42` |
| path | `"/"` | `lib/jwt.ts:43` |
| maxAge | 7 days (604800s) | `lib/jwt.ts:6`, `51` |
| domain | **ไม่ตั้ง** (browser default) | ค้นหา `domain:` ใน `*.ts` — ไม่พบ |

**Set cookie ที่:**

- `app/api/auth/login/route.ts:49`
- `app/api/auth/register/route.ts:63`
- `app/api/auth/google/callback/route.ts:90`
- Clear: `app/api/auth/logout/route.ts:6`

### 4.2 Context cookie (mode — ไม่ใช่ auth)

| Property | Value | Source |
|----------|-------|--------|
| Name | `rizance_context` | `lib/context.ts:10` |
| Values | `regular`, `personal`, `booth:{uuid}`, `project:{uuid}` | `lib/context.ts:33-39` |
| maxAge | 1 year | `lib/context.ts:11` |
| Same flags | httpOnly, secure (Vercel), sameSite lax, path `/` | `lib/context.ts:16-23` |

POS ที่ผูก Shop mode ต้อง set/ respect `rizance_context = regular` (หรือ POS มี auth แยกแต่ insert ด้วย `user_id` ที่ถูกต้อง)

### 4.3 JWT sign/verify

| Item | Detail |
|------|--------|
| File | `lib/jwt.ts` |
| Library | `jose` (`SignJWT`, `jwtVerify`) |
| Algorithm | HS256 (`lib/jwt.ts:19`) |
| Payload | `sub` = user UUID only (no roles/plan in token) |
| Secret env | **`JWT_SECRET`** (`lib/jwt.ts:9-11`) — min length 16 |
| Verify | `verifySession()` → returns `sub` or null (`lib/jwt.ts:27-34`) |
| Session resolution | `lib/session.ts` → `getUserId()` reads cookie, verifies JWT |

Re-export: `lib/auth.ts:6-8`

### 4.4 Middleware

**File:** `middleware.ts`

**Logic สรุป:**

1. Force HTTPS on Vercel if `x-forwarded-proto === http`
2. Redirect legacy host `rizance-profit.vercel.app` → canonical app URL
3. Pass through static/PWA files
4. Read `rizance_session` cookie → `verifySession()`
5. Authenticated `/` → redirect `/home`
6. Authenticated `/login|/register` → redirect `/home`
7. Unauthenticated non-public paths → redirect `/login?next=...`
8. **Public paths:** `/`, `/login`, `/register`, `/pricing` (`middleware.ts:5`)
9. **API routes excluded** from matcher (`middleware.ts:63-64`) — API auth ทำใน route handler เอง via `getUserId(req)`

---

## 5. Subscription / Plan

### 5.1 ตารางที่เก็บ subscription

#### Active path (Stripe — ใช้ใน app ปัจจุบัน)

**Columns บน `users`** (migration `0032_subscription.sql:9-14`, constraint extended `0034`):

| Column | Type | Notes |
|--------|------|-------|
| `subscription_plan` | `TEXT NOT NULL DEFAULT 'free'` | CHECK 见 0034 |
| `subscription_expires_at` | `TIMESTAMPTZ` | null = treat as free when resolving |
| `stripe_customer_id` | `TEXT` | |
| `stripe_subscription_id` | `TEXT` | |

Related audit table: **`stripe_payments`** (`0032_subscription.sql:16-27`)

#### Legacy path (Omise era — ยังมีใน DB)

**`user_subscriptions`** (`db/migrations/0021_e8_1_subscriptions.sql:11-18`):

- PK: `user_id`
- `tier` CHECK: `'free','event_pass','business','business_pro','org_lite','org_pro'`
- Used by `lib/subscription.ts` (`getActiveTier`) — **ไม่ใช่ path หลักของ Stripe flow ปัจจุบัน**

### 5.2 โค้ดเช็ค plan

| Helper | File | Logic |
|--------|------|-------|
| `getActiveSubscriptionPlan(userId)` | `lib/subscription-user.ts:24-32` | Read `users.subscription_plan` + `subscription_expires_at` → `resolveActivePlan()` |
| `resolveActivePlan(plan, expiresAt)` | `lib/subscription-plan.ts:47-57` | Expired or missing expiry → `'free'` |
| `getPlanLimits(plan)` | `lib/usage.ts:43-78` | Count-based limits (deprecated path) |
| `checkAndDeductTokens()` | `lib/token-budget.ts` | Token budget (current quota system) |
| `GET /api/subscription` | `app/api/subscription/route.ts` | Returns plan for UI |

### 5.3 Plan values ใน database

| Plan | `users.subscription_plan` value | Notes |
|------|-----------------------------------|-------|
| Free | `'free'` | Default |
| Business | `'business'` | Stripe subscription ฿99/mo (`lib/subscription-plan.ts:23-28`) |
| Personal Plus | `'personal_plus'` | Added `0034`; personal mode plan |
| Event Pass | `'event_pass'` | One-time; booth-oriented |

**Business plan string ใน DB: `'business'`** (exact lowercase snake_case)

Expiry gate: ต้องมี `subscription_expires_at > now()` มิฉะนั้น `resolveActivePlan` คืน `'free'`

---

## 6. Migrations

### 6.1 เลข migration ล่าสุด

**`0037`** — ไฟล์ **`db/migrations/0037_booth_expense_payment_method.sql`**

(ลำดับไฟล์ใน `db/migrations/`: 0001 … 0037)

### 6.2 ตัวอย่าง migration ล่าสุดที่สร้างตาราง (+ RLS convention)

Migration ล่าสุดที่ **`CREATE TABLE`** คือ **`0035_token_budgets.sql`** (0036/0037 เป็น `ALTER TABLE` เท่านั้น)

**RLS:** ไฟล์นี้ **ไม่มี RLS** — สอดคล้องกับ convention ทั้ง repo (ไม่มี RLS ใน migration ใดๆ)

**Copy ทั้งไฟล์:**

```sql
-- Rizance Profit — Migration 0035 (token-based AI budgets)
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS token_budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  tokens_total  INTEGER NOT NULL,
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  period        TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_budgets_user_scope_period_idx
  ON token_budgets (user_id, scope, COALESCE(period, 'none'));

CREATE INDEX IF NOT EXISTS token_budgets_user_scope_idx
  ON token_budgets (user_id, scope);

CREATE TABLE IF NOT EXISTS token_costs (
  action  TEXT PRIMARY KEY,
  tokens  INTEGER NOT NULL
);

INSERT INTO token_costs (action, tokens) VALUES
  ('rizq_chat',    1500),
  ('scan_slip',    800),
  ('scan_receipt', 3000)
ON CONFLICT (action) DO NOTHING;

COMMIT;
```

**Convention ที่สังเกต:**

- ไฟล์ชื่อ `{NNNN}_{snake_description}.sql`
- มัก wrap ใน `BEGIN;` … `COMMIT;`
- ใช้ `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` เพื่อ idempotent
- Comment header ระบุ scope และ “DO NOT RUN until approved”
- **ไม่มี** `ENABLE ROW LEVEL SECURITY` / policies

---

## 7. RPC Pattern

### 7.1 Postgres functions (Supabase RPC)

**ไม่พบ**

ค้นหา `CREATE FUNCTION`, `CREATE OR REPLACE FUNCTION`, `$$ LANGUAGE` ใน `db/` — ไม่มีผลลัพธ์

### 7.2 App-level multi-table transactions (convention จริง)

ระบบใช้ **`pg` PoolClient** + **`BEGIN` / `COMMIT` / `ROLLBACK`** ใน TypeScript

ตัวอย่างที่ดีที่สุดสำหรับ POS (atomic validation + multi insert): **`createCreditorRepayment`** — shop creditor จ่ายคืน + สร้าง expense คู่กัน

**File:** `lib/creditor-repayment-queries.ts:140-207`

```typescript
export async function createCreditorRepayment(
  userId: string,
  input: CreditorRepaymentInput,
  owedAmount: string,
): Promise<CreditorRepayment> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockShopUser(client, userId);

    // 1) Validate remaining owed
    const repaid = await sumRepaidByCreditor(...);
    if (toCents(amount) > availableCents) throw new RepaymentExceedsOwedError(...);

    // 2) Validate on-hand for payment method
    const onHand = await computeShopOnHand(userId, client);
    if (toCents(amount) > toCents(methodOnHand)) throw new ShopOnHandInsufficientError(...);

    // 3) Insert creditor_repayments
    await client.query(`INSERT INTO creditor_repayments (...) VALUES (...)`, [...]);

    // 4) Insert matching expense_entries (shop cash out)
    await client.query(
      `INSERT INTO expense_entries (user_id, amount, category, payment_method, note, entry_date)
       VALUES ($1, $2, 'expense_misc', $3, $4, $5::date)`,
      [userId, amount, paymentMethod, expenseNote, entryDate],
    );

    await client.query("COMMIT");
    return mapCreditorRepayment(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

**Pattern อื่นที่ใช้ `BEGIN`:**

| File | Use case |
|------|----------|
| `lib/shop-capital-queries.ts:148-175` | Capital tx + sync `investment_amount` |
| `lib/shop-profit-withdrawal-queries.ts:154+` | Profit withdrawal |
| `lib/shop-member-queries.ts:53+` | Member CRUD batch |
| `app/api/chat/[messageId]/confirm-receipt/route.ts:48+` | Receipt split → N expenses + update chat |
| `app/api/webhooks/stripe/route.ts:51+` | Stripe webhook → update user plan |

**สำหรับ POS ปิดบิล:** ถ้าต้องการ atomic “bill + income + optional inventory” ควรทำแบบ app transaction เดียวกับ convention นี้ (หรือเพิ่ม Postgres function ใหม่ — ยังไม่มี precedent ใน repo)

---

## Appendix A — POS insert checklist (recommended fields)

เมื่อ POS ปิดบิล → insert เข้า `income_entries`:

| Field | Recommended | Required DB |
|-------|-------------|-------------|
| `user_id` | Owner UUID จาก session | NOT NULL |
| `amount` | Bill total | NOT NULL, `>= 0` |
| `category` | `'storefront'` | NOT NULL, CHECK |
| `payment_method` | `'cash'` or `'transfer'` | NOT NULL, CHECK |
| `note` | e.g. POS bill id / table | NULL ok |
| `entry_date` | Business date (Bangkok) | NOT NULL, no DB default (since 0002) |

**ไม่ต้อง** update cache อื่น — on-hand จะถูกต้องเมื่อ aggregate ครั้งถัดไป

---

## Appendix B — Files searched (not found)

| Item | Search locations |
|------|------------------|
| `shops` table | `grep shops`, `CREATE TABLE.*shop` in `db/` |
| RLS policies | `grep ROW LEVEL SECURITY\|CREATE POLICY` entire repo |
| Triggers on `income_entries` | `grep TRIGGER` in `db/` |
| Postgres RPC functions | `grep CREATE FUNCTION` in `db/` |
| Cookie `domain` attribute | `grep domain:` in `*.ts` |
| `subscription_plan` in schema.sql | `grep subscription` in `db/schema.sql` (only legacy `user_subscriptions`) |

---

*End of report.*
