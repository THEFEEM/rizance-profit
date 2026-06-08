import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";
import { findUserById } from "@/lib/queries";
import type { User } from "@/types";

/**
 * Resolve the authenticated userId from the session cookie, server-side only.
 * The client NEVER sends user_id — it always comes from this verified JWT.
 *
 * Works both with a NextRequest (route handlers/middleware) and without one
 * (Server Components, via next/headers cookies()).
 */
export async function getUserId(req?: NextRequest): Promise<string | null> {
  let token: string | undefined;
  if (req) {
    token = req.cookies.get(SESSION_COOKIE)?.value;
  } else {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  }
  return verifySession(token);
}

/** Load the full authenticated user for Server Components, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const userId = await getUserId();
  if (!userId) return null;
  return findUserById(userId);
}
