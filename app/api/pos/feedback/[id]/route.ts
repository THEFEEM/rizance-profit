import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { FEEDBACK_STATUSES, updatePosFeedbackStatus } from "@/lib/pos-feedback-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  staffNote: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(300))
    .nullable()
    .optional(),
});

/** PATCH /api/pos/feedback/:id — เปลี่ยนสถานะ (new → seen → resolved) + โน้ตของร้าน */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (parsed.data.status === undefined && parsed.data.staffNote === undefined) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const ok = await updatePosFeedbackStatus(userId, id, parsed.data);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
