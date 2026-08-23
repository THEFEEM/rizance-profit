import { NextRequest, NextResponse } from "next/server";
import { BreakStateError, staffBreak } from "@/lib/hr-ops-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/** POST /api/public/hr/:token/break {action: start|end} — บันทึกอย่างเดียว ไม่หักเงิน */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryAfter = authRateLimitExceeded(`hr_clock:${clientIp(req)}`);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = (body as { action?: string })?.action;
  if (action !== "start" && action !== "end") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { token } = await params;
  try {
    const result = await staffBreak(token, action);
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof BreakStateError) {
      return NextResponse.json({ error: "invalid_break_state" }, { status: 409 });
    }
    throw err;
  }
}
