import pg from "pg";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envRaw = readFileSync(join(root, ".env.local"), "utf8");
const dbUrl = envRaw.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const jwtSecret = envRaw.match(/^JWT_SECRET=(.+)$/m)?.[1]?.trim();
if (!dbUrl || !jwtSecret) throw new Error("DATABASE_URL or JWT_SECRET missing");

const BASE = "https://rizance.app";
const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function signSession(userId) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(jwtSecret));
}

async function followPersonalEntry(cookie) {
  const res = await fetch(`${BASE}/personal/entry`, {
    redirect: "manual",
    headers: { Cookie: cookie, Accept: "text/html" },
  });
  const text = await res.text();
  const location = res.headers.get("location");
  const softRedirectHome = text.includes("NEXT_REDIRECT") && text.includes("/home");
  return { status: res.status, location, softRedirectHome };
}

async function register(shopName, email, password, mode = "regular") {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shopName, email, password, mode }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((c) => c.startsWith("rizance_session="));
  return {
    ok: res.ok,
    status: res.status,
    sessionCookie: session?.split(";")[0] ?? null,
    body: await res.json(),
  };
}

async function main() {
  const registerHtml = await (await fetch(`${BASE}/register`)).text();
  const r1 = {
    hasPersonal: registerHtml.includes("บุคคล"),
    hasOrg: registerHtml.includes("องค์กร"),
    hasShop: registerHtml.includes("ร้านค้า"),
    hasBooth: registerHtml.includes("บูธ"),
    pass: !registerHtml.includes("บุคคล") && !registerHtml.includes("องค์กร"),
  };
  console.log("=== 1) Register page ===");
  console.log(JSON.stringify(r1, null, 2));

  await db.connect();

  const { rows: personalUser } = await db.query(
    `SELECT u.id, u.email
     FROM users u
     WHERE EXISTS (SELECT 1 FROM personal_income_entries WHERE user_id = u.id)
        OR EXISTS (SELECT 1 FROM personal_expense_entries WHERE user_id = u.id)
     ORDER BY (
       (SELECT COUNT(*) FROM personal_income_entries WHERE user_id = u.id) +
       (SELECT COUNT(*) FROM personal_expense_entries WHERE user_id = u.id)
     ) DESC
     LIMIT 1`,
  );
  const grandfather = personalUser[0];
  let r2 = { pass: false, note: "no personal user in DB" };
  if (grandfather) {
    const token = await signSession(grandfather.id);
    const cookie = `rizance_session=${token}`;
    const entry = await followPersonalEntry(cookie);
    r2 = {
      userId: grandfather.id,
      email: grandfather.email,
      status: entry.status,
      location: entry.location,
      softRedirectHome: entry.softRedirectHome,
      pass: entry.status === 200 && !entry.softRedirectHome,
    };
    console.log("\n=== 2) Grandfather user /personal/entry ===");
    console.log(JSON.stringify(r2, null, 2));
  } else {
    console.log("\n=== 2) Grandfather user — skipped (no data) ===");
  }

  const testPassword = "SmokeTest123!";
  const testEmail = `smoke-${Date.now()}@rizance-test.invalid`;
  const reg = await register("Smoke Shop", testEmail, testPassword, "regular");
  const entryNew = await followPersonalEntry(reg.sessionCookie);
  const r3 = {
    registerStatus: reg.status,
    userId: reg.body?.data?.user?.id,
    entryStatus: entryNew.status,
    location: entryNew.location,
    softRedirectHome: entryNew.softRedirectHome,
    pass:
      entryNew.softRedirectHome ||
      (entryNew.status >= 300 && entryNew.status < 400 && entryNew.location?.includes("/home")),
  };
  console.log("\n=== 3) New user /personal/entry redirect ===");
  console.log(JSON.stringify(r3, null, 2));

  const homeRes = await fetch(`${BASE}/home`, { headers: { Cookie: reg.sessionCookie } });
  const entryRes = await fetch(`${BASE}/entry`, { headers: { Cookie: reg.sessionCookie } });
  const boothReg = await register(
    "Smoke Booth",
    `booth-${Date.now()}@rizance-test.invalid`,
    testPassword,
    "booth",
  );
  const r4 = {
    shopHome: homeRes.status,
    shopEntry: entryRes.status,
    boothRegister: boothReg.status,
    pass: homeRes.status === 200 && entryRes.status === 200 && boothReg.ok,
  };
  console.log("\n=== 4) Shop/Booth regression ===");
  console.log(JSON.stringify(r4, null, 2));

  await db.query(`DELETE FROM users WHERE email LIKE '%@rizance-test.invalid' OR email LIKE '%@x.invalid'`);
  await db.end();

  const allPass = r1.pass && r2.pass && r3.pass && r4.pass;
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
