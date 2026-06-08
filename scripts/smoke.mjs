// End-to-end smoke test for the Phase 0–3 vertical slice.
// Usage: node scripts/smoke.mjs  (loads .env.local, hits localhost:3000)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
async function detectBase() {
  if (process.env.SMOKE_BASE_URL) return process.env.SMOKE_BASE_URL;
  for (const port of [3001, 3000]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/auth/me`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status === 401 || res.ok) return `http://localhost:${port}`;
    } catch {
      // try next port
    }
  }
  return "http://localhost:3000";
}

const BASE = await detectBase();

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // file not present
  }
}

const stamp = Date.now();
const email = `smoke-${stamp}@rizance.test`;
const password = "smokepass123";
const shopName = `Smoke Shop ${stamp}`;

let cookie = "";

function log(step, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${step}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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

async function main() {
  console.log(`Smoke test → ${BASE}\n`);

  // 1. Register
  let { res, body } = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, shopName }),
  });
  if (!res.ok) {
    log("Register", false, body?.error?.message ?? res.status);
    process.exit(1);
  }
  log("Register", true, email);

  // 2. Me
  ({ res, body } = await request("/api/auth/me"));
  if (!res.ok || body?.data?.user?.email !== email) {
    log("GET /api/auth/me", false);
    process.exit(1);
  }
  log("GET /api/auth/me", true);

  // 3. Add income
  ({ res, body } = await request("/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 1850, note: "Morning sales" }),
  }));
  if (!res.ok) {
    log("POST /api/income", false, body?.error?.message);
    process.exit(1);
  }
  const incomeId = body.data.id;
  log("POST /api/income", true, `฿1,850.00 (${incomeId.slice(0, 8)}…)`);

  // 4. Add expense
  ({ res, body } = await request("/api/expense", {
    method: "POST",
    body: JSON.stringify({ amount: 640, category: "supplies", note: "Milk run" }),
  }));
  if (!res.ok) {
    log("POST /api/expense", false, body?.error?.message);
    process.exit(1);
  }
  const expenseId = body.data.id;
  log("POST /api/expense", true, `฿640.00 (${expenseId.slice(0, 8)}…)`);

  // 5. Daily summary — profit must be 1210.00
  ({ res, body } = await request("/api/summary/daily"));
  const s = body?.data;
  if (!res.ok || s?.profit !== "1210.00") {
    log("GET /api/summary/daily", false, `profit=${s?.profit} (expected 1210.00)`);
    process.exit(1);
  }
  log("GET /api/summary/daily", true, `profit=฿${s.profit} (in=${s.income} out=${s.expense})`);

  // 6. List entries
  ({ res, body } = await request("/api/income"));
  if (!res.ok || body?.data?.length !== 1) {
    log("GET /api/income", false);
    process.exit(1);
  }
  log("GET /api/income", true, `${body.data.length} entry`);

  ({ res, body } = await request("/api/expense"));
  if (!res.ok || body?.data?.length !== 1) {
    log("GET /api/expense", false);
    process.exit(1);
  }
  log("GET /api/expense", true, `${body.data.length} entry`);

  // 7. Delete income
  ({ res } = await request(`/api/income/${incomeId}`, { method: "DELETE" }));
  if (!res.ok) {
    log("DELETE /api/income/[id]", false);
    process.exit(1);
  }
  log("DELETE /api/income/[id]", true);

  // 8. Summary after delete — profit should be -640.00
  ({ res, body } = await request("/api/summary/daily"));
  if (!res.ok || body?.data?.profit !== "-640.00") {
    log("Summary after delete", false, `profit=${body?.data?.profit}`);
    process.exit(1);
  }
  log("Summary after delete", true, `profit=${body.data.profit}`);

  // 9. Logout
  ({ res } = await request("/api/auth/logout", { method: "POST" }));
  if (!res.ok) {
    log("POST /api/auth/logout", false);
    process.exit(1);
  }
  log("POST /api/auth/logout", true);

  // 10. Me should 401
  ({ res } = await request("/api/auth/me"));
  if (res.status !== 401) {
    log("GET /api/auth/me after logout", false, `status=${res.status}`);
    process.exit(1);
  }
  log("GET /api/auth/me after logout", true, "401");

  // 11. Login again
  ({ res, body } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }));
  if (!res.ok) {
    log("POST /api/auth/login", false);
    process.exit(1);
  }
  log("POST /api/auth/login", true);

  // 12. Cleanup expense
  await request(`/api/expense/${expenseId}`, { method: "DELETE" });

  console.log("\nAll smoke checks passed.");
  console.log(`Test account: ${email} (left registered; delete manually if desired)`);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err.message);
  process.exit(1);
});
