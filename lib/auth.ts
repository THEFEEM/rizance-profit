import bcrypt from "bcryptjs";

// Node-runtime auth helpers. JWT/cookie helpers live in lib/jwt.ts (edge-safe)
// and are re-exported here so route handlers have a single import surface.
export {
  SESSION_COOKIE,
  signSession,
  verifySession,
  sessionCookieOptions,
} from "@/lib/jwt";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
