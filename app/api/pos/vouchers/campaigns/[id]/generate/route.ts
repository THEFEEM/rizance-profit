import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { generateVouchersSchema } from "@/lib/pos-voucher-schema";
import { generateVouchers } from "@/lib/pos-voucher-queries";
import { getPublicPosAppUrl } from "@/lib/env";
import { UUID_RE, notFound, readJson, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

/**
 * POST /api/pos/vouchers/campaigns/:id/generate  { quantity }
 *
 * ออกใบ = ออก "เงิน" → ต้อง manager unlock เหมือน endpoint ที่แตะเงินอื่น ๆ
 * ⚠️ response นี้เป็นครั้งเดียวที่ raw token ออกจาก server — client ต้องเก็บ/ดาวน์โหลดทันที
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const locked = await requireManagerUnlock(req, userId);
  if (locked) return locked;

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = generateVouchersSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const result = await generateVouchers(userId, id, parsed.data.quantity, getPublicPosAppUrl(), {
      name: parsed.data.batchName ?? null,
      distributionSource: parsed.data.distributionSource ?? null,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return voucherRouteError(err, "generate");
  }
}
