/**
 * AUTH-HOTFIX-1 — POS SSO HANDOFF CHECK (no DB · no network)
 *
 * เรียก route handler และ middleware จริงด้วย NextRequest จริง · JWT เซ็นจริง
 * DB ถูกแทนด้วย in-memory store **เฉพาะในเทส** (setHandoffStoreForTests — production ปฏิเสธ)
 * → พิสูจน์ semantics ของ consume (ครั้งแรกผ่าน ครั้งสองไม่ผ่าน) ผ่าน interface เดียวกับ pg store
 * ⚠️ atomicity ของ UPDATE … WHERE consumed_at IS NULL บน Postgres จริง ต้องยืนยันด้วย test:pos-handoff-db
 *
 * รัน: npm run test:pos-handoff
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";

process.env.JWT_SECRET = "test-only-secret-for-pos-handoff-check-0000";
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test_never_connects";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "https://www.rizance.com/api/auth/google/callback";
process.env.NEXT_PUBLIC_APP_URL = "https://www.rizance.com";
delete process.env.VERCEL;
delete process.env.POS_APP_ORIGIN;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 56 - t.length))}`);
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const USER = "00000000-0000-4000-8000-00000000c0de";
const OTHER_USER = "00000000-0000-4000-8000-00000000beef";
const POS = "https://pos.rizance.app";

function parseSetCookie(header: string) {
  const [nameValue, ...attrs] = header.split(";").map((s) => s.trim());
  const eq = nameValue.indexOf("=");
  const name = nameValue.slice(0, eq);
  const value = nameValue.slice(eq + 1);
  const a: Record<string, string | true> = {};
  for (const at of attrs) { const [k, v] = at.split("="); a[k.toLowerCase()] = v === undefined ? true : v; }
  return { name, value, attrs: a };
}
const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;

async function main(): Promise<void> {
  const { NextRequest } = await import("next/server");
  const handoff = await import("../lib/pos-handoff");
  const jwt = await import("../lib/jwt");
  const start = await import("../app/api/pos/handoff/route");
  const accept = await import("../app/api/pos/handoff/accept/route");
  const { middleware } = await import("../middleware");
  const googleStart = await import("../app/api/auth/google/route");
  const { safeNextPath } = await import("../lib/safe-next");

  // ── in-memory store (เทสเท่านั้น) — semantics เดียวกับ SQL ─────────────
  const rows = new Map<string, { userId: string; expiresAt: number; consumedAt: number | null }>();
  handoff.setHandoffStoreForTests({
    async create(jtiHash, userId, expiresAt) {
      if (rows.has(jtiHash)) throw new Error("duplicate jti");
      rows.set(jtiHash, { userId, expiresAt: expiresAt.getTime(), consumedAt: null });
    },
    async consume(jtiHash, userId) {
      const r = rows.get(jtiHash);
      if (!r || r.userId !== userId || r.consumedAt !== null || r.expiresAt <= Date.now()) return false;
      r.consumedAt = Date.now();
      return true;
    },
  });

  const sessionCookie = async (uid = USER) => `${jwt.SESSION_COOKIE}=${await jwt.signSession(uid)}`;
  const req = (url: string, opts: { host?: string; cookie?: string } = {}) => {
    const u = new URL(url);
    const headers = new Headers({ host: opts.host ?? u.host });
    if (opts.cookie) headers.set("cookie", opts.cookie);
    return new NextRequest(url, { headers });
  };
  const loc = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!) : null);

  // key เดียวกับ lib/pos-handoff (เทสรู้ scheme เพื่อปลอม token ที่ "ลายเซ็นถูกแต่ claims ผิด")
  const handoffKey = new Uint8Array(createHash("sha256").update(`${process.env.JWT_SECRET}\u0000pos-handoff`).digest());
  const sessionKey = new TextEncoder().encode(process.env.JWT_SECRET!);
  const forge = (claims: Record<string, unknown>, key: Uint8Array, opts: { aud?: string | null; iss?: string | null; exp?: number } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    let j = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt(now).setExpirationTime(opts.exp ?? now + 60);
    if (opts.aud !== null) j = j.setAudience(opts.aud ?? handoff.POS_HANDOFF_AUD);
    if (opts.iss !== null) j = j.setIssuer(opts.iss ?? handoff.POS_HANDOFF_ISS);
    return j.sign(key);
  };
  const jti = () => createHash("sha256").update(String(Math.random())).digest("hex");

  // ══ 1 · safePosNext (redirect allowlist) ════════════════════════════
  head("1 · safePosNext — production allowlist");
  process.env.VERCEL = "1";
  const D = handoff.POS_HANDOFF_DEFAULT_NEXT;
  const rejects: [string, string][] = [
    ["https://evil.example/", "other host"],
    ["//evil.example/", "protocol-relative"],
    ["/dashboard", "relative path (must be absolute)"],
    ["javascript:alert(1)", "javascript:"],
    ["data:text/html,hi", "data:"],
    ["https://pos.rizance.app.evil.example/", "lookalike suffix"],
    ["https://evil-pos.rizance.app/", "lookalike sibling"],
    ["https://pos.rizance.app@evil.example/", "user@host trick"],
    ["https://user:pw@pos.rizance.app/", "credentials in URL"],
    ["https://evil.example/https://pos.rizance.app/", "allowed origin inside path"],
    ["https://evil.example/?u=https://pos.rizance.app", "allowed origin in query"],
    ["https%3A%2F%2Fevil.example%2F", "encoded absolute"],
    ["http://pos.rizance.app/", "http (scheme mismatch)"],
    ["https://pos.rizance.app:8443/", "port mismatch"],
    ["https://pos.rizance.app/x\r\nLocation: https://evil.example", "CRLF"],
    ["http://localhost:3001/", "dev origin must NOT be allowed on Vercel"],
    ["", "empty"],
  ];
  for (const [v, why] of rejects) check(`1.x reject ${why}`, handoff.safePosNext(v) === D, `got ${handoff.safePosNext(v)}`);
  check("1.y accept root", handoff.safePosNext(`${POS}/`) === `${POS}/`);
  check("1.y accept path+query, hash stripped",
    handoff.safePosNext(`${POS}/dashboard?tab=1#frag`) === `${POS}/dashboard?tab=1`, handoff.safePosNext(`${POS}/dashboard?tab=1#frag`));
  check("1.y default is exactly POS root", D === `${POS}/`);
  delete process.env.VERCEL;
  check("1.z local dev allows POS_APP_ORIGIN default localhost:3001 (ไม่ใช่บน Vercel)",
    handoff.safePosNext("http://localhost:3001/x") === "http://localhost:3001/x");

  // ══ 2 · start route ═══════════════════════════════════════════════════
  head("2 · START (/api/pos/handoff on www)");
  let r = await start.GET(req(`https://www.rizance.com/api/pos/handoff?next=${encodeURIComponent(`${POS}/dashboard`)}`));
  let l = loc(r);
  check("2.1 unauth → 303 /login", r.status === 303 && l?.pathname === "/login", `${r.status} ${l?.href}`);
  const resume = l?.searchParams.get("next") ?? "";
  check("2.2 …next = path ภายใน /api/pos/handoff (resume)", resume.startsWith("/api/pos/handoff?next="), resume);
  check("2.3 …resume คง POS next ไว้ (ผ่าน safePosNext)", new URL(resume, "https://x").searchParams.get("next") === `${POS}/dashboard`, resume);
  check("2.4 …resume ผ่าน safeNextPath (ไม่ใช่ absolute)", safeNextPath(resume, "/home") === resume);
  check("2.5 …no-store", (r.headers.get("cache-control") ?? "").includes("no-store"));

  r = await start.GET(req(`https://www.rizance.com/api/pos/handoff?next=https://evil.example/`));
  check("2.6 unauth + evil next → resume ใช้ default POS", new URL(loc(r)!.searchParams.get("next")!, "https://x").searchParams.get("next") === D);

  r = await start.GET(req(`https://www.rizance.com/api/pos/handoff?next=${encodeURIComponent(`${POS}/dashboard`)}`, { cookie: await sessionCookie() }));
  l = loc(r);
  const token1 = l?.searchParams.get("t") ?? "";
  check("2.7 authed → 303 accept", r.status === 303 && l?.pathname === "/api/pos/handoff/accept", `${r.status} ${l?.pathname}`);
  check("2.8 …local dev: accept อยู่ origin เดียวกัน", l?.origin === "https://www.rizance.com");
  check("2.9 …มี token 3 ส่วน", token1.split(".").length === 3);
  check("2.10 …token header typ=pos-handoff+jwt · alg HS256", (() => { const h = b64json(token1.split(".")[0]!); return h.typ === "pos-handoff+jwt" && h.alg === "HS256"; })());
  {
    const p = b64json(token1.split(".")[1]!);
    check("2.11 …claims: sub=user · aud · iss · jti 64hex · nxt=validated POS url",
      p.sub === USER && p.aud === handoff.POS_HANDOFF_AUD && p.iss === handoff.POS_HANDOFF_ISS &&
      /^[0-9a-f]{64}$/.test(String(p.jti)) && p.nxt === `${POS}/dashboard`, JSON.stringify(p));
    check("2.12 …exp − iat ≤ 60s", Number(p.exp) - Number(p.iat) <= 60 && Number(p.exp) - Number(p.iat) > 0);
    check("2.13 …jti ถูกบันทึกใน store (hash) ไม่ใช่ token ดิบ", rows.has(handoff.hashJti(String(p.jti))) && ![...rows.keys()].includes(token1));
  }
  process.env.VERCEL = "1";
  r = await start.GET(req(`https://www.rizance.com/api/pos/handoff?next=${encodeURIComponent(`${POS}/`)}`, { cookie: await sessionCookie() }));
  check("2.14 production: accept อยู่บน rizance.app (host ที่ POS ยิง API)", loc(r)?.origin === handoff.POS_COMPAT_AUTH_ORIGIN, loc(r)?.origin ?? "-");
  delete process.env.VERCEL;

  r = await start.GET(req(`https://www.rizance.com/api/pos/handoff`, { cookie: `${jwt.SESSION_COOKIE}=garbage` }));
  check("2.15 cookie เสีย = unauth → /login", loc(r)?.pathname === "/login");

  // ══ 3 · accept route — happy path + single use ═══════════════════════
  head("3 · ACCEPT (/api/pos/handoff/accept on rizance.app)");
  r = await accept.GET(req(`https://rizance.app/api/pos/handoff/accept?t=${token1}`));
  l = loc(r);
  check("3.1 valid → 303 ไป POS next ที่ฝังใน token", r.status === 303 && l?.href === `${POS}/dashboard`, `${r.status} ${l?.href}`);
  const sc = (r.headers.getSetCookie?.() ?? []).map(parseSetCookie).find((c) => c.name === jwt.SESSION_COOKIE);
  check("3.2 …ตั้ง rizance_session", !!sc);
  check("3.3 …HttpOnly · Path=/ · SameSite=Lax · Max-Age 7d (ชุดเดิม)",
    sc?.attrs["httponly"] === true && sc?.attrs["path"] === "/" && String(sc?.attrs["samesite"]).toLowerCase() === "lax" && sc?.attrs["max-age"] === String(60 * 60 * 24 * 7),
    JSON.stringify(sc?.attrs));
  check("3.4 …host-only (ไม่มี Domain)", !("domain" in (sc?.attrs ?? {})));
  check("3.5 …cookie เป็น session JWT ของ user เดียวกัน", (await jwt.verifySession(sc?.value)) === USER);
  check("3.6 …cookie ≠ handoff token (ไม่ได้เอา token ไปใส่ตรง ๆ)", sc?.value !== token1);
  check("3.7 …no-store", (r.headers.get("cache-control") ?? "").includes("no-store"));
  check("3.8 …ไม่มี token ใน Location", !(l?.href ?? "").includes(token1.slice(0, 20)));

  r = await accept.GET(req(`https://rizance.app/api/pos/handoff/accept?t=${token1}`));
  check("3.9 REPLAY same token → 401 (single use)", r.status === 401 && !r.headers.get("location"), String(r.status));
  check("3.10 …ไม่ตั้ง cookie", (r.headers.getSetCookie?.() ?? []).length === 0);
  check("3.11 …ไม่ redirect (กันลูป POS↔www)", !r.headers.get("location"));
  check("3.12 …body ไม่มี token", !(await r.text()).includes(token1.slice(0, 20)));

  // ══ 4 · accept — ทุกแบบที่ต้องปฏิเสธ ═══════════════════════════════
  head("4 · ACCEPT rejects");
  const rej = async (name: string, t: string | null) => {
    const res = await accept.GET(req(`https://rizance.app/api/pos/handoff/accept${t === null ? "" : `?t=${encodeURIComponent(t)}`}`));
    check(name, res.status === 401 && !res.headers.get("location") && (res.headers.getSetCookie?.() ?? []).length === 0, String(res.status));
  };
  await rej("4.1 missing t", null);
  await rej("4.2 malformed (not a JWT)", "abc");
  await rej("4.3 malformed (2 parts)", "a.b");
  {
    // token ใหม่ที่ถูกต้อง แล้ว tamper payload 1 ตัวอักษร
    const rr = await start.GET(req(`https://www.rizance.com/api/pos/handoff`, { cookie: await sessionCookie() }));
    const good = loc(rr)!.searchParams.get("t")!;
    const [h, p, s] = good.split(".");
    const tampered = `${h}.${p!.slice(0, -2)}${p!.slice(-2) === "AA" ? "BB" : "AA"}.${s}`;
    await rej("4.4 tampered payload", tampered);
    await rej("4.5 tampered signature", `${h}.${p}.${s!.slice(0, -3)}xyz`);
    // ใช้ token ดีตัวนี้ทีหลัง (4.13)
    const okRes = await accept.GET(req(`https://rizance.app/api/pos/handoff/accept?t=${good}`));
    check("4.6 token ดีตัวเดิมยังใช้ได้หลังลองปลอม (ปลอมไม่ทำให้ของจริงเสีย)", okRes.status === 303);
  }
  {
    const past = Math.floor(Date.now() / 1000) - 5;
    const t = await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, handoffKey, { exp: past });
    await rej("4.7 expired (exp ในอดีต)", t);
  }
  {
    const j = jti();
    rows.set(handoff.hashJti(j), { userId: USER, expiresAt: Date.now() + 60_000, consumedAt: null });
    // iat เก่ากว่า 60 วิ แต่ exp ยังไม่ถึง → maxTokenAge ต้องปฏิเสธ (ยืด exp ไม่ได้)
    const now = Math.floor(Date.now() / 1000);
    const t = await new SignJWT({ nxt: `${POS}/` }).setProtectedHeader({ alg: "HS256" }).setSubject(USER).setJti(j)
      .setAudience(handoff.POS_HANDOFF_AUD).setIssuer(handoff.POS_HANDOFF_ISS).setIssuedAt(now - 120).setExpirationTime(now + 600).sign(handoffKey);
    await rej("4.8 iat เก่ากว่า TTL แม้ exp ยังไม่หมด (maxTokenAge)", t);
  }
  await rej("4.9 wrong audience", await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, handoffKey, { aud: "other" }));
  await rej("4.10 missing audience", await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, handoffKey, { aud: null }));
  await rej("4.11 wrong issuer", await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, handoffKey, { iss: "evil" }));
  await rej("4.12 signed with SESSION key (cross-use)", await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, sessionKey));
  await rej("4.13 valid signature but jti unknown to store", await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, handoffKey));
  {
    const j = jti();
    rows.set(handoff.hashJti(j), { userId: OTHER_USER, expiresAt: Date.now() + 60_000, consumedAt: null });
    await rej("4.14 jti ของ user อื่น (sub ไม่ตรงแถว)", await forge({ sub: USER, jti: j, nxt: `${POS}/` }, handoffKey));
  }
  {
    const j = jti();
    rows.set(handoff.hashJti(j), { userId: USER, expiresAt: Date.now() + 60_000, consumedAt: null });
    await rej("4.15 nxt ใน claims เป็น origin อื่น (แม้ลายเซ็นถูก)", await forge({ sub: USER, jti: j, nxt: "https://evil.example/" }, handoffKey));
    await rej("4.16 nxt ใน claims เป็น //evil", await forge({ sub: USER, jti: j, nxt: "//evil.example/" }, handoffKey));
    await rej("4.17 sub ไม่ใช่ uuid", await forge({ sub: "admin", jti: j, nxt: `${POS}/` }, handoffKey));
    await rej("4.18 jti ผิดรูปแบบ", await forge({ sub: USER, jti: "short", nxt: `${POS}/` }, handoffKey));
  }
  {
    // store พัง (ตารางยังไม่มี) → fail-closed ไม่ redirect
    handoff.setHandoffStoreForTests({ async create() { throw new Error("relation does not exist"); }, async consume() { throw new Error("relation does not exist"); } });
    const t = await forge({ sub: USER, jti: jti(), nxt: `${POS}/` }, handoffKey);
    await rej("4.19 store error → 401 fail-closed", t);
    const rr = await start.GET(req(`https://www.rizance.com/api/pos/handoff`, { cookie: await sessionCookie() }));
    check("4.20 start เมื่อ store พัง → 503 ไม่ redirect (ไม่วนลูป)", rr.status === 503 && !rr.headers.get("location"), String(rr.status));
    handoff.setHandoffStoreForTests(null);
  }

  // ══ 5 · handoff token ห้ามใช้เป็น session ═══════════════════════════
  head("5 · KEY SEPARATION");
  {
    handoff.setHandoffStoreForTests({ async create() {}, async consume() { return true; } });
    const t = await handoff.createHandoffToken(USER, `${POS}/`);
    check("5.1 handoff token ใส่เป็น rizance_session → verifySession = null", (await jwt.verifySession(t)) === null);
    const rr = await middleware(req("https://www.rizance.com/app", { cookie: `${jwt.SESSION_COOKIE}=${t}` }));
    check("5.2 …middleware ถือว่ายังไม่ล็อกอิน (/app → /login)", loc(rr)?.pathname === "/login");
    const s = await jwt.signSession(USER);
    const v = await handoff.verifyHandoffToken(s);
    check("5.3 session JWT ใช้เป็น handoff ไม่ได้", !v.ok && v.reason === "bad_signature", v.ok ? "ok?!" : v.reason);
    handoff.setHandoffStoreForTests(null);
  }

  // ══ 6 · middleware: /login next · canonical · CORS ═══════════════════
  head("6 · MIDDLEWARE");
  const resumePath = `/api/pos/handoff?next=${encodeURIComponent(`${POS}/dashboard`)}`;
  r = await middleware(req(`https://www.rizance.com/login?next=${encodeURIComponent(resumePath)}`, { cookie: await sessionCookie() }));
  check("6.1 authed /login?next=<handoff path> → ไปที่ path นั้น (ไม่ทิ้งไป /home)",
    loc(r)?.pathname === "/api/pos/handoff" && loc(r)?.searchParams.get("next") === `${POS}/dashboard`, loc(r)?.href ?? "-");
  r = await middleware(req(`https://www.rizance.com/login?next=https://evil.example/`, { cookie: await sessionCookie() }));
  check("6.2 authed /login?next=https://evil → /home (ไม่มี open redirect)", loc(r)?.href === "https://www.rizance.com/home", loc(r)?.href ?? "-");
  r = await middleware(req(`https://www.rizance.com/login?next=//evil.example/`, { cookie: await sessionCookie() }));
  check("6.3 authed /login?next=//evil → /home", loc(r)?.href === "https://www.rizance.com/home");
  r = await middleware(req(`https://www.rizance.com/login`, { cookie: await sessionCookie() }));
  check("6.4 authed /login ไม่มี next → /home (เดิม)", loc(r)?.pathname === "/home");
  r = await middleware(req(`https://www.rizance.com/register`, { cookie: await sessionCookie() }));
  check("6.5 authed /register → /home (เดิม)", loc(r)?.pathname === "/home");
  r = await middleware(req(`https://www.rizance.com/login?next=${encodeURIComponent(resumePath)}`));
  check("6.6 unauth /login → ผ่านไปหน้า login (next คงอยู่ใน URL)", r.headers.get("x-middleware-next") === "1");

  r = await middleware(req(`https://rizance.app/api/pos/handoff/accept?t=x`));
  check("6.7 accept บน rizance.app **ไม่ถูก** canonical-redirect (บล็อก /api/pos/* return ก่อน)", r.status !== 308 && r.headers.get("x-middleware-next") === "1", String(r.status));
  check("6.8 …ยังได้ CORS header ของ POS", !!r.headers.get("access-control-allow-origin"));
  r = await middleware(req(`https://rizance.app/api/pos/session`));
  check("6.9 /api/pos/session บน rizance.app ยังไม่ redirect (POS API เดิมทำงาน)", r.status !== 308 && r.headers.get("x-middleware-next") === "1");
  r = await middleware(req(`https://rizance.app/login`));
  check("6.10 หน้า /login บน rizance.app ยัง 308 ไป www (canonical เดิม)", r.status === 308 && loc(r)?.host === "www.rizance.com");

  // ══ 7 · Google OAuth start เก็บ next ใน state cookie ════════════════
  head("7 · GOOGLE START ?next=");
  r = await googleStart.GET(req(`https://www.rizance.com/api/auth/google?next=${encodeURIComponent(resumePath)}`));
  {
    const state = (r.headers.getSetCookie?.() ?? []).map(parseSetCookie).find((c) => c.name === "rizance_oauth");
    const claims = state ? b64json(state.value.split(".")[1]!) : {};
    check("7.1 → redirect ไป Google", r.status >= 300 && (loc(r)?.host ?? "").endsWith("google.com"));
    check("7.2 state cookie มี returnTo = handoff path", claims.returnTo === resumePath, String(claims.returnTo));
    check("7.3 returnTo ไม่ได้อยู่ใน `state` ที่ส่งไป Google", (loc(r)?.searchParams.get("state") ?? "").length < 80 && !(loc(r)?.searchParams.get("state") ?? "").includes("handoff"));
    check("7.4 state cookie ยัง httpOnly · path /api/auth/google (เดิม)", state?.attrs["httponly"] === true && state?.attrs["path"] === "/api/auth/google");
  }
  r = await googleStart.GET(req(`https://www.rizance.com/api/auth/google?next=https://evil.example/`));
  {
    const state = (r.headers.getSetCookie?.() ?? []).map(parseSetCookie).find((c) => c.name === "rizance_oauth");
    const claims = state ? b64json(state.value.split(".")[1]!) : {};
    check("7.5 next เป็น origin อื่น → returnTo = /home (safeReturnTo)", claims.returnTo === "/home" || claims.returnTo === undefined, String(claims.returnTo));
  }
  r = await googleStart.GET(req(`https://www.rizance.com/api/auth/google`));
  {
    const state = (r.headers.getSetCookie?.() ?? []).map(parseSetCookie).find((c) => c.name === "rizance_oauth");
    const claims = state ? b64json(state.value.split(".")[1]!) : {};
    check("7.6 ไม่มี next → ไม่มี returnTo (พฤติกรรมเดิม → /home)", claims.returnTo === undefined);
  }
  {
    const cb = src("app/api/auth/google/callback/route.ts");
    check("7.7 callback ใช้ safeReturnTo(oauthState.returnTo, \"/home\") ตอนล็อกอินสำเร็จ", cb.includes('safeReturnTo(oauthState.returnTo, "/home")'));
    check("7.8 callback ยังตรวจ state ก่อน code (A-3.SEC)", cb.indexOf("await verifyOAuthState(") < cb.indexOf('searchParams.get("code")'));
  }

  // ══ 8 · LoginForm / structure ════════════════════════════════════════
  head("8 · STRUCTURE");
  const lf = src("components/auth/LoginForm.tsx");
  check("8.1 LoginForm ใช้ safeNextPath (ไม่รับ next ดิบ)", lf.includes('safeNextPath(params.get("next"), "/home")') && !lf.includes('params.get("next") || "/home"'));
  check("8.2 LoginForm full-navigation สำหรับ /api/ path", lf.includes("requiresFullNavigation(next)") && lf.includes("window.location.assign(next)"));
  check("8.3 GoogleSignInButton รับ next", lf.includes("<GoogleSignInButton next={next} />"));
  check("8.4 oauth-state.safeReturnTo = safeNextPath ตัวเดียวกัน", src("lib/oauth-state.ts").includes("return safeNextPath(raw, fallback);"));
  const acc = src("app/api/pos/handoff/accept/route.ts");
  check("8.5 accept ไม่อ่าน next จาก query (ใช้ claims.next เท่านั้น)", !acc.includes('searchParams.get("next")') && acc.includes("claims.next"));
  check("8.6 accept ไม่ log token", !/console\.(log|warn|error)\([^)]*\b(t|token)\b/.test(acc));
  check("8.7 accept ใช้ sessionCookieOptions(requestHostname(req)) ชุดเดิม", acc.includes("sessionCookieOptions(requestHostname(req))"));
  const mig = src("db/migrations/0100_pos_handoff_tokens.sql");
  check("8.8 migration: jti_hash PK · user_id FK CASCADE · expires_at · consumed_at · ไม่มี column token",
    /jti_hash\s+TEXT\s+PRIMARY KEY/.test(mig) && mig.includes("REFERENCES users(id) ON DELETE CASCADE") && mig.includes("expires_at") && mig.includes("consumed_at") && !/\btoken\s+TEXT/.test(mig));
  const ph = src("lib/pos-handoff.ts");
  check("8.9 consume SQL เป็น atomic UPDATE … consumed_at IS NULL AND expires_at > now()", /UPDATE pos_handoff_tokens[\s\S]*consumed_at IS NULL[\s\S]*expires_at > now\(\)/.test(ph));
  check("8.10 ไม่มี in-memory store ใน production path (setHandoffStoreForTests ปฏิเสธบน Vercel)", ph.includes('process.env.VERCEL === "1"') && ph.includes("throw new Error(\"setHandoffStoreForTests is not allowed"));
  check("8.11 middleware ไม่แตะ canonicalRedirectTarget / CORS block", src("middleware.ts").includes("canonicalRedirectTarget(host, pathname, req.nextUrl.search)") && src("middleware.ts").includes('pathname.startsWith("/api/pos/")'));

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
