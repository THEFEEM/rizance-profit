// Combined period summary: regular profit + booth net (in-period ∩ booth range).
// Usage: npm run dev, then npm run test:combined-summary
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SignJWT } from "jose";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // skip
  }
}

function toCents(v) {
  return Math.round(Number(v) * 100);
}

function sumDecimals(...values) {
  return (values.reduce((acc, v) => acc + toCents(v), 0) / 100).toFixed(2);
}

function computeProfit(income, expense) {
  return ((toCents(income) - toCents(expense)) / 100).toFixed(2);
}

/** Mirrors lib/queries.ts periodSummary for last_7 anchored to anchorDate */
async function periodSummary(client, userId, start, end) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS expense`,
    [userId, start, end],
  );
  const r = rows[0];
  return { income: r.income, expense: r.expense, profit: computeProfit(r.income, r.expense) };
}

/** Mirrors lib/booth-queries.ts boothNetForPeriod */
async function boothNetForPeriod(client, userId, periodStart, periodEnd) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((
         SELECT SUM(i.amount)
         FROM booth_income_entries i
         JOIN booths b ON b.id = i.booth_id
         WHERE b.user_id = $1
           AND i.entry_date >= $2::date AND i.entry_date <= $3::date
           AND i.entry_date >= b.start_date AND i.entry_date <= b.end_date
       ), 0)::text AS income,
       COALESCE((
         SELECT SUM(e.amount)
         FROM booth_expense_entries e
         JOIN booths b ON b.id = e.booth_id
         WHERE b.user_id = $1
           AND e.entry_date >= $2::date AND e.entry_date <= $3::date
           AND e.entry_date >= b.start_date AND e.entry_date <= b.end_date
       ), 0)::text AS expense`,
    [userId, periodStart, periodEnd],
  );
  const r = rows[0];
  return computeProfit(r.income, r.expense);
}

let cookie = "";
function mergeSetCookies(headers) {
  const jar = new Map();
  for (const part of cookie.split(";")) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    jar.set(t.slice(0, eq), t.slice(eq + 1));
  }
  for (const h of headers) {
    const kv = h.split(";")[0];
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function makeSession(userId) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  cookie = `rizance_session=${token}`;
}

async function detectBase() {
  for (const port of [3000, 3001, 3002]) {
    const base = `http://localhost:${port}`;
    try {
      const res = await fetch(`${base}/api/context`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200 || res.status === 401) return base;
    } catch {
      // skip
    }
  }
  return null;
}

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`      expected: ${expected}`);
  console.log(`      actual:   ${actual}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== COMBINED SUMMARY TEST ===\n");

  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'combined-test', 'Combined') RETURNING id`,
    [`combined-${Date.now()}@rizance.test`],
  );
  userId = users[0].id;
  await makeSession(userId);

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");

  // Period last_7 anchored to 2026-06-10 → 2026-06-04 .. 2026-06-10
  const periodStart = "2026-06-04";
  const periodEnd = "2026-06-10";

  await client.query(
    `INSERT INTO income_entries (user_id, amount, entry_date) VALUES ($1, 100.00, $2::date)`,
    [userId, "2026-06-10"],
  );

  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date)
     VALUES ($1, 'งานทับซ้อน', 500.00, '2026-06-01'::date, '2026-06-08'::date) RETURNING id`,
    [userId],
  );
  const boothId = booths[0].id;

  // In period AND booth range → counts
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 500.00, 'cash', '2026-06-05'::date)`,
    [boothId, userId],
  );
  // In period but OUTSIDE booth end_date → must NOT count
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 200.00, 'cash', '2026-06-09'::date)`,
    [boothId, userId],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, entry_date)
     VALUES ($1, $2, 100.00, 'fixed', '2026-06-05'::date)`,
    [boothId, userId],
  );

  console.log("1) Partial booth/period overlap — only in-range entries count");
  const regular = await periodSummary(client, userId, periodStart, periodEnd);
  const boothNet = await boothNetForPeriod(client, userId, periodStart, periodEnd);
  const combined = sumDecimals(regular.profit, boothNet);

  assertEq("regular profit", regular.profit, "100.00");
  assertEq("booth net (500-100, not 200 on Jun 9)", boothNet, "400.00");
  assertEq("combined", combined, "500.00");
  console.log("");

  console.log("2) API GET /api/summary/combined");
  const res = await fetch(`${base}/api/summary/combined?period=last_7`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  assertEq("API status", String(res.status), "200");
  assertEq("API regularProfit", body?.data?.regularProfit ?? "missing", regular.profit);
  assertEq("API boothProfit", body?.data?.boothProfit ?? "missing", boothNet);
  assertEq("API combinedProfit", body?.data?.combinedProfit ?? "missing", combined);
  console.log("");

  console.log("3) No booth activity → combined equals regular");
  await client.query(`DELETE FROM booth_income_entries WHERE booth_id = $1`, [boothId]);
  await client.query(`DELETE FROM booth_expense_entries WHERE booth_id = $1`, [boothId]);

  const boothNetZero = await boothNetForPeriod(client, userId, periodStart, periodEnd);
  const combinedNoBooth = sumDecimals(regular.profit, boothNetZero);
  assertEq("booth net zero", boothNetZero, "0.00");
  assertEq("combined equals regular", combinedNoBooth, regular.profit);
  console.log("");

  console.log("4) Booth-mode Stats unaffected (no combined card in HTML)");
  await fetch(`${base}/api/context`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ mode: "booth", boothId }),
  }).then((r) => mergeSetCookies(r.headers.getSetCookie?.() ?? []));

  const boothPage = await fetch(`${base}/summary?period=last_7`, {
    headers: { Cookie: cookie },
  });
  const html = await boothPage.text();
  assertEq("booth stats page 200", String(boothPage.status), "200");
  assertEq(
    "no combined section in booth mode",
    html.includes("กำไรรวม (ร้าน + บูธทั้งหมด)") ? "found" : "absent",
    "absent",
  );
  console.log("");

  if (failed === 0) {
    console.log("All assertions passed.");
  } else {
    console.error(`${failed} assertion(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
} finally {
  if (userId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log("(test user cleaned up — CASCADE)");
  }
  await client.end();
}
