import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { createRider, listRiders, listRiderCashHoldings } from "@/lib/pos-rider-queries";
import { riderCreateSchema } from "@/lib/pos-validation";

/** GET /api/pos/riders — ทะเบียนคนส่ง + ยอดเงินสดที่ยังค้างอยู่กับแต่ละคน */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const [riders, cashHoldings] = await Promise.all([
    listRiders(userId),
    listRiderCashHoldings(userId),
  ]);
  return NextResponse.json({ data: { riders, cashHoldings } });
}

/** POST /api/pos/riders — เพิ่มคนส่ง (ได้ access_token ลิงก์ส่วนตัวกลับไปเลย) */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = riderCreateSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  const rider = await createRider(userId, parsed.data);
  return NextResponse.json({ data: rider }, { status: 201 });
}
