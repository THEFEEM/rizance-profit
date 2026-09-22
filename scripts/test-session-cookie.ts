/**
 * SESSION COOKIE CONTRACT CHECK (Android TWA persistence audit)
 *
 * พิสูจน์ "สัญญา" ของ cookie session ในระดับโค้ด:
 *   · persistent (มี Max-Age) ไม่ใช่ session cookie ที่หายเมื่อปิด task
 *   · HttpOnly · Path=/ · SameSite=Lax · Secure บน Vercel
 *   · ทุกเส้นทาง auth (login · register · Google callback) ใช้ options ชุดเดียวกัน
 *   · logout ล้าง cookie ตัวเดียวกันด้วย attribute ที่ตรงกัน
 *   · อายุ JWT = อายุ cookie (ไม่มีช่วงที่ cookie อยู่แต่ token ตาย)
 *   · cookie เป็น host-only เมื่อไม่ตั้ง SESSION_COOKIE_DOMAIN (สำคัญต่อ root cause)
 *
 * ⚠️ เทสนี้พิสูจน์ได้เฉพาะสิ่งที่เซิร์ฟเวอร์ส่งออก — **ไม่ได้พิสูจน์** ว่า Android/Chrome
 *    เก็บ cookie ข้าม process ได้ นั่นต้องทดสอบบนเครื่องจริงเท่านั้น
 *
 * รัน: npm run test:session-cookie
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.JWT_SECRET = "test-only-secret-for-session-cookie-check-00";
delete process.env.SESSION_COOKIE_DOMAIN;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 56 - t.length))}`);
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** แยก Set-Cookie header ออกเป็น attribute (ไม่คืนค่า value ออกไปที่ไหน) */
function parseSetCookie(header: string) {
  const [nameValue, ...attrs] = header.split(";").map((s) => s.trim());
  const [name] = nameValue.split("=");
  const a: Record<string, string | true> = {};
  for (const at of attrs) {
    const [k, v] = at.split("=");
    a[k.toLowerCase()] = v === undefined ? true : v;
  }
  return { name, attrs: a, hasValue: nameValue.length > name.length + 1 };
}

