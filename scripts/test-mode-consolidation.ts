/**
 * PHASE 4.3C — PRODUCT MODE CONSOLIDATION (Shop + Booth) · no DB · no network
 *
 * เรียก route handler / resolveTodayContext / component จริง
 * สิทธิ์ grandfathered จำลองด้วย setModeAccessProbeForTests (production ปฏิเสธ)
 *
 * ข้อจำกัดที่ต้องพูดตรง ๆ:
 *   · route ที่ auth ด้วย getCurrentUser() (personal chat ทั้งชุด) และ /api/auth/register (createUser)
 *     แตะ DB ก่อนถึง guard/branch → ทดสอบแบบ behavioural ไม่ได้ที่นี่ → ใช้ structural check
 *     (guard อยู่ถัดจาก 401 ทันที และอยู่ก่อนจุดตัด token AI) + unit test ของ guard/normalize
 *   · เคส "ผ่าน guard" ที่ route ไปแตะ DB ต่อ: DB ปลอมไม่มีวันเชื่อมต่อ → error connect = พิสูจน์ว่าผ่าน guard แล้ว
 *
 * รัน: npm run test:mode-consolidation
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.JWT_SECRET = "test-only-secret-for-mode-consolidation-000";
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test_never_connects";
delete process.env.SHOW_PERSONAL_MODE;
delete process.env.SHOW_ORG_MODE;
delete process.env.VERCEL;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 56 - t.length))}`);
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
});

const NEW = "00000000-0000-4000-8000-0000000000a1";       // ผู้ใช้ใหม่ ไม่มีข้อมูลโหมดเก่า
const GF_PERSONAL = "00000000-0000-4000-8000-0000000000b2"; // มีข้อมูล personal
const GF_ORG = "00000000-0000-4000-8000-0000000000c3";      // มีโปรเจกต์
const UUID_X = "11111111-1111-4111-8111-111111111111";

async function main(): Promise<void> {
  const flags = await import("../lib/feature-flags");
  const access = await import("../lib/mode-access");
  const ctx = await import("../lib/context");
  const jwt = await import("../lib/jwt");
  const { NextRequest } = await import("next/server");

  check("0.1 SHOW_PERSONAL_MODE = false (env ไม่ตั้ง · เหมือน production)", flags.SHOW_PERSONAL_MODE === false);
  check("0.2 SHOW_ORG_MODE = false", flags.SHOW_ORG_MODE === false);

  access.setModeAccessProbeForTests({
    personal: async (id) => id === GF_PERSONAL,
    org: async (id) => id === GF_ORG,
  });

  const cookieFor = async (id: string, extra = "") =>
    `${jwt.SESSION_COOKIE}=${await jwt.signSession(id)}${extra ? `; ${extra}` : ""}`;
  const mkReq = async (url: string, id: string | null, init: { method?: string; body?: unknown; extraCookie?: string } = {}) => {
    const headers = new Headers({ host: "www.rizance.com", "content-type": "application/json" });
    if (id) headers.set("cookie", await cookieFor(id, init.extraCookie));
    return new NextRequest(`https://www.rizance.com${url}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  };
  /** เรียก handler · ถ้า throw เพราะ DB ปลอม = ผ่าน guard ไปแล้ว */
  const call = async (fn: () => Promise<Response>) => {
    try {
      const res = await fn();
      let body: Record<string, unknown> | null = null;
      try { body = (await res.clone().json()) as Record<string, unknown>; } catch { /* not json */ }
      return { res, body, threw: null as string | null };
    } catch (e) {
      return { res: null, body: null, threw: e instanceof Error ? `${e.name}:${(e as { code?: string }).code ?? e.message}` : String(e) };
    }
  };
  const is403Retired = (r: Awaited<ReturnType<typeof call>>) =>
    r.res?.status === 403 && (r.body?.error as Record<string, unknown> | undefined)?.code === "mode_retired";
  const passedGuard = (r: Awaited<ReturnType<typeof call>>) => r.threw !== null || (r.res !== null && r.res.status !== 403);
  const describe = (r: Awaited<ReturnType<typeof call>>) => r.threw ? `threw ${r.threw}` : `${r.res?.status} ${JSON.stringify(r.body)?.slice(0, 80)}`;

  // ══ 1 · registration exposes Shop only ═══════════════════════════════
  head("1 · REGISTRATION UI");
  const tiles = await import("../components/auth/RegisterModeTiles");
  check("1.1 visibleRegisterTiles = [regular] เท่านั้น", JSON.stringify(tiles.visibleRegisterTiles().map((t) => t.mode)) === '["regular"]',
    JSON.stringify(tiles.visibleRegisterTiles().map((t) => t.mode)));
  check("1.2 defaultRegisterMode = regular", tiles.defaultRegisterMode() === "regular");
  const tileHtml = renderToStaticMarkup(createElement(tiles.RegisterModeTiles, { value: "regular", onChange: () => {} }));
  check("1.3 RegisterModeTiles ไม่ render ตัวเลือก (เหลือโหมดเดียว)", tileHtml === "", tileHtml.slice(0, 60));
  check("1.4 ไม่มีคำ บุคคล/องค์กร ใน markup", !/บุคคล|องค์กร/.test(tileHtml));
  const rf = src("components/auth/RegisterForm.tsx");
  check("1.5 หัวข้อ 'เลือกโหมดการใช้งาน' โชว์เฉพาะเมื่อมี > 1 ตัวเลือก", rf.includes("visibleRegisterTiles().length > 1 &&"));

  // ══ 2 · register API ไม่เชื่อ mode จาก client ═══════════════════════
  head("2 · REGISTER API NORMALIZATION");
  const rm = await import("../lib/register-mode");
  check("2.1 personal → regular", rm.normalizeRegisterMode("personal") === "regular");
  check("2.2 org → regular", rm.normalizeRegisterMode("org") === "regular");
  check("2.3 booth → regular (บูธสร้างทีหลังในแอป)", rm.normalizeRegisterMode("booth") === "regular");
  check("2.4 regular → regular", rm.normalizeRegisterMode("regular") === "regular");
  const reg = src("app/api/auth/register/route.ts");
  check("2.5 route ใช้ normalizeRegisterMode(mode)", reg.includes("const effectiveMode = normalizeRegisterMode(mode);"));
  check("2.6 route แตกแขนงด้วย effectiveMode เท่านั้น (ไม่ใช้ mode ดิบ)",
    reg.includes('effectiveMode === "personal"') && reg.includes('effectiveMode === "org"') && !/\bif \(mode === "(personal|org)"\)/.test(reg));
  const { registerSchema } = await import("../lib/validation");
  const noMode = registerSchema.parse({ email: "a@b.co", password: "12345678", shopName: "x" });
  check("2.7 body ไม่ส่ง mode → schema default personal → normalize เป็น regular",
    noMode.mode === "personal" && rm.normalizeRegisterMode(noMode.mode) === "regular");

  // ══ 3 · /api/context PATCH ═══════════════════════════════════════════
  head("3 · /api/context PATCH");
  const ctxRoute = await import("../app/api/context/route");
  const patch = async (id: string, body: unknown) => call(async () => ctxRoute.PATCH(await mkReq("/api/context", id, { method: "PATCH", body })));

  let r = await patch(NEW, { mode: "regular" });
  const setCtx = (res: Response | null) => (res?.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${ctx.CONTEXT_COOKIE}=`)) ?? "";
  check("3.1 regular → 200 · cookie regular", r.res?.status === 200 && setCtx(r.res).startsWith(`${ctx.CONTEXT_COOKIE}=regular`), describe(r));
  r = await patch(NEW, { mode: "booth", boothId: UUID_X });
  check("3.2 booth → ไม่ถูก guard (ไปถึง getBooth)", passedGuard(r) && !is403Retired(r), describe(r));
  r = await patch(NEW, { mode: "personal" });
  check("3.3 personal · ผู้ใช้ใหม่ → 403 mode_retired", is403Retired(r), describe(r));
  check("3.4 …ไม่เขียน cookie personal", !setCtx(r.res).includes("personal"));
  r = await patch(NEW, { mode: "project", projectId: UUID_X });
  check("3.5 project · ผู้ใช้ใหม่ → 403 mode_retired (ก่อนแตะ DB)", is403Retired(r) && r.threw === null, describe(r));
  r = await patch(GF_PERSONAL, { mode: "personal" });
  check("3.6 personal · grandfathered → 200 cookie personal (พฤติกรรมเดิม)",
    r.res?.status === 200 && setCtx(r.res).startsWith(`${ctx.CONTEXT_COOKIE}=personal`), describe(r));
  r = await patch(GF_ORG, { mode: "project", projectId: UUID_X });
  check("3.7 project · grandfathered → ผ่าน guard ไปถึง getProject (พฤติกรรมเดิม)", passedGuard(r) && !is403Retired(r), describe(r));
  r = await patch(GF_ORG, { mode: "personal" });
  check("3.8 grandfathered แค่ org ไม่ได้สิทธิ์ personal → 403", is403Retired(r), describe(r));

  // ══ 4 · stale retired context → Shop · cookie ถูกล้าง ═══════════════
  head("4 · STALE CONTEXT DEGRADE");
  let resolved = await ctx.resolveTodayContext(NEW, undefined, "personal");
  check("4.1 cookie personal · ผู้ใช้ใหม่ → resolve = regular", resolved.mode === "regular", resolved.mode);
  check("4.2 …shouldClearContextCookie = true", ctx.shouldClearContextCookie("personal", resolved) === true);
  const nav = ctx.entryNavRoutes(resolved);
  check("4.3 …nav ไม่ชี้ /personal/* (entry=/entry · stats=/summary)", nav.entry === "/entry" && nav.stats === "/summary", JSON.stringify(nav));
  resolved = await ctx.resolveTodayContext(GF_PERSONAL, undefined, "personal");
  check("4.4 cookie personal · grandfathered → personal (เดิม)", resolved.mode === "personal");
  check("4.5 …ไม่ล้าง cookie", ctx.shouldClearContextCookie("personal", resolved) === false);
  check("4.6 entryNavRoutes(personal) ยังเป็น /personal/entry สำหรับ grandfathered", ctx.entryNavRoutes(resolved).entry === "/personal/entry");
  resolved = await ctx.resolveTodayContext(NEW, undefined, "garbage-value");
  check("4.7 cookie เสีย → regular + ล้าง", resolved.mode === "regular" && ctx.shouldClearContextCookie("garbage-value", resolved));
  resolved = await ctx.resolveTodayContext(NEW, undefined, "regular");
  check("4.8 regular → regular ไม่ล้าง", resolved.mode === "regular" && !ctx.shouldClearContextCookie("regular", resolved));
  resolved = await ctx.resolveTodayContext(NEW, undefined, undefined);
  check("4.9 ไม่มี cookie → regular ไม่ล้าง", resolved.mode === "regular" && !ctx.shouldClearContextCookie(undefined, resolved));
  {
    const g = await call(async () => ctxRoute.GET(await mkReq("/api/context", NEW, { extraCookie: `${ctx.CONTEXT_COOKIE}=personal` })));
    const clear = setCtx(g.res);
    check("4.10 GET /api/context (cookie personal · ผู้ใช้ใหม่) → data.mode regular", (g.body?.data as { mode?: string } | undefined)?.mode === "regular", describe(g));
    check("4.11 …ส่ง Set-Cookie ล้าง rizance_context (Max-Age=0)", clear !== "" && /max-age=0/i.test(clear), clear);
    check("4.12 …ไม่ redirect (กันลูป)", !g.res?.headers.get("location"));
  }

  // ══ 5 · Personal API guard ═══════════════════════════════════════════
  head("5 · PERSONAL API");
  const inc = await import("../app/api/personal/income/route");
  const goals = await import("../app/api/personal/goals/route");
  r = await call(async () => inc.POST(await mkReq("/api/personal/income", NEW, { method: "POST", body: {} })));
  check("5.1 POST /api/personal/income · ผู้ใช้ใหม่ → 403", is403Retired(r), describe(r));
  r = await call(async () => inc.POST(await mkReq("/api/personal/income", GF_PERSONAL, { method: "POST", body: {} })));
  check("5.2 …grandfathered → ผ่าน guard ถึง validation (400) · พฤติกรรมเดิม", r.res?.status === 400, describe(r));
  r = await call(async () => goals.GET(await mkReq("/api/personal/goals", NEW)));
  check("5.3 GET /api/personal/goals · ผู้ใช้ใหม่ → 403", is403Retired(r), describe(r));
  r = await call(async () => goals.GET(await mkReq("/api/personal/goals", GF_PERSONAL)));
  check("5.4 …grandfathered → ผ่าน guard (ไปถึง DB query)", passedGuard(r) && !is403Retired(r), describe(r));
  r = await call(async () => inc.POST(await mkReq("/api/personal/income", null, { method: "POST", body: {} })));
  check("5.5 ไม่ล็อกอิน → 401 เหมือนเดิม (auth มาก่อน guard)", r.res?.status === 401, describe(r));

  // structural: ทุก handler ใน /api/personal/** มี guard ถัดจาก 401 ทันที
  const personalFiles = walk(join(ROOT, "app/api/personal"));
  let handlers = 0; let guarded = 0; const missing: string[] = [];
  for (const f of personalFiles) {
    const s = readFileSync(f, "utf8");
    const fns = s.split(/export async function /).slice(1);
    for (const fn of fns) {
      handlers++;
      const i401 = fn.indexOf("{ status: 401 }");
      const iG = fn.indexOf("personalApiGuard(");
      const between = i401 >= 0 && iG > i401 ? fn.slice(i401, iG) : "";
      // ระหว่าง 401 กับ guard ต้องไม่มีงานอื่น (ไม่มี await อื่นนอกจากปิด block)
      if (iG > i401 && i401 >= 0 && !/await /.test(between.replace(/await $/, ""))) guarded++;
      else missing.push(`${f.slice(ROOT.length + 1)}:${fn.slice(0, 12)}`);
    }
  }
  check(`5.6 ทุก handler ใน /api/personal/** (${handlers}) มี personalApiGuard ถัดจาก 401`, handlers === 15 && guarded === handlers, missing.join(" · "));

  // ══ 6 · Project API guard ════════════════════════════════════════════
  head("6 · PROJECT API");
  const projects = await import("../app/api/projects/route");
  const projectOne = await import("../app/api/projects/[id]/route");
  r = await call(async () => projects.POST(await mkReq("/api/projects", NEW, { method: "POST", body: {} })));
  check("6.1 POST /api/projects (สร้าง) · ผู้ใช้ใหม่ → 403", is403Retired(r), describe(r));
  r = await call(async () => projects.POST(await mkReq("/api/projects", GF_ORG, { method: "POST", body: {} })));
  check("6.2 …grandfathered → ผ่าน guard", passedGuard(r) && !is403Retired(r), describe(r));
  r = await call(async () => projectOne.GET(await mkReq(`/api/projects/${UUID_X}`, NEW), { params: Promise.resolve({ id: UUID_X }) }));
  check("6.3 GET /api/projects/:id · ผู้ใช้ใหม่ → 403", is403Retired(r), describe(r));
  r = await call(async () => projectOne.GET(await mkReq(`/api/projects/${UUID_X}`, GF_ORG), { params: Promise.resolve({ id: UUID_X }) }));
  check("6.4 …grandfathered → ผ่าน guard", passedGuard(r) && !is403Retired(r), describe(r));
  r = await call(async () => projects.GET(await mkReq("/api/projects", NEW)));
  check("6.5 GET /api/projects (รายการ) ตั้งใจไม่ guard — ไม่ 403 (ModePicker/Profile เรียกทุกคน)", !is403Retired(r), describe(r));

  const projectFiles = walk(join(ROOT, "app/api/projects"));
  handlers = 0; guarded = 0; missing.length = 0;
  for (const f of projectFiles) {
    const s = readFileSync(f, "utf8");
    const isList = f.replace(/\\/g, "/").endsWith("app/api/projects/route.ts");
    for (const fn of s.split(/export async function /).slice(1)) {
      if (isList && fn.startsWith("GET")) continue;
      handlers++;
      const i401 = fn.indexOf("{ status: 401 }");
      const iG = fn.indexOf("orgApiGuard(");
      if (i401 >= 0 && iG > i401 && !/await /.test(fn.slice(i401, iG).replace(/await $/, ""))) guarded++;
      else missing.push(`${f.slice(ROOT.length + 1)}:${fn.slice(0, 12)}`);
    }
  }
  check(`6.6 ทุก handler ใน /api/projects/** ยกเว้น GET รายการ (${handlers}) มี orgApiGuard ถัดจาก 401`, handlers === 13 && guarded === handlers, missing.join(" · "));

  // ══ 7 · Personal AI ไม่ตัด token ก่อน guard ═════════════════════════
  head("7 · PERSONAL AI TOKEN");
  for (const f of ["app/api/personal/chat/route.ts", "app/api/personal/chat/scan/route.ts"]) {
    const s = src(f);
    for (const fn of s.split(/export async function /).slice(1)) {
      const name = fn.slice(0, fn.indexOf("("));
      const iG = fn.indexOf("personalApiGuard(");
      const iTok = Math.min(...["resolveTokenScope(", "checkAndDeductTokens(", "openai", "OpenAI", "personalAiChat", "scanPersonal"]
        .map((k) => fn.indexOf(k)).filter((i) => i >= 0), Number.POSITIVE_INFINITY);
      check(`7.x ${f} ${name}: guard อยู่ก่อนจุดใช้/ตัด token`, iG >= 0 && iG < iTok, `guard@${iG} token@${iTok}`);
    }
  }
  check("7.y guard คืน 403 → handler return ทันที (ไม่มีโค้ดใดรันต่อ)", /const retired = await personalApiGuard\(user\.id\);\r?\n\s*if \(retired\) return retired;/.test(src("app/api/personal/chat/route.ts")));
  {
    const g = await access.personalApiGuard(NEW);
    check("7.z personalApiGuard(ผู้ใช้ใหม่) = NextResponse 403 · personalApiGuard(grandfathered) = null",
      g?.status === 403 && (await access.personalApiGuard(GF_PERSONAL)) === null);
  }

  // ══ 8 · landing ไม่ขาย Personal/Organization ═══════════════════════
  head("8 · LANDING");
  const data = await import("../components/landing/data");
  check("8.1 MODES = [shop, booth]", JSON.stringify(data.MODES.map((m) => m.key)) === '["shop","booth"]', JSON.stringify(data.MODES.map((m) => m.key)));
  check("8.2 ไม่มี label ส่วนตัว/องค์กร ใน MODES", !data.MODES.some((m) => /ส่วนตัว|องค์กร/.test(m.label + m.title + m.desc)));
  check("8.3 CAPS ไม่อ้างโหมด ส่วนตัว/องค์กร", !data.CAPS.some((c) => /ส่วนตัว|องค์กร/.test(c.title + c.desc)));
  // ModesTabs/DashboardShowcase ใช้ next/link + Reveal (client) ซึ่ง render นอก Next ไม่ได้ (suspend)
  // → ตรวจว่าทั้งสอง render จาก MODES อย่างเดียว ไม่มีข้อความโหมดเก่า hardcode
  for (const f of ["components/landing/ModesTabs.tsx", "components/landing/DashboardShowcase.tsx"]) {
    const s = src(f);
    check(`8.4 ${f} render จาก MODES และไม่มีข้อความ ส่วนตัว/องค์กร/ชมรม hardcode`, s.includes("MODES.map(") && !/ส่วนตัว|องค์กร|ชมรม/.test(s));
  }
  check("8.5 MODES ยังมี ร้านค้า + บูธ", data.MODES.some((m) => m.label === "ร้านค้า") && data.MODES.some((m) => m.label === "บูธ"));
  const terms = src("app/terms/page.tsx");
  check("8.6 Terms ไม่ enumerate (ส่วนตัว · ร้านค้า · บูธ · องค์กร) แล้ว", !terms.includes("(ส่วนตัว · ร้านค้า · บูธ · องค์กร)"));

  // ══ 9 · Personal Plus ไม่ถูกขาย · billing compat คงอยู่ ═══════════
  head("9 · PERSONAL PLUS");
  check("9.1 landing PLANS ไม่มี personal_plus", !data.PLANS.some((p) => p.key === "personal_plus"), JSON.stringify(data.PLANS.map((p) => p.key)));
  check("9.2 landing PLANS ยังมี free · event_pass · business", ["free", "event_pass", "business"].every((k) => data.PLANS.some((p) => p.key === k)));
  const pp = src("components/landing/PricingPreview.tsx");
  check("9.3 PricingPreview render จาก PLANS เท่านั้น (ไม่มีการ์ด Personal Plus hardcode)", pp.includes("PLANS.map(") && !/name=["']Personal Plus/.test(pp));
  check("9.4 PricingPreview ใช้ 3 คอลัมน์เมื่อเหลือ 3 แพ็กเกจ", data.PLANS.length === 3 && pp.includes('PLANS.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"'));
  const sub = await import("../lib/subscription-plan");
  check("9.5 PAID_STRIPE_PLANS ยังมี personal_plus (ผู้สมัครเดิม/webhook)", (sub.PAID_STRIPE_PLANS as readonly string[]).includes("personal_plus"));
  // lib/token-budget import "server-only" (ไม่มีใน tsx) → ตรวจซอร์ส
  check("9.6 token budget ของ personal_plus ยังอยู่", /personal_plus:\s*300_000/.test(src("lib/token-budget.ts")));
  check("9.7 in-app pricing ยัง gate personal_plus ด้วย SHOW_PERSONAL_MODE (เดิม)",
    src("components/pricing/SubscriptionPricingContent.tsx").includes('if (mode === "personal" && SHOW_PERSONAL_MODE) return "personal_plus";'));
  check("9.8 register page ยังรับ plan=personal_plus สำหรับ checkout compat", src("app/(auth)/register/page.tsx").includes('"personal_plus"'));

  // ══ 10 · Shop ไม่กระทบ ═══════════════════════════════════════════════
  head("10 · SHOP");
  resolved = await ctx.resolveTodayContext(NEW, undefined, "regular");
  const shopNav = ctx.entryNavRoutes(resolved);
  check("10.1 Shop nav: /home /entry /summary /profile", shopNav.today === "/home" && shopNav.entry === "/entry" && shopNav.stats === "/summary" && shopNav.profile === "/profile");
  const ms = src("components/ModeSwitcher.tsx");
  check("10.2 ModeSwitcher ยังมีแท็บ ร้านค้า", ms.includes("ร้านค้า") && ms.includes("switchToRegular"));
  check("10.3 ModeSwitcher: แท็บองค์กรยัง gate ด้วย SHOW_ORG_MODE · ไม่มีแท็บส่วนตัว", ms.includes("{SHOW_ORG_MODE && (") && !/ส่วนตัว/.test(ms));
  check("10.4 clear-all-data org → /projects/new เฉพาะเมื่อ flag เปิด", src("app/api/settings/clear-all-data/route.ts").includes('SHOW_ORG_MODE ? "/projects/new" : "/home"'));

  // ══ 11 · Booth ไม่กระทบ ══════════════════════════════════════════════
  head("11 · BOOTH");
  check("11.1 ModeSwitcher ยังมีแท็บ บูธ", ms.includes("บูธ") && ms.includes("switchToBooth"));
  check("11.2 entryNavRoutes(booth) → /booth/:id/entry", ctx.entryNavRoutes({ mode: "booth", boothId: UUID_X, booth: {} as never, date: "2026-01-01" }).entry === `/booth/${UUID_X}/entry`);
  check("11.3 parseContextCookie(booth:uuid) ยังถูกต้อง", JSON.stringify(ctx.parseContextCookie(`booth:${UUID_X}`)) === JSON.stringify({ type: "booth", boothId: UUID_X }));
  check("11.4 /api/booth* ไม่มี retired guard", !walk(join(ROOT, "app/api")).filter((f) => /[\\/]api[\\/]booths?[\\/]/.test(f)).some((f) => /personalApiGuard|orgApiGuard/.test(readFileSync(f, "utf8"))));
  check("11.5 PATCH booth ไม่ถูก guard (ข้อ 3.2)", true);

  // ══ 12 · test seam ปลอดภัย ═══════════════════════════════════════════
  head("12 · SAFETY");
  process.env.VERCEL = "1";
  let threw = false;
  try { access.setModeAccessProbeForTests(null); } catch { threw = true; }
  delete process.env.VERCEL;
  check("12.1 setModeAccessProbeForTests ปฏิเสธบน Vercel", threw);
  check("12.2 middleware ไม่ถูกแตะ (ไม่มี mode-access)", !src("middleware.ts").includes("mode-access"));

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
