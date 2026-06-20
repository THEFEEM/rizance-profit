import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { contextPatchSchema } from "@/lib/context-validation";
import {
  CONTEXT_COOKIE,
  clearContextCookieOptions,
  contextCookieOptions,
  encodeContextCookie,
  resolveTodayContext,
  shouldClearContextCookie,
} from "@/lib/context";
import { getBooth } from "@/lib/booth-queries";
import { getProject } from "@/lib/project-queries";

function contextResponse(
  resolved: Awaited<ReturnType<typeof resolveTodayContext>>,
) {
  if (resolved.mode === "regular") return { mode: "regular" as const };
  if (resolved.mode === "personal") return { mode: "personal" as const };
  if (resolved.mode === "project") {
    return {
      mode: "project" as const,
      projectId: resolved.projectId,
      projectName: resolved.project.name,
      orgName: resolved.project.orgName,
    };
  }
  return {
    mode: "booth" as const,
    boothId: resolved.boothId,
    boothName: resolved.booth.name,
  };
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const raw = req.cookies.get(CONTEXT_COOKIE)?.value;
  const resolved = await resolveTodayContext(userId, req, raw);
  const data = contextResponse(resolved);

  const res = NextResponse.json({ data });
  if (shouldClearContextCookie(raw, resolved)) {
    res.cookies.set(CONTEXT_COOKIE, "", clearContextCookieOptions());
  }
  return res;
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = contextPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  if (parsed.data.mode === "regular") {
    const res = NextResponse.json({ data: { mode: "regular" as const } });
    res.cookies.set(CONTEXT_COOKIE, "regular", contextCookieOptions());
    return res;
  }

  if (parsed.data.mode === "personal") {
    const res = NextResponse.json({ data: { mode: "personal" as const } });
    res.cookies.set(CONTEXT_COOKIE, "personal", contextCookieOptions());
    return res;
  }

  if (parsed.data.mode === "project") {
    const project = await getProject(userId, parsed.data.projectId);
    if (!project) {
      return NextResponse.json(
        { error: { message: "ไม่พบองค์กรนี้", reason: "project_not_found" } },
        { status: 404 },
      );
    }
    if (project.status === "closed") {
      return NextResponse.json(
        { error: { message: "องค์กรปิดแล้ว — สลับบริบทไม่ได้", reason: "project_closed" } },
        { status: 409 },
      );
    }
    if (project.projectType !== "long") {
      return NextResponse.json(
        { error: { message: "โครงการระยะสั้นใช้บริบทองค์กรไม่ได้", reason: "project_not_org" } },
        { status: 409 },
      );
    }

    const res = NextResponse.json({
      data: {
        mode: "project" as const,
        projectId: project.id,
        projectName: project.name,
        orgName: project.orgName,
      },
    });
    res.cookies.set(
      CONTEXT_COOKIE,
      encodeContextCookie({ projectId: project.id }),
      contextCookieOptions(),
    );
    return res;
  }

  const booth = await getBooth(userId, parsed.data.boothId);
  if (!booth) {
    return NextResponse.json(
      { error: { message: "ไม่พบงานบูธนี้", reason: "booth_not_found" } },
      { status: 404 },
    );
  }
  if (booth.status !== "open") {
    return NextResponse.json(
      { error: { message: "งานบูธปิดแล้ว — สลับบริบทไม่ได้", reason: "booth_closed" } },
      { status: 409 },
    );
  }

  const res = NextResponse.json({
    data: { mode: "booth" as const, boothId: booth.id, boothName: booth.name },
  });
  res.cookies.set(CONTEXT_COOKIE, encodeContextCookie({ boothId: booth.id }), contextCookieOptions());
  return res;
}
