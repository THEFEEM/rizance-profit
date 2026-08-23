import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  CorrectionNotFoundError,
  CorrectionStateError,
  listCorrections,
  reviewCorrection,
} from "@/lib/hr-ops-queries";
import { z } from "zod";

/** คำขอแก้เวลา — ฝั่งเจ้าของร้าน (อนุมัติ = ปรับผ่าน adjustment เดิม + audit) */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const status = req.nextUrl.searchParams.get("status");
  const corrections = await listCorrections(
    userId,
    status === "pending" || status === "approved" || status === "rejected"
      ? status
      : undefined,
  );
  return NextResponse.json({ data: { corrections } });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(255).nullish().transform((v) => v || null),
});

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const correction = await reviewCorrection(userId, parsed.data.id, {
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    return NextResponse.json({ data: { correction } });
  } catch (err) {
    if (err instanceof CorrectionNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof CorrectionStateError) {
      return NextResponse.json({ error: "invalid_state" }, { status: 409 });
    }
    if ((err as { code?: string }).code === "23514") {
      return NextResponse.json({ error: "invalid_time_range" }, { status: 400 });
    }
    throw err;
  }
}
