/**
 * A-Android Phase 2 — TWA FOUNDATION CHECK
 *
 * ทดสอบเชิงพฤติกรรมเท่าที่ทำได้โดยไม่ต้องยิงเซิร์ฟเวอร์:
 * เรียก route handler ของ assetlinks จริง ๆ แล้วอ่าน response — ไม่ใช่การส่องซอร์ส
 * (บทเรียน A-3.SEC-5: เทสที่ตรวจลำดับข้อความในไฟล์พิสูจน์พฤติกรรมไม่ได้)
 *
 * รัน: npm run test:twa-foundation
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 56 - t.length))}`);

const ROOT = process.cwd();

/**
 * ทุก SHA-256 ที่ Play Console ยืนยันแล้วสำหรับ `app.rizance`
 *
 * รายการนี้เขียนแยกจาก route โดยตั้งใจ — ถ้าใครแก้ข้างเดียว เทสจะแดงทันที
 * ตัวที่ 3 (F7:A9:…) คือใบที่ APK บนเครื่อง Samsung ใช้จริง ยืนยันด้วย ADB
 */
const EXPECTED_FINGERPRINTS = [
  "FF:60:AD:69:0F:CF:7E:1D:85:FD:4C:60:A0:CD:26:80:EE:98:89:E3:33:4E:DA:D8:91:F3:04:AC:9C:32:49:C9",
  "5F:C7:C8:5E:23:E3:83:9D:48:73:B0:5D:5F:85:D5:E8:20:4A:97:39:A3:08:6E:EF:16:94:65:F7:DD:AE:E0:55",
  "F7:A9:8A:50:90:12:31:5E:00:A7:9E:BA:1B:2F:72:5E:50:4D:63:37:37:66:F1:68:32:62:4D:97:86:51:93:D1",
];

/** ใบที่ติดตั้งจริงบนเครื่อง — ขาดตัวนี้ = TWA โชว์แถบ URL ของ Chrome */
const DEVICE_INSTALLED_FINGERPRINT = EXPECTED_FINGERPRINTS[2];

/** 32 ไบต์ hex ตัวพิมพ์ใหญ่ คั่นด้วย : */
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

