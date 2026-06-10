import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { contextPatchSchema } from "@/lib/context-validation";
import { getAppContext, setAppContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const data = await getAppContext(userId, req);
  return NextResponse.json({ data });
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

  const result = await setAppContext(userId, parsed.data);
  if (!result.ok) {
    const status =
      result.reason === "booth_not_found"
        ? 404
        : result.reason === "booth_closed"
          ? 409
          : 400;
    const messages = {
      invalid_input: "ข้อมูลบริบทไม่ถูกต้อง",
      booth_not_found: "ไม่พบงานบูธนี้",
      booth_closed: "งานบูธปิดแล้ว — สลับบริบทไม่ได้",
    };
    return NextResponse.json(
      { error: { message: messages[result.reason], reason: result.reason } },
      { status },
    );
  }

  return NextResponse.json({ data: result.context });
}
