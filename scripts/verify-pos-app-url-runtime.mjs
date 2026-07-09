/**
 * Runtime verify NEXT_PUBLIC_POS_APP_URL on production /home (business plan user).
 * Loads DATABASE_URL from .env.local for one-off test user plan bump.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function pgPoolOptions(connectionString) {
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  return {
    connectionString: url.toString().replace(/^postgres:/, "postgresql:"),
    ssl: { rejectUnauthorized: false },
  };
}

const ORIGIN = "https://www.rizance.com";
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDatabaseUrl() {
  for (const file of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      // skip
    }
  }
  throw new Error("DATABASE_URL not found");
}

const stamp = Date.now();
const email = `pos-url-verify-${stamp}@rizance.test`;
const password = `Verify${stamp}!`;

const reg = await fetch(`${ORIGIN}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, shopName: "POS URL Verify", mode: "regular" }),
});
const regBody = await reg.json();
const userId = regBody?.data?.user?.id;
if (!userId) {
  console.error("register failed", reg.status, regBody);
  process.exit(1);
}

const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
await pool.query(
  `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
  [userId],
);
await pool.end();

const login = await fetch(`${ORIGIN}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const home = await fetch(`${ORIGIN}/home`, { headers: { Cookie: cookie } }).then((r) => r.text());

if (home.includes("pos.rizance.com")) {
  console.log("PASS: pos.rizance.com in /home HTML (business user)");
  console.log("snippet:", home.match(/.{0,50}pos\.rizance\.com[^"'\s]*/)?.[0]);
  process.exit(0);
}

if (home.includes("localhost:3001")) {
  console.log("FAIL: localhost:3001 fallback in /home HTML — env empty or not deployed");
  console.log("snippet:", home.match(/.{0,50}localhost:3001.{0,50}/)?.[0]);
  process.exit(1);
}

console.log("FAIL: neither pos.rizance.com nor localhost:3001 in /home HTML");
console.log("has POS button text:", home.includes("เปิดหน้าร้าน"));
process.exit(1);
