import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  addOrderMessage,
  listOrderMessages,
  orderVisibleToRider,
} from "@/lib/pos-chat-queries";
import { ChatImageError, uploadChatImage } from "@/lib/pos-chat-image";
import { getRiderByToken } from "@/lib/pos-rider-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const textSchema = z.object({
  body: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(500),
  ),
});

/** GET /api/public/rider/:token/orders/:orderId/messages — แชทฝั่งคนส่ง */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> },
) {
  const { token, orderId } = await params;
  if (!UUID_RE.test(token) || !UUID_RE.test(orderId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const rider = await getRiderByToken(token);
  if (!rider || !(await orderVisibleToRider(orderId, rider.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const messages = await listOrderMessages(orderId, after);
  return NextResponse.json({ data: { messages } });
}

/**
 * POST — คนส่งส่งข้อความ/รูป
 *   multipart: file + kind=proof → รูปหลักฐานการส่ง (โชว์กรอบพิเศษ)
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
  if (!rider || !(await orderVisibleToRider(orderId, rider.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file_required" }, { status: 400 });
      }
      const imageUrl = await uploadChatImage(orderId, file);
      const kind = form.get("kind") === "proof" ? ("proof" as const) : ("chat" as const);
      const caption = typeof form.get("body") === "string" ? String(form.get("body")) : undefined;
      const message = await addOrderMessage(orderId, {
        sender: "rider",
        riderId: rider.id,
        kind,
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
      sender: "rider",
      riderId: rider.id,
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
