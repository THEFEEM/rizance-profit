import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { partnerReport } from "@/lib/pos-partner-queries";
import { z } from "zod";

/**
 * GET /api/pos/partners/report?from=&to= — รายงานการใช้สิทธิ์หุ้นส่วน
 *
 * อ่านจาก snapshot บนบิลเท่านั้น ไม่คำนวณใหม่
 * บิลที่ถูกยกเลิกไม่ถูกนับ (กรองด้วย status='paid' ตามนิยามยอดขายเดิม)
 *
 * รายงานนี้เปิดเผยต้นทุนและกำไร → ต้องอยู่ในโหมดผู้จัดการ
 * (หน้าเก็บเงินไม่ได้ใช้ endpoint นี้ ใช้ /preview ซึ่งไม่บอกต้นทุน)
 */

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partnerId: z.string().uuid().nullish(),
});

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    partnerId: searchParams.get("partnerId") || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (parsed.data.from > parsed.data.to) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  return NextResponse.json({
    data: await partnerReport(
      userId,
      parsed.data.from,
      parsed.data.to,
      parsed.data.partnerId ?? null,
    ),
  });
}
