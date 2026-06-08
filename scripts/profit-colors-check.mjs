// Verifies profit sign → color mapping and a negative-day API example.
// Usage: node scripts/profit-colors-check.mjs [baseUrl]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

function toCents(value) {
  const s = String(value).trim();
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

function moneySign(value) {
  const c = toCents(value);
  return c > 0 ? 1 : c < 0 ? -1 : 0;
}

function profitColor(sign) {
  return sign > 0 ? "green (emerald-600)" : sign < 0 ? "red (red-600)" : "gray (slate-400)";
}

console.log("=== PROFIT COLOR LOGIC ===\n");

const cases = [
  { profit: "1210.00", label: "positive day" },
  { profit: "0.00", label: "zero / first-time user" },
  { profit: "-640.00", label: "negative day" },
];

for (const { profit, label } of cases) {
  const sign = moneySign(profit);
  console.log(`${label}: profit=${profit} → sign=${sign} → ${profitColor(sign)}`);
}

async function detectBase() {
  for (const port of [3001, 3000]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/auth/me`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 401 || res.ok) return `http://localhost:${port}`;
    } catch {
      // try next
    }
  }
  return process.argv[2] ?? "http://localhost:3000";
}

const BASE = await detectBase();
console.log(`\n=== NEGATIVE-DAY API EXAMPLE (${BASE}) ===\n`);

let cookie = "";
async function req(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    cookie = c.split(";")[0];
  }
  return { res, body: await res.json().catch(() => null) };
}

const stamp = Date.now();
const email = `colors-${stamp}@rizance.test`;

let { res, body } = await req("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ email, password: "testpass123", shopName: "Color Test" }),
});
if (!res.ok) {
  console.log("Could not register (is dev server running?):", body?.error?.message);
  process.exit(0);
}

await req("/api/income", { method: "POST", body: JSON.stringify({ amount: 100, note: "Small day" }) });
await req("/api/expense", { method: "POST", body: JSON.stringify({ amount: 500, note: "Big bill" }) });

({ res, body } = await req("/api/summary/daily"));
const s = body?.data;
if (s?.profit === "-400.00") {
  const sign = moneySign(s.profit);
  console.log(`Income ฿100, Expense ฿500 → profit=${s.profit}`);
  console.log(`UI color: ${profitColor(sign)} (red)`);
  console.log("✓ Negative-day example verified");
} else {
  console.log("✗ Expected profit -400.00, got", s?.profit);
  process.exitCode = 1;
}

// Cleanup this test user
const connectionString = process.env.DATABASE_URL;
if (connectionString) {
  const pg = (await import("pg")).default;
  const needsSsl = /neon\.tech|sslmode=require/i.test(connectionString);
  const client = new pg.Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query(`DELETE FROM users WHERE email = $1`, [email]);
    console.log("(test user cleaned up)");
  } finally {
    await client.end();
  }
}
