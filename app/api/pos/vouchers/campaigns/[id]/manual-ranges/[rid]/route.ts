import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { manualRangeStatusSchema } from "@/lib/pos-voucher-schema";
import { setManualRangeStatus } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, readJson, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

type Ctx = { params: Promise<{ id: string; rid: string }> };

/**
 * PATCH /api/pos/vouchers/campaigns/:id/manual-ranges/:rid  { status: active|paused|archived }
 * พัก/ปิดช่วง code = ทำให้ code ที่แจกไปแล้วใช้ไม่ได้ → manager unlock เหมือน block/cancel ใบ
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const locked = await requireManagerUnlock(req, userId);
  if (locked) return locked;

  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return notFound();
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = manualRangeStatusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const range = await setManualRangeStatus(userId, id, rid, parsed.data.status);
    return NextResponse.json({ data: { range } });
  } catch (err) {
    return voucherRouteError(err, "manual-ranges.status");
  }
}
