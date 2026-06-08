import { SignJWT, jwtVerify } from "jose";
import { useSecureCookies } from "@/lib/env";

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

/** Shared cookie flags: httpOnly always; Secure on Vercel / production HTTPS. */
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Cookie options for login/register (set session). */
export function sessionCookieOptions() {
  return {
    ...baseCookieOptions(),
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Cookie options for logout (clear session). */
export function clearSessionCookieOptions() {
  return {
    ...baseCookieOptions(),
    maxAge: 0,
  };
}
