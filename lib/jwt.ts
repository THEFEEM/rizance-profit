import { SignJWT, jwtVerify } from "jose";
import { useSecureCookies, sessionCookieDomain } from "@/lib/env";

// Edge-safe (jose only — no bcrypt) so middleware can import it.
export const SESSION_COOKIE = "rizance_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET is missing or too short. Set it in .env.local.");
  }
  return new TextEncoder().encode(secret);
}

/** Sign a stateless session JWT carrying the userId in `sub`. */
export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Verify a session JWT; returns the userId (sub) or null. */
export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function normalizeHost(host: string): string {
  return host.split(":")[0]!.toLowerCase();
}

/** Host from request (no port) for cookie domain resolution. */
export function requestHostname(req: { headers: Headers; nextUrl: URL }): string {
  const raw = req.headers.get("host");
  if (raw) return normalizeHost(raw);
  return req.nextUrl.hostname.toLowerCase();
}

export function resolveCookieDomain(host: string): string | undefined {
  const configuredDomain = sessionCookieDomain();
  if (!configuredDomain) return undefined;
  const bareDomain = configuredDomain.replace(/^\./, "");
  const normalized = normalizeHost(host);
  if (normalized === bareDomain || normalized.endsWith("." + bareDomain)) {
    return configuredDomain;
  }
  return undefined;
}

/** Shared cookie flags: httpOnly always; Secure on Vercel / production HTTPS. */
function baseCookieOptions(host: string) {
  const domain = resolveCookieDomain(host);
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

/** Cookie options for login/register (set session). */
export function sessionCookieOptions(host: string) {
  return {
    ...baseCookieOptions(host),
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Cookie options for logout (clear session). */
export function clearSessionCookieOptions(host: string) {
  return {
    ...baseCookieOptions(host),
    maxAge: 0,
  };
}
