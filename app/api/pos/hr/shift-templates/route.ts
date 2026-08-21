import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  createShiftTemplate,
  listShiftTemplates,
  updateShiftTemplate,
} from "@/lib/hr-shift-queries";
import { shiftTemplateCreateSchema, shiftTemplatePatchSchema } from "@/lib/hr-validation";

/** Shift templates — ค่าเริ่มต้นไว้สร้างกะเร็ว (owner เท่านั้น) */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({ data: { templates: await listShiftTemplates(userId) } });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = shiftTemplateCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const template = await createShiftTemplate(userId, parsed.data);
    return NextResponse.json({ data: { template } }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "name_taken" }, { status: 409 });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = shiftTemplatePatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { id, ...input } = parsed.data;
  const ok = await updateShiftTemplate(userId, id, input);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
