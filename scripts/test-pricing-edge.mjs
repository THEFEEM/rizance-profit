// Pricing edge-case integration test (cups/month, rounding, delete guard).
// Usage: npm run dev (in another terminal), then npm run test:pricing-edge
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SignJWT } from "jose";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import {
  computeOverheadPerCup,
  formatSellingPriceDisplay,
} from "./pricing-math-core.mjs";

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

async function makeSessionCookie(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET missing or too short in .env.local");
  }
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
      const res = await fetch(`${base}/api/pricing/summary`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 200) return base;
    } catch {
      // try next
    }
  }
  return null;
}

let cookie = "";
let failed = 0;

function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
  return ok;
}

function walkForGarbage(value, path = "root") {
  const bad = [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) bad.push(`${path}: non-finite number`);
  } else if (typeof value === "string") {
    if (/NaN|Infinity/i.test(value)) bad.push(`${path}: garbage string`);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      value.forEach((v, i) => bad.push(...walkForGarbage(v, `${path}[${i}]`)));
    } else {
      for (const [k, v] of Object.entries(value)) {
        bad.push(...walkForGarbage(v, `${path}.${k}`));
      }
    }
  }
  return bad;
}

async function request(base, path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no json
  }
  return { res, body };
}

async function getSummary(base) {
  const { res, body } = await request(base, "/api/pricing/summary");
  return { res, body, summary: body?.data ?? null };
}

