import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { manualRangeCreateSchema } from "@/lib/pos-voucher-schema";
import { createManualRange, listManualRanges } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, readJson, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/pos/vouchers/campaigns/:id/manual-ranges — ช่วง code ทั้งหมด + สถิติต่อช่วง (V2.1) */
export async function GET(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  try {
    const ranges = await listManualRanges(userId, id);
    return NextResponse.json({ data: { ranges } });
  } catch (err) {
    return voucherRouteError(err, "manual-ranges.list");
  }
}

/**
 * POST /api/pos/vouchers/campaigns/:id/manual-ranges  { kind:"range", startNumber, endNumber, padding } | { kind:"custom", code }
 *
 * สร้าง code ที่ใช้ลดเงินได้ = เหมือน generate → manager unlock
 * 1 request = 1 แถว ไม่ว่ากี่ code (ไม่มี raw token — code ไม่ลับอยู่แล้ว · client derive รายการเอง)
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const locked = await requireManagerUnlock(req, userId);
  if (locked) return locked;

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = manualRangeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", data: { issues: parsed.error.issues.slice(0, 3) } }, { status: 400 });
  }
  try {
    const range = await createManualRange(userId, id, parsed.data);
    return NextResponse.json({ data: { range } }, { status: 201 });
  } catch (err) {
    return voucherRouteError(err, "manual-ranges.create");
  }
}