async function main(): Promise<void> {
  // ══ 1 · MANIFEST ═══════════════════════════════════════════════════
  head("1 · MANIFEST");
  const manifestRaw = readFileSync(join(ROOT, "public", "manifest.json"), "utf8");

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestRaw);
    check("1.1 manifest.json parse ได้", true);
  } catch (e) {
    check("1.1 manifest.json parse ได้", false, (e as Error).message);
    process.exit(1);
  }

  check("1.2 id = '/'", manifest.id === "/", String(manifest.id));
  // ค่าที่ห้ามเปลี่ยนตามสเปก Phase 2
  check("1.3 name ไม่เปลี่ยน", manifest.name === "Rizance");
  check("1.4 short_name ไม่เปลี่ยน", manifest.short_name === "Rizance");
  check("1.5 start_url ไม่เปลี่ยน", manifest.start_url === "/?source=pwa");
  check("1.6 scope ไม่เปลี่ยน", manifest.scope === "/");
  check("1.7 display = standalone (จำเป็นสำหรับ TWA)", manifest.display === "standalone");
  check("1.8 orientation ไม่เปลี่ยน", manifest.orientation === "portrait");
  check("1.9 theme_color ไม่เปลี่ยน", manifest.theme_color === "#0E1525");
  check("1.10 background_color ไม่เปลี่ยน", manifest.background_color === "#0E1525");
  const icons = manifest.icons as Array<{ sizes: string; purpose: string }>;
  check("1.11 icons ครบ 4 รายการเหมือนเดิม", Array.isArray(icons) && icons.length === 4);
  check("1.12 มี maskable 512 (เกณฑ์ Bubblewrap)",
    icons?.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));

  // ══ 2 · ASSETLINKS ROUTE — เรียกจริง ไม่ใช่ส่องซอร์ส ══════════════
  head("2 · ASSETLINKS ROUTE (behavioural)");
  const mod = await import("../app/.well-known/assetlinks.json/route");
  check("2.1 route export GET", typeof mod.GET === "function");

  const res = await mod.GET();
  check("2.2 HTTP 200", res.status === 200, String(res.status));
  check("2.3 Content-Type เป็น JSON",
    (res.headers.get("content-type") ?? "").includes("application/json"),
    res.headers.get("content-type") ?? "-");

  const body = (await res.json()) as Array<{
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }>;

  check("2.4 body เป็น array 1 statement", Array.isArray(body) && body.length === 1);
  const st = body[0];
  check("2.5 relation = delegate_permission/common.handle_all_urls",
    Array.isArray(st?.relation) && st.relation[0] === "delegate_permission/common.handle_all_urls");
  check("2.6 namespace = android_app", st?.target?.namespace === "android_app");
  check("2.7 package_name = app.rizance ตรงเป๊ะ",
    st?.target?.package_name === "app.rizance", st?.target?.package_name);

  const fps = st?.target?.sha256_cert_fingerprints ?? [];

  check("2.8 ไม่มี placeholder หลงเหลือใน fingerprints",
    fps.length > 0 && !fps.some((f) => /^<.*>$/.test(String(f))),
    fps.join(" "));

  // ครบทุกตัวที่ Play Console ยืนยัน — ขาดตัวใดตัวหนึ่ง verify อาจพังบนบางเครื่อง
  for (const want of EXPECTED_FINGERPRINTS) {
    check(`2.9 มี fingerprint ${want.slice(0, 11)}…`, fps.includes(want));
  }
  check("2.9d มีใบที่ติดตั้งจริงบนเครื่อง Samsung (ADB-verified)",
    fps.includes(DEVICE_INSTALLED_FINGERPRINT));

  // ไม่มีตัวเกินที่ไม่ได้อยู่ในรายการที่ Play Console รับรอง
  const extras = fps.filter((f) => !EXPECTED_FINGERPRINTS.includes(String(f)));
  check("2.9e ไม่มี fingerprint นอกรายการที่รับรอง", extras.length === 0,
    extras.join(" "));

  check("2.9f จำนวนตรงกับรายการที่รับรองพอดี",
    fps.length === EXPECTED_FINGERPRINTS.length, `${fps.length}`);

  check("2.9g ไม่มี fingerprint ซ้ำ",
    new Set(fps.map(String)).size === fps.length,
    fps.join(" "));

  check("2.9h ทุกตัวรูปแบบถูกต้อง (32 ไบต์ hex ตัวพิมพ์ใหญ่)",
    fps.every((f) => FINGERPRINT_RE.test(String(f))),
    fps.filter((f) => !FINGERPRINT_RE.test(String(f))).join(" ") || "-");

  check("2.10 configured → Cache-Control ใช้ branch production",
    (res.headers.get("cache-control") ?? "") === "public, max-age=3600",
    res.headers.get("cache-control") ?? "-");
  check("2.10b configured → ต้องไม่มี no-store หลงเหลือ",
    !(res.headers.get("cache-control") ?? "").includes("no-store"));
  check("2.11 header สถานะ = configured",
    res.headers.get("x-rizance-assetlinks-status") === "configured",
    res.headers.get("x-rizance-assetlinks-status") ?? "-");

  // ไม่มีความลับหลุดออกไปกับ response
  const raw = JSON.stringify(body);
  const secretish = ["SECRET", "sk_", "eyJ", "SERVICE_ROLE", "JWT_", "OPENAI", "STRIPE", "VAPID"];
  check("2.12 response ไม่มีอะไรที่ดูเหมือนความลับ",
    !secretish.some((s) => raw.toUpperCase().includes(s.toUpperCase())));

  // ══ 3 · MIDDLEWARE — public เฉพาะที่ตั้งใจ ════════════════════════
  head("3 · MIDDLEWARE");
  const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  check("3.1 assetlinks อยู่ใน PUBLIC_FILES อย่างชัดแจ้ง",
    mw.includes('"/.well-known/assetlinks.json"'));
  check("3.2 ไม่ได้เปิด /.well-known/* ทั้งหมด",
    !mw.includes('startsWith("/.well-known/")') && !mw.includes("'/.well-known/'"));

  // route ที่ต้องยังถูกป้องกันอยู่ — PUBLIC_PATHS ต้องไม่โตขึ้น
  const publicPathsLine = mw.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)?.[1] ?? "";
  const publicPaths = publicPathsLine.split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean);
  check("3.3 PUBLIC_PATHS ยังเป็น 6 เส้นทางเดิม", publicPaths.length === 6,
    publicPaths.join(" "));
  for (const p of ["/", "/login", "/register", "/pricing", "/privacy", "/terms"]) {
    check(`3.4 PUBLIC_PATHS ยังมี ${p}`, publicPaths.includes(p));
  }
  for (const p of ["/home", "/settings", "/profile", "/summary", "/chat"]) {
    check(`3.5 ${p} ยังไม่ public`, !publicPaths.includes(p));
  }
  check("3.6 ยังเช็ค session อยู่ (ไม่ได้ทำให้ auth อ่อนลง)",
    mw.includes("verifySession") && mw.includes("!userId && !isPublic"));

  // ══ 4 · INSTALL BUTTON ════════════════════════════════════════════
  head("4 · INSTALL BUTTON");
  const btn = readFileSync(
    join(ROOT, "components", "landing", "InstallAppButton.tsx"), "utf8");

  check("4.1 ตรวจ display-mode standalone", btn.includes("display-mode"));
  check("4.2 ตรวจ TWA ด้วย android-app:// referrer",
    btn.includes('document.referrer.startsWith("android-app://")'));
  check("4.3 ยังรองรับ iOS standalone", btn.includes("navigator as Navigator & { standalone?: boolean }"));
  check("4.4 ยังฟัง beforeinstallprompt (เบราว์เซอร์ปกติต้องติดตั้งได้เหมือนเดิม)",
    btn.includes('addEventListener("beforeinstallprompt"'));
  check("4.5 ยังฟัง appinstalled", btn.includes('addEventListener("appinstalled"'));
  check("4.6 ติดตั้งแล้วเปลี่ยนเป็นปุ่มเข้าใช้งาน", btn.includes("if (installed)"));

  // ══ 5 · ไม่มีการแตะฐานข้อมูล ═════════════════════════════════════
  head("5 · NO DB IMPACT");
  const routeSrc = readFileSync(
    join(ROOT, "app", ".well-known", "assetlinks.json", "route.ts"), "utf8");
  check("5.1 assetlinks route ไม่ import lib/db", !routeSrc.includes("lib/db"));
  check("5.2 assetlinks route ไม่มี SQL", !/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(routeSrc));
  check("5.3 assetlinks route ไม่อ่าน process.env", !routeSrc.includes("process.env"));
  // กันการ deploy ทั้งที่ยังมี placeholder ค้างอยู่ในซอร์ส (รูปแบบ ALL_CAPS ในวงเล็บแหลม)
  check("5.4 ไม่มี placeholder แบบ ALL_CAPS หลงเหลือในซอร์สของ route",
    !/<[A-Z][A-Z0-9_]{3,}>/.test(routeSrc));

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
