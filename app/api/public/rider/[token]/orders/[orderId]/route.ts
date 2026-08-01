import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PosOrderNotFoundError,
  PosOrderTransitionError,
} from "@/lib/pos-order-queries";
import {
  PosOrderLinkFailedError,
  PosPaymentMismatchError,
  PosProductNotFoundError,
} from "@/lib/pos-close-bill-queries";
import {
  RiderJobTakenError,
  claimRiderJob,
  deliverRiderJob,
  getRiderByToken,
  releaseRiderJob,
} from "@/lib/pos-rider-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const actionSchema = z.object({
  action: z.enum(["claim", "release", "deliver"]),
});

/**
 * POST /api/public/rider/:token/orders/:orderId
 *   claim   → จองงานนี้เป็นของฉัน (คนแรกที่กดได้ไป)
 *   release → ปล่อยคืนกอง
 *   deliver → ส่งถึงแล้ว → ปิดบิลจริง (closePosBill) + completed
 *
 * ขอบเขต token: เฉพาะออเดอร์ order_type='delivery' ของร้านตัวเองเท่านั้น
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> },
) {
  const { token, orderId } = await params;
  if (!UUID_RE.test(token) || !UUID_RE.test(orderId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rider = await getRiderByToken(token);
  if (!rider) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    if (parsed.data.action === "claim") {
      await claimRiderJob(rider, orderId);
      return NextResponse.json({ data: { claimed: true } });
    }
    if (parsed.data.action === "release") {
      await releaseRiderJob(rider, orderId);
      return NextResponse.json({ data: { released: true } });
    }
    const result = await deliverRiderJob(rider, orderId);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof RiderJobTakenError) {
      return NextResponse.json(
        { error: "job_taken", riderName: err.riderName },
        { status: 409 },
      );
    }
    if (err instanceof PosOrderNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof PosOrderTransitionError) {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (err instanceof PosProductNotFoundError) {
      return NextResponse.json({ error: "invalid_product" }, { status: 400 });
    }
    if (err instanceof PosPaymentMismatchError) {
      return NextResponse.json({ error: "payment_mismatch" }, { status: 400 });
    }
    // ผูกบิลเข้าออเดอร์ไม่ได้ (ออเดอร์ถูกยกเลิก/มีบิลแล้ว) → ทั้งบิล rollback
    if (err instanceof PosOrderLinkFailedError) {
      return NextResponse.json({ error: "order_link_failed" }, { status: 409 });
    }
    throw err;
  }
}
