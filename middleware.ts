import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";
import { isVercel } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/register"];

function isPublicStaticFile(pathname: string): boolean {
  const PUBLIC_FILES = ["/sw.js", "/manifest.json", "/favicon.ico"];
  return (
    PUBLIC_FILES.includes(pathname) ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/") ||
    /\.(png|jpg|jpeg|gif|svg|ico|json|webmanifest|txt|xml|webp)$/i.test(pathname)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Belt-and-suspenders: force HTTPS on production (Vercel terminates TLS at the edge).
  if (isVercel() && req.headers.get("x-forwarded-proto") === "http") {
    const host = req.headers.get("host") ?? req.nextUrl.host;
    return NextResponse.redirect(`https://${host}${pathname}${req.nextUrl.search}`, 301);
  }

  // PWA / static passthrough — must run before auth (sw.js, manifest, icons).
  if (isPublicStaticFile(pathname)) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = await verifySession(token);

  // Signed-in users shouldn't see login/register — send them to Today.
  if (userId && isPublic) {
    return NextResponse.redirect(new URL("/", req.url));
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
  // Run on everything except API routes, Next internals, PWA files, and static assets.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json|icons/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|json|webmanifest|txt|xml|webp)$).*)",
  ],
};
