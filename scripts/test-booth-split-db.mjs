// DB-wired booth split via GET /api/booths/[id]/split — canonical a–d + advance payer.
// Usage: npm run dev (terminal 1), then npm run test:booth-split-db (terminal 2)
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
      if (res.status === 200) return base;
    } catch {
      // try next
    }
  }
  return null;
}

async function apiGet(base, path) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  const json = await res.json();
  return { status: res.status, json };
}

async function apiPost(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
    failed++;
  }
}

function share(split, memberId) {
  return split.memberShares.find((s) => s.memberId === memberId);
}

async function seedRevisionBooth(client, userId, { poolGetsShare, method, label }) {
  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, pool_gets_share, profit_split_method, start_date, end_date)
     VALUES ($1, $2, 10000.00, $3, $4, '2026-06-01'::date, '2026-06-03'::date)
     RETURNING id`,
    [userId, label, poolGetsShare, method],
  );
  const boothId = booths[0].id;

  const { rows: inv } = await client.query(
    `INSERT INTO booth_members (booth_id, name, role, investment_amount)
     VALUES ($1, 'A', 'investor', 2000.00) RETURNING id`,
    [boothId],
  );
  const investorId = inv[0].id;

  const { rows: mgr } = await client.query(
    `INSERT INTO booth_members (booth_id, name, role, investment_amount, wage_amount, wage_type)
     VALUES ($1, 'B', 'manager', 2000.00, 300.00, 'daily') RETURNING id`,
    [boothId],
  );
  const managerId = mgr[0].id;

  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 12000.00, 'cash', '2026-06-02'::date)`,
    [boothId, userId],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, entry_date)
     VALUES ($1, $2, 7500.00, 'variable', '2026-06-02'::date)`,
    [boothId, userId],
  );

  return { boothId, investorId, managerId };
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== BOOTH SPLIT DB-WIRED TEST ===\n");

  const email = `booth-split-db-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'split-db-test', 'Split DB') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");
  console.log(`API base: ${base}\n`);

  // (a) by_equity, pool_gets_share=true
  console.log("(a) by_equity + pool_gets_share=true");
  const a = await seedRevisionBooth(client, userId, {
    poolGetsShare: true,
    method: "by_equity",
    label: "Case A",
  });
  let res = await apiGet(base, `/api/booths/${a.boothId}/split`);
  assertEq("(a) HTTP 200", String(res.status), "200");
  const splitA = res.json.data;
  assertEq("(a) wageCost", splitA.wageCost, "900.00");
  assertEq("(a) grossProfit", splitA.grossProfit, "3600.00");
  assertEq("(a) pool exact", splitA.poolShare.exactShare, "2571.42");
  assertEq("(a) pool floored", splitA.poolShare.flooredShare, "2571.00");
  assertEq("(a) A floored", share(splitA, a.investorId)?.flooredShare, "514.00");
  assertEq("(a) B floored", share(splitA, a.managerId)?.flooredShare, "514.00");
  assertEq("(a) B wage", share(splitA, a.managerId)?.wageCost, "900.00");
  assertEq("(a) remainder เศษเข้ากองกลาง", splitA.remainder, "1.00");
  console.log("");

  // (b) by_equity, pool_gets_share=false
  console.log("(b) by_equity + pool_gets_share=false");
  const b = await seedRevisionBooth(client, userId, {
    poolGetsShare: false,
    method: "by_equity",
    label: "Case B",
  });
  res = await apiGet(base, `/api/booths/${b.boothId}/split`);
  const splitB = res.json.data;
  assertEq("(b) pool share 0", splitB.poolShare.flooredShare, "0.00");
  assertEq("(b) A floored", share(splitB, b.investorId)?.flooredShare, "1800.00");
  assertEq("(b) B floored", share(splitB, b.managerId)?.flooredShare, "1800.00");
  assertEq("(b) remainder 0", splitB.remainder, "0.00");
  console.log("");

  // (c) equal, pool_gets_share=true, 3 heads
  console.log("(c) equal + pool_gets_share=true");
  const c = await seedRevisionBooth(client, userId, {
    poolGetsShare: true,
    method: "equal",
    label: "Case C",
  });
  res = await apiGet(base, `/api/booths/${c.boothId}/split`);
  const splitC = res.json.data;
  assertEq("(c) pool floored", splitC.poolShare.flooredShare, "1200.00");
  assertEq("(c) A floored", share(splitC, c.investorId)?.flooredShare, "1200.00");
  assertEq("(c) B floored", share(splitC, c.managerId)?.flooredShare, "1200.00");
  console.log("");

  // (d) manager 0 equity — wage only
  console.log("(d) manager 0 equity excluded from split");
  const { rows: dBooths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, pool_gets_share, profit_split_method, start_date, end_date)
     VALUES ($1, 'Case D', 10000.00, true, 'equal', '2026-06-01'::date, '2026-06-03'::date) RETURNING id`,
    [userId],
  );
  const dBoothId = dBooths[0].id;
  const { rows: dInv } = await client.query(
    `INSERT INTO booth_members (booth_id, name, role, investment_amount)
     VALUES ($1, 'A', 'investor', 2000.00) RETURNING id`,
    [dBoothId],
  );
  const { rows: dMgr } = await client.query(
    `INSERT INTO booth_members (booth_id, name, role, investment_amount, wage_amount, wage_type)
     VALUES ($1, 'M0', 'manager', 0.00, 300.00, 'daily') RETURNING id`,
    [dBoothId],
  );
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 12000.00, 'cash', '2026-06-02'::date)`,
    [dBoothId, userId],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, entry_date)
     VALUES ($1, $2, 7500.00, 'variable', '2026-06-02'::date)`,
    [dBoothId, userId],
  );
  res = await apiGet(base, `/api/booths/${dBoothId}/split`);
  const splitD = res.json.data;
  assertEq("(d) M0 share 0", share(splitD, dMgr[0].id)?.flooredShare, "0.00");
  assertEq("(d) M0 wage 900", share(splitD, dMgr[0].id)?.wageCost, "900.00");
  assertEq("(d) pool floored 1800", splitD.poolShare.flooredShare, "1800.00");
  assertEq("(d) A floored 1800", share(splitD, dInv[0].id)?.flooredShare, "1800.00");
  console.log("");

  // Advance payer round-trip via API
  console.log("(e) Advance payer round-trip");
  const { rows: eBooths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'Advance', 0, '2026-06-01'::date, '2026-06-01'::date) RETURNING id`,
    [userId],
  );
  const eBoothId = eBooths[0].id;
  const memRes = await apiPost(base, `/api/booths/${eBoothId}/members`, {
    name: "Payer",
    role: "investor",
    investmentAmount: 1000,
  });
  assertEq("(e) create member", String(memRes.status), "201");
  const payerId = memRes.json.data.id;

  await apiPost(base, `/api/booths/${eBoothId}/income`, {
    amount: 10000,
    paymentMethod: "cash",
    entryDate: "2026-06-01",
  });
  const expRes = await apiPost(base, `/api/booths/${eBoothId}/expense`, {
    amount: 500,
    costType: "variable",
    entryDate: "2026-06-01",
    advancePayment: true,
    payerMemberId: payerId,
  });
  assertEq("(e) advance expense 201", String(expRes.status), "201");
  assertEq(
    "(e) note has ออกเงินก่อน",
    expRes.json.data.note?.includes("ออกเงินก่อน") ? "yes" : "no",
    "yes",
  );

  res = await apiGet(base, `/api/booths/${eBoothId}/split`);
  const splitE = res.json.data;
  assertEq("(e) grossProfit 9500", splitE.grossProfit, "9500.00");
  assertEq("(e) advance repayment 500", splitE.advanceRepayments[0]?.amount, "500.00");
  assertEq("(e) netProfit 9000", splitE.netProfit, "9000.00");
  console.log("");

  // External advance + blank name rejection
  console.log("(f) External advance + validation");
  const { rows: fBooths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'External', 0, '2026-06-01'::date, '2026-06-01'::date) RETURNING id`,
    [userId],
  );
  const fBoothId = fBooths[0].id;

  const blankRes = await apiPost(base, `/api/booths/${fBoothId}/expense`, {
    amount: 100,
    costType: "variable",
    entryDate: "2026-06-01",
    advancePayment: true,
    externalPayerName: "   ",
  });
  assertEq("(f) blank external rejected", String(blankRes.status), "400");

  await apiPost(base, `/api/booths/${fBoothId}/income`, {
    amount: 5000,
    paymentMethod: "cash",
    entryDate: "2026-06-01",
  });
  const extRes = await apiPost(base, `/api/booths/${fBoothId}/expense`, {
    amount: 800,
    costType: "variable",
    entryDate: "2026-06-01",
    advancePayment: true,
    externalPayerName: "ครูสมชาย",
  });
  assertEq("(f) external advance 201", String(extRes.status), "201");
  assertEq(
    "(f) external stored name",
    extRes.json.data.externalPayerName,
    "ครูสมชาย",
  );

  await apiPost(base, `/api/booths/${fBoothId}/members`, {
    name: "Inv",
    role: "investor",
    investmentAmount: 1000,
  });

  res = await apiGet(base, `/api/booths/${fBoothId}/split`);
  const splitF = res.json.data;
  assertEq("(f) external repayment 800", splitF.advanceRepayments[0]?.amount, "800.00");
  assertEq("(f) external role", splitF.advanceRepayments[0]?.role, "external");
  assertEq(
    "(f) external not in shares",
    splitF.memberShares.some((s) => s.name === "ครูสมชาย") ? "yes" : "no",
    "no",
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
