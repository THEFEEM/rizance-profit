/**
 * ANDROID 4.1 — APP ENTRY (/app) BEHAVIOURAL CHECK
 *
 * เรียก middleware() จริงด้วย NextRequest จริงและ session JWT ที่เซ็นจริง
 * แล้วอ่าน response — ไม่ใช่การส่องซอร์ส
 *
 * ครอบ 2 ด้าน:
 *   A · /app ทำงานถูก (ล็อกอินแล้ว → /home · ยังไม่ → /login โดยไม่มี ?next=)
 *   R · เว็บเดิมไม่เปลี่ยน (/ ยังเป็น landing · หน้า protected ยังถูกป้องกัน)
 *
 * รัน: npm run test:app-entry
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ต้องตั้งก่อน import middleware — lib/jwt อ่านตอนเรียกใช้ ไม่ใช่ตอน import
// ค่านี้ใช้เฉพาะในเทส ไม่เกี่ยวกับ secret จริงใด ๆ
process.env.JWT_SECRET = "test-only-secret-for-app-entry-check-0000";
delete process.env.VERCEL; // ปิด branch บังคับ https เพื่อให้เทสไม่ขึ้นกับ x-forwarded-proto

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 56 - t.length))}`);

const ORIGIN = "https://www.rizance.com";
const ROOT = process.cwd();

async function main(): Promise<void> {
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("../middleware");
  const { signSession, SESSION_COOKIE } = await import("../lib/jwt");

  const validToken = await signSession("00000000-0000-4000-8000-000000000001");

  type Auth = "none" | "valid" | "garbage";
  async function hit(path: string, auth: Auth) {
    const headers = new Headers({ host: "www.rizance.com" });
    if (auth === "valid") headers.set("cookie", `${SESSION_COOKIE}=${validToken}`);
    if (auth === "garbage") headers.set("cookie", `${SESSION_COOKIE}=not.a.jwt`);
    const req = new NextRequest(`${ORIGIN}${path}`, { headers });
    const res = await middleware(req);
    const loc = res.headers.get("location");
    return {
      status: res.status,
      location: loc ? new URL(loc) : null,
      passthrough: res.headers.get("x-middleware-next") === "1",
    };
  }
  const isRedirectTo = (r: Awaited<ReturnType<typeof hit>>, pathname: string) =>
    r.status >= 300 && r.status < 400 && r.location?.pathname === pathname;
  const describe = (r: Awaited<ReturnType<typeof hit>>) =>
    `${r.status} → ${r.location ? r.location.pathname + r.location.search : (r.passthrough ? "next()" : "?")}`;

  // ══ A · /app ENTRY ═════════════════════════════════════════════════
  head("A · /app ENTRY");

  let r = await hit("/app", "none");
  check("A1 ยังไม่ล็อกอิน → redirect /login", isRedirectTo(r, "/login"), describe(r));
  check("A1b …โดยไม่มี ?next= (ไม่วนกลับมา /app)",
    !r.location?.searchParams.has("next"), describe(r));

  r = await hit("/app", "valid");
  check("A2 ล็อกอินแล้ว → redirect /home", isRedirectTo(r, "/home"), describe(r));

  r = await hit("/app", "garbage");
  check("A3 cookie เสีย → ถือว่ายังไม่ล็อกอิน → /login", isRedirectTo(r, "/login"), describe(r));

  r = await hit("/app?source=twa", "none");
  check("A4 มี query string ก็ยังตัดสินเหมือนเดิม", isRedirectTo(r, "/login"), describe(r));

  r = await hit("/app", "none");
  check("A5 ไม่มี UI แทรก — เป็น redirect ไม่ใช่ next()", !r.passthrough, describe(r));

  // ══ R · เว็บเดิมต้องไม่เปลี่ยน ══════════════════════════════════════
  head("R · WEB REGRESSION");

  r = await hit("/", "none");
  check("R1 / ยังไม่ล็อกอิน → ผ่านไป landing (next())", r.passthrough && r.status === 200, describe(r));

  r = await hit("/", "valid");
  check("R2 / ล็อกอินแล้ว → /home (พฤติกรรมเดิม)", isRedirectTo(r, "/home"), describe(r));

  r = await hit("/home", "none");
  check("R3 /home ยังไม่ล็อกอิน → /login?next=/home (พฤติกรรมเดิม)",
    isRedirectTo(r, "/login") && r.location?.searchParams.get("next") === "/home", describe(r));

  r = await hit("/login", "valid");
  check("R4 /login ล็อกอินแล้ว → /home (พฤติกรรมเดิม)", isRedirectTo(r, "/home"), describe(r));

  for (const p of ["/privacy", "/terms", "/pricing", "/register"]) {
    r = await hit(p, "none");
    check(`R5 ${p} ยังเปิดได้โดยไม่ล็อกอิน`, r.passthrough, describe(r));
  }

  // จับตรงตัว ไม่ใช่ prefix — เส้นทางที่ขึ้นต้นด้วย /app แต่ไม่ใช่ /app ต้องไม่ถูกดักเป็น entry
  r = await hit("/apple", "none");
  check("R6 /apple ไม่ถูกดักเป็น entry (ยังเป็น protected → /login?next=/apple)",
    isRedirectTo(r, "/login") && r.location?.searchParams.get("next") === "/apple", describe(r));

  r = await hit("/app/x", "none");
  check("R7 /app/x ไม่ถูกดักเป็น entry (ตรงตัวเท่านั้น)",
    isRedirectTo(r, "/login") && r.location?.searchParams.get("next") === "/app/x", describe(r));

  // ══ S · โครงสร้างที่ต้องคง ═══════════════════════════════════════════
  head("S · STRUCTURE");

  const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const publicPaths = (mw.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)?.[1] ?? "")
    .split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean);
  check("S1 PUBLIC_PATHS ยัง 6 เส้นทางเดิม (/app ไม่ได้ถูกทำให้ public)",
    publicPaths.length === 6 && !publicPaths.includes("/app"), publicPaths.join(" "));

  const page = readFileSync(join(ROOT, "app", "app", "page.tsx"), "utf8");
  check("S2 มีชั้นสำรอง app/app/page.tsx", page.length > 0);
  check("S3 ชั้นสำรองใช้ getUserId (verify JWT) ไม่ใช่ getCurrentUser (แตะ DB)",
    page.includes("getUserId") && !page.includes("getCurrentUser"));
  check("S4 ชั้นสำรอง redirect ทั้งสองกรณี ไม่ render UI",
    page.includes('redirect(userId ? "/home" : "/login")') && !page.includes("return <"));
  check("S5 ชั้นสำรองไม่ import lib/db หรือ queries",
    !page.includes("lib/db") && !page.includes("lib/queries"));

  const landing = readFileSync(join(ROOT, "app", "page.tsx"), "utf8");
  check("S6 app/page.tsx (landing) ไม่ถูกแก้ — ยัง render LandingPage",
    landing.includes("<LandingPage />") && landing.includes('redirect("/home")'));

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
