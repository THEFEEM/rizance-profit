import { NextRequest, NextResponse } from "next/server";
import { staffCreateCorrection, staffListCorrections } from "@/lib/hr-ops-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

const createSchema = z
  .object({
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["missing_clock_out", "wrong_time", "other"]),
    requestedClockInAt: z.string().datetime({ offset: true }).nullish(),
    requestedClockOutAt: z.string().datetime({ offset: true }).nullish(),
    note: z.string().trim().max(255).nullish().transform((v) => v || null),
  })
  .refine(
    (v) => v.requestedClockInAt || v.requestedClockOutAt || v.note,
    { message: "empty_request" },
  );

function rateLimited(req: NextRequest): NextResponse | null {
  const retryAfter = authRateLimitExceeded(`hr_staff:${clientIp(req)}`);
  return retryAfter === null
    ? null
    : NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;
  const corrections = await staffListCorrections(token);
  if (!corrections) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { corrections } });
}

/** POST — แจ้งเวลาไม่ตรง (สร้างคำขอ · owner เป็นคนอนุมัติ) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { token } = await params;
  const correction = await staffCreateCorrection(token, parsed.data);
  if (!correction) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { correction } }, { status: 201 });
}
