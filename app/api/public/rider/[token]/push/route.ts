import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { vapidPublicKey } from "@/lib/pos-push-queries";
import { getRiderByToken, saveRiderPushSub } from "@/lib/pos-rider-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(5).max(300),
  }),
});

/** GET — public VAPID key (null = ร้านยังไม่ได้ตั้งค่า push) */
export async function GET() {
  return NextResponse.json({ data: { publicKey: vapidPublicKey() } });
}

/** POST — บันทึก subscription ของมือถือคนส่ง เพื่อเตือนตอนมีงานใหม่ */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
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

  const parsed = subscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  await saveRiderPushSub(rider.id, parsed.data);
  return NextResponse.json({ data: { subscribed: true } }, { status: 201 });
}
