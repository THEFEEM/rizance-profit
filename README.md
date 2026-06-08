# Rizance Profit

Mobile-first profit tracker for small coffee shops and drink stalls. Open the app and see **today's profit** in under 30 seconds.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · PostgreSQL

## Features (MVP scope)

1. Authentication (register / login / logout)
2. Daily income entry
3. Daily expense entry
4. Profit calculation (always `income − expense`, never stored)
5. Daily summary (with day navigation)
6. Monthly summary (per-day list)

## Prerequisites

- Node.js 20+
- PostgreSQL (local, or hosted e.g. Neon / Supabase)

## Setup

```bash
cd rizance-profit
npm install
cp .env.example .env.local
```

Edit `.env.local`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (`?sslmode=require` for hosted DBs) |
| `JWT_SECRET` | Long random string (≥ 32 chars) for session JWT signing |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run the database migration (idempotent — safe to re-run):

```bash
npm run db:migrate
```

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or the port shown in the terminal).

### Quick test flow

1. **Register** — create a shop at `/register`
2. **Today** — land on `/` with ฿0.00 profit (gray) if no entries yet
3. **+ INCOME** / **− EXPENSE** — use the custom keypad
4. **Stats** — daily summary (`/summary`) and monthly (`/summary/monthly`)

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run db:migrate` | Apply `db/schema.sql` |
| `node scripts/smoke.mjs` | End-to-end API smoke test |
| `node scripts/timezone-check.mjs` | Verify Asia/Bangkok date boundaries |
| `node scripts/profit-colors-check.mjs` | Verify profit sign → color logic |
| `node scripts/cleanup-smoke.mjs` | Remove test users from the database |

Set `SMOKE_BASE_URL=http://localhost:3001` if port 3000 is already in use.

## Important conventions

- **Money** is `NUMERIC(12,2)` in PostgreSQL and handled as exact decimals (never JS `float`).
- **Profit** is computed on read, never stored in a column.
- **"Today"** uses the **Asia/Bangkok** timezone, not UTC or the DB server's `CURRENT_DATE`.
- **`userId`** comes from the JWT httpOnly cookie server-side; the client never sends `user_id`.

## Project layout

```
app/(auth)/          login, register
app/(app)/           protected app (Today, income, expense, summary)
app/api/             thin route handlers
components/          UI (ProfitCard, QuickAmountPad, EntryList, …)
lib/                 db, auth, queries, validation, money, date
db/schema.sql        PostgreSQL schema
```

## Install as PWA

On mobile Chrome/Safari: **Add to Home Screen**. A web manifest and icons are included under `public/`.