async function main(): Promise<void> {
  const jwt = await import("../lib/jwt");
  const { NextRequest } = await import("next/server");

  const SEVEN_DAYS = 60 * 60 * 24 * 7;

  // ══ 1 · OPTIONS ที่ทุกเส้นทางใช้ ═══════════════════════════════════
  head("1 · sessionCookieOptions (local, ไม่ใช่ Vercel)");
  delete process.env.VERCEL;
  let o = jwt.sessionCookieOptions("www.rizance.com");
  check("1.1 httpOnly", o.httpOnly === true);
  check("1.2 path = /", o.path === "/");
  check("1.3 sameSite = lax (จำเป็นสำหรับ OAuth top-level redirect)", o.sameSite === "lax");
  check("1.4 maxAge = 7 วัน → persistent ไม่ใช่ session cookie", o.maxAge === SEVEN_DAYS, String(o.maxAge));
  check("1.5 ไม่มี Domain เมื่อไม่ตั้ง SESSION_COOKIE_DOMAIN → host-only",
    !("domain" in o), JSON.stringify(o));
  check("1.6 secure=false บน local http (ตั้งใจ)", o.secure === false);

  head("2 · sessionCookieOptions (Vercel)");
  process.env.VERCEL = "1";
  o = jwt.sessionCookieOptions("www.rizance.com");
  check("2.1 secure=true บน Vercel", o.secure === true);
  check("2.2 attribute อื่นเหมือน local", o.httpOnly && o.path === "/" && o.sameSite === "lax" && o.maxAge === SEVEN_DAYS);

  // ══ 3 · host-only semantics — หัวใจของ root cause ══════════════════
  head("3 · Domain resolution");
  check("3.1 ไม่ตั้ง env → www.rizance.com ได้ host-only", jwt.resolveCookieDomain("www.rizance.com") === undefined);
  check("3.2 ไม่ตั้ง env → rizance.app ได้ host-only", jwt.resolveCookieDomain("rizance.app") === undefined);
  process.env.SESSION_COOKIE_DOMAIN = ".rizance.com";
  check("3.3 env .rizance.com → www.rizance.com ได้ Domain=.rizance.com",
    jwt.resolveCookieDomain("www.rizance.com") === ".rizance.com");
  check("3.4 env .rizance.com → rizance.app **ไม่ได้** Domain (คนละ registrable domain)",
    jwt.resolveCookieDomain("rizance.app") === undefined);
  check("3.5 env .rizance.com → pos.rizance.app ไม่ได้ Domain", jwt.resolveCookieDomain("pos.rizance.app") === undefined);
  delete process.env.SESSION_COOKIE_DOMAIN;

  // ══ 4 · JWT ↔ cookie lifetime consistency ═════════════════════════
  head("4 · JWT lifetime");
  const token = await jwt.signSession("00000000-0000-4000-8000-0000000000aa");
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  check("4.1 JWT มี exp", typeof payload.exp === "number");
  check("4.2 JWT exp − iat = 7 วัน = maxAge ของ cookie (ไม่มีช่วง cookie อยู่แต่ token ตาย)",
    payload.exp - payload.iat === SEVEN_DAYS, String(payload.exp - payload.iat));
  check("4.3 verifySession ยอมรับ token ที่เพิ่งเซ็น", (await jwt.verifySession(token)) === "00000000-0000-4000-8000-0000000000aa");
  check("4.4 verifySession ปฏิเสธ token เสีย", (await jwt.verifySession("x.y.z")) === null);

  // ══ 5 · LOGOUT ล้างตัวเดียวกัน (เรียก route จริง ไม่แตะ DB) ════════
  head("5 · logout route (behavioural)");
  const logout = await import("../app/api/auth/logout/route");
  const res = await logout.POST(new NextRequest("https://www.rizance.com/api/auth/logout", {
    method: "POST", headers: { host: "www.rizance.com" },
  }));
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const sess = setCookies.map(parseSetCookie).find((c) => c.name === jwt.SESSION_COOKIE);
  check("5.1 logout ส่ง Set-Cookie ของ rizance_session", !!sess);
  check("5.2 …ค่าว่าง", sess ? !sess.hasValue : false);
  check("5.3 …Max-Age=0", sess?.attrs["max-age"] === "0", String(sess?.attrs["max-age"]));
  check("5.4 …Path=/ ตรงกับตอนตั้ง", sess?.attrs["path"] === "/");
  check("5.5 …HttpOnly", sess?.attrs["httponly"] === true);
  check("5.6 …ไม่มี Domain (ตรงกับตอนตั้งเมื่อไม่ตั้ง env)", !("domain" in (sess?.attrs ?? {})));

  // ══ 6 · ทุกเส้นทาง auth ใช้ options ชุดเดียว (source contract) ═══
  head("6 · auth paths ใช้ sessionCookieOptions(requestHostname(req)) เหมือนกัน");
  const CALL = "sessionCookieOptions(requestHostname(req))";
  for (const f of [
    "app/api/auth/login/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/auth/google/callback/route.ts",
  ]) {
    const s = src(f);
    check(`6.x ${f}`, s.includes(`res.cookies.set(SESSION_COOKIE, token, ${CALL})`));
  }
  check("6.y logout ใช้ clearSessionCookieOptions(requestHostname(req))",
    src("app/api/auth/logout/route.ts").includes("clearSessionCookieOptions(requestHostname(req))"));
  check("6.z ไม่มีที่ใดตั้ง SESSION_COOKIE ด้วย options อื่น",
    !/cookies\.set\(SESSION_COOKIE,[^)]*\{/.test(
      ["login", "register", "logout", "google/callback"].map((p) => src(`app/api/auth/${p}/route.ts`)).join("\n")));

  // ══ 7 · OAuth state cookie ก็ host-bound ═══════════════════════════
  head("7 · OAuth state cookie");
  const os = src("lib/oauth-state.ts");
  check("7.1 state cookie ไม่ตั้ง Domain (host-only) → callback ต้องกลับมา host เดิม",
    /function stateCookieOptions[\s\S]*?path: "\/api\/auth\/google"[\s\S]*?\}/.test(os) &&
    !/function stateCookieOptions[\s\S]*?domain[\s\S]*?\n\}/.test(os.split("export async function createOAuthState")[0]!));
  check("7.2 verifyOAuthState ปฏิเสธเมื่อไม่มี cookie (A-3.SEC — ห้ามอ่อนลง)",
    os.includes("if (!cookieValue || typeof stateParam !== \"string\" || stateParam === \"\") return null;"));

  // ══ 8 · ค่าคอนฟิกที่ต้องสอดคล้อง (ตรวจได้เฉพาะ env ที่รันอยู่) ═════
  head("8 · config invariant (informational เมื่อ env ไม่ครบ)");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (appUrl && redirectUri) {
    check("8.1 host ของ GOOGLE_REDIRECT_URI = host ของ NEXT_PUBLIC_APP_URL (ไม่งั้น session ตั้งผิด origin)",
      new URL(redirectUri).host === new URL(appUrl).host,
      `${new URL(redirectUri).host} vs ${new URL(appUrl).host}`);
  } else {
    console.log("SKIP 8.1 — NEXT_PUBLIC_APP_URL / GOOGLE_REDIRECT_URI ไม่ได้ตั้งใน env ที่รันเทส (ตรวจใน Vercel แทน)");
  }

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
