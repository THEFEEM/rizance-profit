import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";
import { canonicalRedirectTarget, getPosAppOrigin, isVercel } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";

// /privacy และ /terms ต้องเปิดได้โดยไม่ล็อกอิน — Google Play ตรวจ URL จากภายนอก
const PUBLIC_PATHS = ["/", "/login", "/register", "/pricing", "/privacy", "/terms"];

// ANDROID 4.1 — ทางเข้าของแอปที่ติดตั้ง (TWA / PWA) · ไม่มี UI ของตัวเอง
// ตัดสินที่ edge แล้ว redirect ทันที ผู้ใช้จึงไม่เห็น landing แวบแม้แต่เฟรมเดียว
//   มี session   → /home   (หน้าแรกของแอปเดิม)
//   ไม่มี session → /login (หน้าล็อกอินเดิม · ไม่ส่ง ?next= เพราะ /app ไม่ใช่ปลายทาง)
// จับเฉพาะ path นี้ตัวเดียวแบบตรงตัว — ไม่ใช่ prefix — เพื่อไม่ไปทับเส้นทางอื่นในอนาคต
// เว็บปกติที่ / ยังเห็น landing เหมือนเดิมทุกประการ
const APP_ENTRY_PATH = "/app";

function isPublicStaticFile(pathname: string): boolean {
  // /.well-known/assetlinks.json — Google ดึงไฟล์นี้จากภายนอกโดยไม่มี cookie
  // เพื่อ verify Digital Asset Links ของ TWA (package app.rizance)
  //
  // ⚠️ วันนี้ path นี้ถูกกันไว้แล้วโดยบังเอิญที่ matcher ท้ายไฟล์ (กฎ `.json$`)
  //    จึงไม่เคยวิ่งผ่าน middleware อยู่แล้ว — แต่การพึ่งกฎนามสกุลไฟล์เป็นเรื่อง
  //    เปราะบาง ถ้าวันหน้ามีคนถอน `json` ออกจาก matcher การ verify จะพังเงียบ ๆ
  //    และหาสาเหตุยากมาก · บรรทัดนี้จึงเป็นการประกาศเจตนาให้ชัดและเป็นชั้นสำรอง
  //    (ระบุเฉพาะไฟล์เดียว ไม่เปิด /.well-known/* ทั้งหมด)
  const PUBLIC_FILES = [
    "/sw.js",
    "/manifest.json",
    "/favicon.ico",
    "/.well-known/assetlinks.json",
  ];
  return (
    PUBLIC_FILES.includes(pathname) ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/") ||
    /\.(png|jpg|jpeg|gif|svg|ico|json|webmanifest|txt|xml|webp)$/i.test(pathname)
  );
}

function applyPosCorsHeaders(res: NextResponse): NextResponse {
  const origin = getPosAppOrigin();
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  // PUT required for recipe replace endpoints (products/:id/recipe, modifiers/:id/recipe)
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Vary", "Origin");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") ?? req.nextUrl.host;

  // CORS for POS API + public QR-order API — explicit origin (never *).
  if (pathname.startsWith("/api/pos/") || pathname.startsWith("/api/public/")) {
    if (req.method === "OPTIONS") {
      return applyPosCorsHeaders(new NextResponse(null, { status: 204 }));
    }
    return applyPosCorsHeaders(NextResponse.next());
  }

  // Belt-and-suspenders: force HTTPS on production (Vercel terminates TLS at the edge).
  if (isVercel() && req.headers.get("x-forwarded-proto") === "http") {
    return NextResponse.redirect(`https://${host}${pathname}${req.nextUrl.search}`, 301);
  }

  // Canonical host — rizance.app และ host เก่า *.vercel.app ต้อง 308 มา www.rizance.com
  // คง path + query · ปลายทางมาจาก config ไม่ใช่จาก Host header (ดู lib/env.ts)
  // ⚠️ ครอบเฉพาะเส้นทางที่ผ่าน matcher — /api/* ไม่ผ่านที่นี่ Google callback
  //    จึงมี guard ของตัวเองใน app/api/auth/google/callback/route.ts
  const canonical = canonicalRedirectTarget(host, pathname, req.nextUrl.search);
  if (canonical) {
    return NextResponse.redirect(canonical, 308);
  }

  // PWA / static passthrough — must run before auth (sw.js, manifest, icons).
  if (isPublicStaticFile(pathname)) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = await verifySession(token);

  // App entry (ดูคำอธิบายที่ APP_ENTRY_PATH) — ต้องอยู่ก่อนบล็อก `?next=` ด้านล่าง
  // ไม่อย่างนั้นผู้ใช้ที่ยังไม่ล็อกอินจะได้ /login?next=/app แล้ววนกลับมาที่นี่อีกรอบ
  if (pathname === APP_ENTRY_PATH) {
    return NextResponse.redirect(new URL(userId ? "/home" : "/login", req.url));
  }

  // Signed-in users: landing → app home; skip login/register.
  if (userId && pathname === "/") {
    return NextResponse.redirect(new URL("/home", req.url));
  }

  if (userId && pathname === "/login") {
    // AUTH-HOTFIX-1: เคารพ ?next= ที่เป็น path ภายใน (เช่น /api/pos/handoff?…) — เดิมทิ้งไป /home เสมอ
    // ทำให้ POS handoff ของคนที่ล็อกอินอยู่แล้วหลุดไปหน้าแอป · safeNextPath = allowlist รวมศูนย์ ไม่รับ origin อื่น
    const next = safeNextPath(req.nextUrl.searchParams.get("next"), "/home");
    return NextResponse.redirect(new URL(next, req.url));
  }
  if (userId && pathname === "/register") {
    return NextResponse.redirect(new URL("/home", req.url));
  }

  // Unauthenticated users hitting a protected page → login (remember target).
  if (!userId && !isPublic) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/pos/:path*",
    "/api/public/:path*",
    // Run on everything except API routes, Next internals, PWA files, and static assets.
    "/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json|icons/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|json|webmanifest|txt|xml|webp)$).*)",
  ],
};
