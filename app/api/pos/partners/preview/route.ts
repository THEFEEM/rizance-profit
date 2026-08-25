import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PartnerInactiveError,
  PartnerNotFoundError,
  previewPartnerBenefit,
} from "@/lib/pos-partner-queries";
import { z } from "zod";

/**
 * POST /api/pos/partners/preview — คำนวณให้ดูก่อนกดเก็บเงิน
 *
 * ใช้เส้นทางคำนวณเดียวกับตอนปิดบิลเป๊ะ — ตัวเลขที่เห็นบนจอ
 * จึงเป็นตัวเลขเดียวกับที่จะถูกบันทึกจริง
 *
 * client ส่งได้แค่ partnerId + รายการสินค้า/จำนวน
 * ราคาและต้นทุนอ่านจาก DB ทั้งหมด
 */

const bodySchema = z.object({
  partnerId: z.string().uuid(),
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive().max(999) }))
    .min(1)
    .max(100),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const preview = await previewPartnerBenefit(
      userId,
      parsed.data.partnerId,
      parsed.data.items,
    );
    return NextResponse.json({ data: preview });
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      return NextResponse.json({ error: "partner_not_found" }, { status: 404 });
    }
    if (err instanceof PartnerInactiveError) {
      return NextResponse.json({ error: "partner_inactive" }, { status: 409 });
    }
    throw err;
  }
}
