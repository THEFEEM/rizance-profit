# Deploy Rizance Profit to Vercel + Neon

## Prerequisites

- GitHub account
- [Vercel](https://vercel.com) account (free tier works)
- [Neon](https://neon.tech) project with schema migrated (see below)

## 1. Push to GitHub

From the `rizance-profit` folder:

```bash
# First time only — create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USER/rizance-profit.git
git branch -M main
git push -u origin main
```

**Never commit `.env.local`.** It is gitignored. Only `.env.example` (placeholders) is tracked.

Verify before pushing:

```bash
git status          # .env.local must NOT appear
git check-ignore -v .env.local   # should show .gitignore rule
```

## 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. **Import Git Repository** → select `rizance-profit`
3. Framework preset: **Next.js** (auto-detected)
4. Root directory: **`rizance-profit`** if the repo root is `Rizance/` parent; otherwise leave as `.`
5. Build command: `npm run build` (default)
6. Output directory: `.next` (default)
7. **Do not deploy yet** — add environment variables first (step 3)

## 3. Environment variables on Vercel

In **Project → Settings → Environment Variables**, add:

| Name | Value | Environments |
|------|-------|--------------|
| `DATABASE_URL` | Your Neon **pooled** connection string (see below) | Production, Preview |
| `JWT_SECRET` | A **new** random secret (≥ 32 chars), not your local dev secret | Production, Preview |

Generate a production `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`NODE_ENV`, `VERCEL`, and `VERCEL_ENV` are set automatically by Vercel — do not add them.

## 4. Point at Neon

In the [Neon console](https://console.neon.tech):

1. Open your project → **Connection details**
2. Enable **Pooled connection**
3. Copy the URI. It looks like:

   ```
   postgresql://neondb_owner:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Paste into Vercel as `DATABASE_URL`

**Use the pooler host** (`-pooler` in the hostname) for serverless — direct connections exhaust Neon limits on Vercel.

### Run the schema (one time)

From your machine (with `DATABASE_URL` set to the same Neon URI):

```bash
npm run db:migrate
```

Or paste `db/schema.sql` into the Neon **SQL Editor** and run it. Safe to re-run (`IF NOT EXISTS`).

## 5. Deploy

Click **Deploy** (or push to `main` if Git integration is connected).

After deploy, open your `*.vercel.app` URL:

1. Register a shop
2. Add income / expense
3. Confirm today's profit on the home screen

## 6. Smoke test production (optional)

```bash
SMOKE_BASE_URL=https://your-app.vercel.app node scripts/smoke.mjs
```

## Security checklist

| Item | Status |
|------|--------|
| `.env.local` gitignored | ✓ |
| Cookies `httpOnly` | ✓ always |
| Cookies `Secure` | ✓ on Vercel (HTTPS) |
| Cookies `SameSite=Lax` | ✓ |
| HSTS header | ✓ on Vercel |
| HTTP → HTTPS redirect | ✓ on Vercel |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `JWT_SECRET is missing` | Add `JWT_SECRET` in Vercel env vars, redeploy |
| DB connection errors | Use **pooled** Neon URI with `?sslmode=require` |
| Login works locally, not on Vercel | Ensure production `JWT_SECRET` is set; cookies require HTTPS (Vercel provides this) |
| Tables missing | Run `npm run db:migrate` against production `DATABASE_URL` |
