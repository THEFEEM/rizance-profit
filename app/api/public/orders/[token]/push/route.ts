import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { savePushSubscription, vapidPublicKey } from "@/lib/pos-push-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(5).max(300),
  }),
});

/** GET — public VAPID key ให้เบราว์เซอร์ใช้ subscribe (null = ร้านยังไม่ตั้งค่า push) */
export async function GET() {
  return NextResponse.json({ data: { publicKey: vapidPublicKey() } });
}

/** POST — บันทึก push subscription ของลูกค้าไว้กับออเดอร์นี้ */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

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

  const ok = await savePushSubscription(token, parsed.data);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ data: { subscribed: true } }, { status: 201 });
}
