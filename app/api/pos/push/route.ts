import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { saveStaffPushSub, vapidPublicKey } from "@/lib/pos-push-queries";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(5).max(300),
  }),
});

/** GET /api/pos/push — VAPID public key (null = ยังไม่ตั้งค่า) */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({ data: { publicKey: vapidPublicKey() } });
}

/** POST — บันทึก subscription มือถือของพนักงาน (เด้งออเดอร์ใหม่ + แชทลูกค้า) */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = subscriptionSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  await saveStaffPushSub(userId, parsed.data);
  return NextResponse.json({ data: { subscribed: true } }, { status: 201 });
}
