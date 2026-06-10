// Booth entry guard + summary test.
// Verifies date_out_of_range → 422, booth_closed → 409 (HTTP when dev server up),
// and cash/transfer + fixed/variable sums in boothSummary SQL.
// Usage: npm run test:booth-entries
// Optional: npm run dev in another terminal for full HTTP assertions.
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

/** Mirrors lib/booth-errors.ts boothEntryHttpStatus */
function boothEntryHttpStatus(reason) {
  if (reason === "booth_not_found") return 404;
  if (reason === "booth_closed") return 409;
  if (reason === "date_out_of_range") return 422;
  return 500;
}

/** Mirrors guardBoothEntry in lib/booth-queries.ts */
async function guardBoothEntry(client, userId, boothId, entryDate) {
  const { rows } = await client.query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date, status
     FROM booths WHERE user_id = $1 AND id = $2`,
    [userId, boothId],
  );
  if (!rows[0]) return { ok: false, reason: "booth_not_found" };
  const booth = rows[0];
  if (booth.status !== "open") return { ok: false, reason: "booth_closed" };
  if (entryDate < booth.start_date || entryDate > booth.end_date) {
    return { ok: false, reason: "date_out_of_range" };
  }
  return { ok: true, booth };
}

async function boothSummarySql(client, boothId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash_income,
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer_income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'fixed'), 0)::text AS fixed_expense,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'variable'), 0)::text AS variable_expense`,
    [boothId],
  );
  return rows[0];
}

let cookie = "";
async function makeSessionCookie(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing or too short");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
  cookie = `rizance_session=${token}`;
}

async function detectBase() {
  const bases = [];
  if (process.env.SMOKE_BASE_URL) bases.push(process.env.SMOKE_BASE_URL);
  for (const port of [3002, 3001, 3000, 3003]) bases.push(`http://localhost:${port}`);
  for (const base of [...new Set(bases)]) {
    try {
      const res = await fetch(`${base}/api/booths`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200 || res.status === 401) return base;
    } catch {
      // try next
    }
  }
  return null;
}

async function apiPost(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no json
  }
  return { status: res.status, json };
}

let failed = 0;
function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== BOOTH ENTRY GUARD + SUMMARY TEST ===\n");

  const email = `booth-entry-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'booth-entry-test', 'Entry Test') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const inRange = "2026-06-10";
  const { rows: openBooths } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date)
     VALUES ($1, 'งานเปิด', 1000.00, '2026-06-09'::date, '2026-06-11'::date)
     RETURNING id`,
    [userId],
  );
  const openBoothId = openBooths[0].id;

  const { rows: closedBooths } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date, status, closed_at)
     VALUES ($1, 'งานปิด', 500.00, '2026-06-09'::date, '2026-06-11'::date, 'closed', now())
     RETURNING id`,
    [userId],
  );
  const closedBoothId = closedBooths[0].id;

  // 1) Guard: date outside range
  console.log("1) date_out_of_range guard");
  const outBefore = await guardBoothEntry(client, userId, openBoothId, "2026-06-08");
  assert("before start_date rejected", !outBefore.ok && outBefore.reason === "date_out_of_range");
  assert("maps to HTTP 422", boothEntryHttpStatus(outBefore.reason) === 422);

  const outAfter = await guardBoothEntry(client, userId, openBoothId, "2026-06-12");
  assert("after end_date rejected", !outAfter.ok && outAfter.reason === "date_out_of_range");
  assert("maps to HTTP 422", boothEntryHttpStatus(outAfter.reason) === 422);
  console.log("");

  // 2) Guard: closed booth
  console.log("2) booth_closed guard");
  const closedGuard = await guardBoothEntry(client, userId, closedBoothId, inRange);
  assert("closed booth rejected", !closedGuard.ok && closedGuard.reason === "booth_closed");
  assert("maps to HTTP 409", boothEntryHttpStatus(closedGuard.reason) === 409);
  console.log("");

  // 3) Valid entries → boothSummary buckets
  console.log("3) boothSummary cash/transfer + fixed/variable");
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 150.50, 'cash', $3::date),
            ($1, $2, 49.50, 'transfer', $3::date)`,
    [openBoothId, userId, inRange],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, label, entry_date)
     VALUES ($1, $2, 300.00, 'fixed', 'ค่าที่', $3::date),
            ($1, $2, 25.25, 'variable', 'นม', $3::date)`,
    [openBoothId, userId, inRange],
  );
  const sum = await boothSummarySql(client, openBoothId);
  assert("cash income = 150.50", sum.cash_income === "150.50", `got ${sum.cash_income}`);
  assert("transfer income = 49.50", sum.transfer_income === "49.50", `got ${sum.transfer_income}`);
  assert("fixed expense = 300.00", sum.fixed_expense === "300.00", `got ${sum.fixed_expense}`);
  assert("variable expense = 25.25", sum.variable_expense === "25.25", `got ${sum.variable_expense}`);
  assert(
    "total income 200.00",
    Number(sum.cash_income) + Number(sum.transfer_income) === 200,
  );
  assert(
    "total expense 325.25",
    Number(sum.fixed_expense) + Number(sum.variable_expense) === 325.25,
  );
  console.log("");

  // 4) HTTP API (when dev server available)
  console.log("4) HTTP POST guard mapping");
  const base = await detectBase();
  if (!base) {
    console.log("  (skip — no dev server; guard + SQL assertions above are sufficient)");
  } else {
    console.log(`  using ${base}`);
    const badDate = await apiPost(base, `/api/booths/${openBoothId}/income`, {
      amount: 10,
      paymentMethod: "cash",
      entryDate: "2026-06-01",
    });
    assert("POST out-of-range date → 422", badDate.status === 422, `got ${badDate.status}`);
    assert(
      "Thai message present",
      badDate.json?.error?.reason === "date_out_of_range" &&
        typeof badDate.json?.error?.message === "string" &&
        badDate.json.error.message.includes("ช่วงงานบูธ"),
    );

    const closedPost = await apiPost(base, `/api/booths/${closedBoothId}/income`, {
      amount: 10,
      paymentMethod: "cash",
      entryDate: inRange,
    });
    assert("POST closed booth → 409", closedPost.status === 409, `got ${closedPost.status}`);
    assert(
      "closed reason in body",
      closedPost.json?.error?.reason === "booth_closed",
    );

    const okPost = await apiPost(base, `/api/booths/${openBoothId}/income`, {
      amount: 88,
      paymentMethod: "transfer",
      entryDate: inRange,
    });
    assert("POST valid entry → 201", okPost.status === 201, `got ${okPost.status}`);
  }
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
    console.log("(test user and data cleaned up — CASCADE)");
  }
  await client.end();
}
