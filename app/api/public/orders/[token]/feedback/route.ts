import { NextRequest, NextResponse } from "next/server";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";
import {
  FeedbackAlreadyExistsError,
  FeedbackNotAllowedYetError,
  FeedbackOrderNotFoundError,
  submitOrderFeedback,
} from "@/lib/pos-feedback-queries";
import { orderFeedbackSchema } from "@/lib/pos-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/public/orders/:accessToken/feedback — ลูกค้าให้คะแนนร้าน (ไม่ต้องล็อกอิน) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryIn = authRateLimitExceeded(`feedback:${clientIp(req)}`);
  if (retryIn !== null) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

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

  const parsed = orderFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const result = await submitOrderFeedback(token, parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof FeedbackOrderNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof FeedbackNotAllowedYetError) {
      return NextResponse.json({ error: "not_ready" }, { status: 409 });
    }
    if (err instanceof FeedbackAlreadyExistsError) {
      return NextResponse.json({ error: "feedback_exists" }, { status: 409 });
    }
    throw err;
  }
}
