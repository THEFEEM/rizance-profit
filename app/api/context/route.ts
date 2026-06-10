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

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const raw = req.cookies.get(CONTEXT_COOKIE)?.value;
  const resolved = await resolveTodayContext(userId, req, raw);
  const data =
    resolved.mode === "regular"
      ? { mode: "regular" as const }
      : {
          mode: "booth" as const,
          boothId: resolved.boothId,
          boothName: resolved.booth.name,
        };

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
