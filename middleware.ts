import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";
import { getAppUrl, getPosAppOrigin, isVercel } from "@/lib/env";

const PUBLIC_PATHS = ["/", "/login", "/register", "/pricing"];
const LEGACY_APP_HOST = "rizance-profit.vercel.app";

function isPublicStaticFile(pathname: string): boolean {
  const PUBLIC_FILES = ["/sw.js", "/manifest.json", "/favicon.ico"];
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
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Vary", "Origin");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") ?? req.nextUrl.host;

  // CORS for POS API only — credentials require explicit origin (never *).
  if (pathname.startsWith("/api/pos/")) {
    if (req.method === "OPTIONS") {
      return applyPosCorsHeaders(new NextResponse(null, { status: 204 }));
    }
    return applyPosCorsHeaders(NextResponse.next());
  }

  // Belt-and-suspenders: force HTTPS on production (Vercel terminates TLS at the edge).
  if (isVercel() && req.headers.get("x-forwarded-proto") === "http") {
    return NextResponse.redirect(`https://${host}${pathname}${req.nextUrl.search}`, 301);
  }

  // Permanent redirect from the old production Vercel host to the canonical app domain.
  if (host === LEGACY_APP_HOST) {
    return NextResponse.redirect(`${getAppUrl()}${pathname}${req.nextUrl.search}`, 308);
  }

  // PWA / static passthrough — must run before auth (sw.js, manifest, icons).
  if (isPublicStaticFile(pathname)) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = await verifySession(token);

  // Signed-in users: landing → app home; skip login/register.
  if (userId && pathname === "/") {
    return NextResponse.redirect(new URL("/home", req.url));
  }

  if (userId && (pathname === "/login" || pathname === "/register")) {
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
    // Run on everything except API routes, Next internals, PWA files, and static assets.
    "/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json|icons/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|json|webmanifest|txt|xml|webp)$).*)",
  ],
};
