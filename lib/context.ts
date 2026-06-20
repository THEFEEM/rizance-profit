import type { NextRequest } from "next/server";
import { useSecureCookies } from "@/lib/env";
import { defaultBoothEntryDate } from "@/lib/date";
import { getBooth } from "@/lib/booth-queries";
import { getProject } from "@/lib/project-queries";
import type { Booth } from "@/types/booth";
import type { Project } from "@/types/project";
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

export function encodeContextCookie(
  mode: "regular" | "personal" | { boothId: string } | { projectId: string },
): string {
  if (mode === "regular") return "regular";
  if (mode === "personal") return "personal";
  if ("boothId" in mode) return `booth:${mode.boothId}`;
  return `project:${mode.projectId}`;
}

export function parseContextCookie(
  raw: string | undefined,
):
  | { type: "regular" }
  | { type: "personal" }
  | { type: "booth"; boothId: string }
  | { type: "project"; projectId: string }
  | { type: "invalid" } {
  if (!raw || raw === "regular") return { type: "regular" };
  if (raw === "personal") return { type: "personal" };
  if (raw.startsWith("booth:")) {
    const boothId = raw.slice(6);
    if (UUID_RE.test(boothId)) return { type: "booth", boothId };
  }
  if (raw.startsWith("project:")) {
    const projectId = raw.slice(8);
    if (UUID_RE.test(projectId)) return { type: "project", projectId };
  }
  return { type: "invalid" };
}

function readContextRaw(req?: NextRequest): string | undefined {
  return req?.cookies.get(CONTEXT_COOKIE)?.value;
}

function isActiveOrgProject(project: Project): boolean {
  return project.projectType === "long" && project.status !== "closed";
}

/** Resolved context for Today — read-only; never mutates cookies (safe in Server Components). */
export type ResolvedTodayContext =
  | { mode: "regular" }
  | { mode: "personal" }
  | { mode: "booth"; booth: Booth; boothId: string; date: string }
  | { mode: "project"; project: Project; projectId: string };

/**
 * Resolve effective Today context from a cookie value.
 * Invalid/stale booth/project cookies fall back to regular WITHOUT writing cookies here —
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

  if (parsed.type === "personal") {
    return { mode: "personal" };
  }

  if (parsed.type === "invalid") {
    return { mode: "regular" };
  }

  if (parsed.type === "project") {
    const project = await getProject(userId, parsed.projectId);
    if (!project || !isActiveOrgProject(project)) {
      return { mode: "regular" };
    }
    return { mode: "project", project, projectId: project.id };
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

/** True when the stored cookie should be cleared (stale/invalid booth/project reference). */
export function shouldClearContextCookie(
  raw: string | undefined,
  resolved: ResolvedTodayContext,
): boolean {
  if (!raw || raw === "regular" || raw === "personal") return false;
  const parsed = parseContextCookie(raw);
  if (parsed.type === "invalid") return true;
  if (parsed.type === "personal" && resolved.mode !== "personal") return true;
  if (parsed.type === "booth" && resolved.mode !== "booth") return true;
  if (parsed.type === "project" && resolved.mode !== "project") return true;
  return false;
}

/** API-facing context (no booth/project domain objects). */
export async function getAppContext(userId: string, req?: NextRequest): Promise<AppContext> {
  const resolved = await resolveTodayContext(userId, req);
  if (resolved.mode === "regular") return { mode: "regular" };
  if (resolved.mode === "personal") return { mode: "personal" };
  if (resolved.mode === "project") {
    return {
      mode: "project",
      projectId: resolved.projectId,
      projectName: resolved.project.name,
      orgName: resolved.project.orgName,
    };
  }
  if (resolved.mode === "booth") {
    return {
      mode: "booth",
      boothId: resolved.boothId,
      boothName: resolved.booth.name,
    };
  }
  return { mode: "regular" };
}

export type SetContextResult =
  | { ok: true; context: AppContext }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "booth_not_found"
        | "booth_closed"
        | "project_not_found"
        | "project_closed"
        | "project_not_org";
    };

export type EntryNavRoutes = {
  today: string;
  entry: string;
  stats: string;
  profile: string;
};

/** Bottom-nav targets from resolved context (stale/invalid → regular routes). */
export function entryNavRoutes(resolved: ResolvedTodayContext): EntryNavRoutes {
  if (resolved.mode === "personal") {
    return {
      today: "/",
      entry: "/personal/entry",
      stats: "/personal/summary",
      profile: "/profile",
    };
  }
  if (resolved.mode === "booth") {
    return {
      today: "/",
      entry: `/booth/${resolved.boothId}/entry`,
      stats: "/summary",
      profile: "/profile",
    };
  }
  if (resolved.mode === "project") {
    const base = `/projects/${resolved.projectId}`;
    return {
      today: "/",
      entry: `${base}/entry`,
      stats: `${base}/summary`,
      profile: "/profile",
    };
  }
  return {
    today: "/",
    entry: "/entry",
    stats: "/summary",
    profile: "/profile",
  };
}
