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

function readContextRaw(req?: NextRequest): string | undefined {
  return req?.cookies.get(CONTEXT_COOKIE)?.value;
}

/** Resolved context for Today — read-only; never mutates cookies (safe in Server Components). */
export type ResolvedTodayContext =
  | { mode: "regular" }
  | { mode: "booth"; booth: Booth; boothId: string; date: string };

/**
 * Resolve effective Today context from a cookie value.
 * Invalid/stale booth cookies fall back to regular WITHOUT writing cookies here —
 * cookie cleanup belongs in Route Handlers (see GET /api/context).
 */
export async function resolveTodayContext(
  userId: string,
  req?: NextRequest,
  rawCookie?: string,
): Promise<ResolvedTodayContext> {
  const raw = rawCookie ?? readContextRaw(req);
  const parsed = parseContextCookie(raw);

  if (parsed.type === "regular") {
    return { mode: "regular" };
  }

  if (parsed.type === "invalid") {
    return { mode: "regular" };
  }

  const booth = await getBooth(userId, parsed.boothId);
  if (!booth || booth.status !== "open") {
    return { mode: "regular" };
  }

  return {
    mode: "booth",
    booth,
    boothId: booth.id,
    date: defaultBoothEntryDate(booth.startDate, booth.endDate),
  };
}

/** True when the stored cookie should be cleared (stale/invalid booth reference). */
export function shouldClearContextCookie(
  raw: string | undefined,
  resolved: ResolvedTodayContext,
): boolean {
  if (!raw || raw === "regular") return false;
  const parsed = parseContextCookie(raw);
  if (parsed.type === "invalid") return true;
  if (parsed.type === "booth" && resolved.mode === "regular") return true;
  return false;
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

/** Bottom-nav +In / −Out targets from resolved context (closed/invalid booth → regular). */
export function entryNavRoutes(resolved: ResolvedTodayContext): {
  income: string;
  expense: string;
} {
  if (resolved.mode === "booth") {
    return {
      income: `/booth/${resolved.boothId}/income`,
      expense: `/booth/${resolved.boothId}/expense`,
    };
  }
  return { income: "/income", expense: "/expense" };
}
