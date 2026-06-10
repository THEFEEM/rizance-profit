import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { useSecureCookies } from "@/lib/env";
import { defaultBoothEntryDate } from "@/lib/date";
import { getBooth } from "@/lib/booth-queries";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";

export const CONTEXT_COOKIE = "rizance_context";
const CONTEXT_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function contextCookieOptions() {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: CONTEXT_MAX_AGE,
  };
}

export function clearContextCookieOptions() {
  return {
    ...contextCookieOptions(),
    maxAge: 0,
  };
}

export function encodeContextCookie(mode: "regular" | { boothId: string }): string {
  return mode === "regular" ? "regular" : `booth:${mode.boothId}`;
}

export function parseContextCookie(
  raw: string | undefined,
): { type: "regular" } | { type: "booth"; boothId: string } | { type: "invalid" } {
  if (!raw || raw === "regular") return { type: "regular" };
  if (raw.startsWith("booth:")) {
    const boothId = raw.slice(6);
    if (UUID_RE.test(boothId)) return { type: "booth", boothId };
  }
  return { type: "invalid" };
}

async function readContextRawAsync(req?: NextRequest): Promise<string | undefined> {
  if (req) return req.cookies.get(CONTEXT_COOKIE)?.value;
  const store = await cookies();
  return store.get(CONTEXT_COOKIE)?.value;
}

async function setContextCookieValue(value: string) {
  const store = await cookies();
  store.set(CONTEXT_COOKIE, value, contextCookieOptions());
}

async function clearContextCookie() {
  const store = await cookies();
  store.set(CONTEXT_COOKIE, "", clearContextCookieOptions());
}

/** Resolved context for Today — invalid/stale cookies fall back to regular. */
export type ResolvedTodayContext =
  | { mode: "regular" }
  | { mode: "booth"; booth: Booth; boothId: string; date: string };

/**
 * Resolve effective Today context. Clears cookie when booth is missing, closed,
 * or cookie is malformed — never throws, never returns another user's booth.
 */
export async function resolveTodayContext(
  userId: string,
  req?: NextRequest,
): Promise<ResolvedTodayContext> {
  const raw = await readContextRawAsync(req);
  const parsed = parseContextCookie(raw);

  if (parsed.type === "regular") {
    return { mode: "regular" };
  }

  if (parsed.type === "invalid") {
    if (raw) await clearContextCookie();
    return { mode: "regular" };
  }

  const booth = await getBooth(userId, parsed.boothId);
  if (!booth || booth.status !== "open") {
    await clearContextCookie();
    return { mode: "regular" };
  }

  return {
    mode: "booth",
    booth,
    boothId: booth.id,
    date: defaultBoothEntryDate(booth.startDate, booth.endDate),
  };
}

/** API-facing context (no booth domain object). */
export async function getAppContext(userId: string, req?: NextRequest): Promise<AppContext> {
  const resolved = await resolveTodayContext(userId, req);
  if (resolved.mode === "regular") return { mode: "regular" };
  return {
    mode: "booth",
    boothId: resolved.boothId,
    boothName: resolved.booth.name,
  };
}

export type SetContextResult =
  | { ok: true; context: AppContext }
  | { ok: false; reason: "invalid_input" | "booth_not_found" | "booth_closed" };

/** Validate and persist context cookie (PATCH /api/context). */
export async function setAppContext(
  userId: string,
  input: { mode: "regular" } | { mode: "booth"; boothId: string },
): Promise<SetContextResult> {
  if (input.mode === "regular") {
    await setContextCookieValue("regular");
    return { ok: true, context: { mode: "regular" } };
  }

  if (!UUID_RE.test(input.boothId)) {
    return { ok: false, reason: "invalid_input" };
  }

  const booth = await getBooth(userId, input.boothId);
  if (!booth) return { ok: false, reason: "booth_not_found" };
  if (booth.status !== "open") return { ok: false, reason: "booth_closed" };

  await setContextCookieValue(encodeContextCookie({ boothId: booth.id }));
  return {
    ok: true,
    context: { mode: "booth", boothId: booth.id, boothName: booth.name },
  };
}
