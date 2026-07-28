import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";
import {
  addOrderMessage,
  listOrderMessages,
  orderIdByAccessToken,
} from "@/lib/pos-chat-queries";
import { ChatImageError, uploadChatImage } from "@/lib/pos-chat-image";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const textSchema = z.object({
  body: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(500),
  ),
});

/** GET /api/public/orders/:token/messages?after=<iso> — แชทฝั่งลูกค้า */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const orderId = await orderIdByAccessToken(token);
  if (!orderId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const messages = await listOrderMessages(orderId, after);
  return NextResponse.json({ data: { messages } });
}

/**
 * POST /api/public/orders/:token/messages — ลูกค้าส่งข้อความ/รูป
 *   JSON      { body }
 *   multipart file (+ body ได้)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryIn = authRateLimitExceeded(`chat:${clientIp(req)}`);
  if (retryIn !== null) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const orderId = await orderIdByAccessToken(token);
  if (!orderId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file_required" }, { status: 400 });
      }
      const imageUrl = await uploadChatImage(orderId, file);
      const caption = typeof form.get("body") === "string" ? String(form.get("body")) : undefined;
      const message = await addOrderMessage(orderId, {
        sender: "customer",
        body: caption,
        imageUrl,
      });
      return NextResponse.json({ data: message }, { status: 201 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const parsed = textSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const message = await addOrderMessage(orderId, {
      sender: "customer",
      body: parsed.data.body,
    });
    return NextResponse.json({ data: message }, { status: 201 });
  } catch (err) {
    if (err instanceof ChatImageError) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    throw err;
  }
}