async function seedOverheadRent(client, userId, amount) {
  const upd = await client.query(
    `UPDATE overheads SET monthly_amount = $2, updated_at = now()
     WHERE user_id = $1 AND category = 'rent'`,
    [userId, amount],
  );
  if ((upd.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO overheads (user_id, category, monthly_amount) VALUES ($1, 'rent', $2)`,
      [userId, amount],
    );
  }
}

async function cleanupUser(client, userId) {
  await client.query(`DELETE FROM menu_items WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const stamp = Date.now();
const email = `pricing-edge-${stamp}@rizance.test`;
const shopName = `Pricing Edge ${stamp}`;

const client = new pg.Client(pgClientOptions(connectionString));
let userId = null;

try {
  await client.connect();
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'pricing-edge-test', $2)
     RETURNING id`,
    [email, shopName],
  );
  userId = users[0].id;

  await makeSessionCookie(userId);

  const BASE = await detectBase();
  if (!BASE) {
    console.error("No dev server found. Run: npm run dev");
    process.exit(1);
  }
  console.log(`=== PRICING EDGE CASE TEST ===\nAPI → ${BASE}\n`);

  console.log(`Temp user: ${email}\n`);

  let res;
  let body;

  await seedOverheadRent(client, userId, "10000.00");

  // --- 1. Cups per month ---
  console.log("1) ZERO / NULL cups-per-month");

  const { rows: menuRows } = await client.query(
    `INSERT INTO menu_items (user_id, name) VALUES ($1, 'Latte') RETURNING id`,
    [userId],
  );
  const menuId = menuRows[0].id;

  // 1a. No pricing_settings row (null / unset)
  await client.query(`DELETE FROM pricing_settings WHERE user_id = $1`, [userId]);

  let summaryRes = await getSummary(BASE);
  assert("GET summary status 200 (no settings row)", summaryRes.res.status === 200);
  const s1 = summaryRes.summary;
  const garbage1 = walkForGarbage(s1);
  assert("no NaN/Infinity in response (no settings)", garbage1.length === 0, garbage1.join("; ") || "clean");
  assert("needsCupsPerMonth true (no settings)", s1?.needsCupsPerMonth === true);
  assert("overheadPerCup null (no settings)", s1?.overheadPerCup === null);

  // 1b. Explicit cups = 0
  await client.query(
    `INSERT INTO pricing_settings (user_id, estimated_cups_per_month)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO UPDATE SET estimated_cups_per_month = 0`,
    [userId],
  );

  summaryRes = await getSummary(BASE);
  const s2 = summaryRes.summary;
  const garbage2 = walkForGarbage(s2);
  assert("GET summary status 200 (cups=0)", summaryRes.res.status === 200);
  assert("no NaN/Infinity (cups=0)", garbage2.length === 0, garbage2.join("; ") || "clean");
  assert("needsCupsPerMonth true (cups=0)", s2?.needsCupsPerMonth === true);
  assert("overheadPerCup null (cups=0)", s2?.overheadPerCup === null);

  // 1c. Valid cups → overhead computes
  await client.query(
    `UPDATE pricing_settings SET estimated_cups_per_month = 1000 WHERE user_id = $1`,
    [userId],
  );

  summaryRes = await getSummary(BASE);
  const s3 = summaryRes.summary;
  assert("GET summary status 200 (cups=1000)", summaryRes.res.status === 200);
  assert("needsCupsPerMonth false", s3?.needsCupsPerMonth === false);
  assert("overheadPerCup 10.00", s3?.overheadPerCup === "10.00");
  assert(
    "math matches 10000/1000",
    computeOverheadPerCup("10000.00", 1000) === s3?.overheadPerCup,
  );

  console.log("");

  // --- 2. Rounding ---
  console.log("2) ROUNDING (display vs internal)");

  await client.query(`UPDATE pricing_settings SET estimated_cups_per_month = 0 WHERE user_id = $1`, [
    userId,
  ]);

  // 1 piece @ 46.83 → exact 46.83 line cost (avoids 4-decimal per-unit drift from ml math)
  const { rows: ingRows } = await client.query(
    `INSERT INTO ingredients (user_id, name, purchase_quantity, purchase_unit, purchase_price)
     VALUES ($1, 'Rounding-cup', 1, 'piece', 46.83)
     RETURNING id`,
    [userId],
  );
  const roundingIngId = ingRows[0].id;
  await client.query(
    `INSERT INTO recipe_items (menu_item_id, ingredient_id, quantity) VALUES ($1, $2, 1)`,
    [menuId, roundingIngId],
  );

  summaryRes = await getSummary(BASE);
  const row = summaryRes.summary?.rows?.find((r) => r.menuName === "Latte");
  assert("summary row exists", !!row);
  assert("ingredientCostPerCup 46.83", row?.ingredientCostPerCup === "46.83");
  assert("totalCostPerCup 46.83 (no overhead when cups=0)", row?.totalCostPerCup === "46.83");
  assert("sellingPriceExact 46.83", row?.sellingPriceExact === "46.83");
  assert("sellingPriceDisplay whole baht", row?.sellingPriceDisplay === "฿47");
  assert(
    "display helper matches",
    formatSellingPriceDisplay(row?.sellingPriceExact) === row?.sellingPriceDisplay,
  );
  assert(
    "total not rounded to 47",
    row?.totalCostPerCup !== "47.00" && row?.sellingPriceExact !== "47.00",
  );

  console.log("");

  // --- 3. Delete guard ---
  console.log("3) DELETE GUARD");

  const { rows: usedIng } = await client.query(
    `INSERT INTO ingredients (user_id, name, purchase_quantity, purchase_unit, purchase_price)
     VALUES ($1, 'Used-syrup', 1000, 'ml', 100.00)
     RETURNING id`,
    [userId],
  );
  const usedIngId = usedIng[0].id;
  await client.query(
    `INSERT INTO recipe_items (menu_item_id, ingredient_id, quantity) VALUES ($1, $2, 50)`,
    [menuId, usedIngId],
  );

  ({ res, body } = await request(BASE, `/api/ingredients/${usedIngId}`, { method: "DELETE" }));
  assert("used ingredient → 409", res.status === 409);
  const menuNames = (body?.error?.menuItems ?? []).map((m) => m.name);
  assert("409 lists menu name", menuNames.includes("Latte"), menuNames.join(", ") || "none");

  const { rows: unusedIng } = await client.query(
    `INSERT INTO ingredients (user_id, name, purchase_quantity, purchase_unit, purchase_price)
     VALUES ($1, 'Unused-napkin', 100, 'piece', 50.00)
     RETURNING id`,
    [userId],
  );
  const unusedIngId = unusedIng[0].id;

  ({ res, body } = await request(BASE, `/api/ingredients/${unusedIngId}`, { method: "DELETE" }));
  assert("unused ingredient → 200", res.status === 200);
  assert("delete returns id", body?.data?.id === unusedIngId);

  const { rows: stillThere } = await client.query(`SELECT id FROM ingredients WHERE id = $1`, [
    unusedIngId,
  ]);
  assert("unused ingredient removed from DB", stillThere.length === 0);

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
    await cleanupUser(client, userId);
    console.log("(test user and data cleaned up)");
  }
  await client.end();
}
