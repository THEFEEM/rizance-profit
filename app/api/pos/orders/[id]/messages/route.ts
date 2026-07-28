import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  addOrderMessage,
  listOrderMessages,
  orderBelongsToUser,
} from "@/lib/pos-chat-queries";
import { ChatImageError, uploadChatImage } from "@/lib/pos-chat-image";

const textSchema = z.object({
  body: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(500),
  ),
});

/** GET /api/pos/orders/:id/messages?after=<iso> — แชทฝั่งร้าน */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await orderBelongsToUser(id, userId))) {
    return posErrorResponse("order_not_found", 404);
  }

  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const messages = await listOrderMessages(id, after);
  return NextResponse.json({ data: { messages } });
}

/** POST /api/pos/orders/:id/messages — ร้านส่งข้อความ/รูป (JSON หรือ multipart) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await orderBelongsToUser(id, userId))) {
    return posErrorResponse("order_not_found", 404);
  }

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return posErrorResponse("file_required", 400);
      const imageUrl = await uploadChatImage(id, file);
      const caption = typeof form.get("body") === "string" ? String(form.get("body")) : undefined;
      const message = await addOrderMessage(id, { sender: "shop", body: caption, imageUrl });
      return NextResponse.json({ data: message }, { status: 201 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return posErrorResponse("invalid_json", 400);
    }
    const parsed = textSchema.safeParse(body);
    if (!parsed.success) return posErrorResponse("invalid_input", 400);

    const message = await addOrderMessage(id, { sender: "shop", body: parsed.data.body });
    return NextResponse.json({ data: message }, { status: 201 });
  } catch (err) {
    if (err instanceof ChatImageError) {
      return posErrorResponse(err.code, 400);
    }
    throw err;
  }
}
