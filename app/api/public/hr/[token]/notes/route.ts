import { NextRequest, NextResponse } from "next/server";
import { staffMyReports, staffReportProblem } from "@/lib/store-note-queries";
import { staffRateLimitExceeded } from "@/lib/rate-limit";

/**
 * แจ้งปัญหาจากแอปพนักงาน — ตัวตนมาจาก token เท่านั้น
 *
 * GET  → "รายการที่ฉันแจ้ง" · คืนเฉพาะโน้ตที่ตัวเองเป็นผู้แจ้ง
 * POST → ส่งปัญหาใหม่ พร้อมชื่อพนักงานจริง
 *
 * ⚠️ ด่านความปลอดภัยอยู่ใน SQL ไม่ใช่ที่หน้าจอ:
 *    โน้ตของเจ้าของ (visibility='owner_manager') ไม่มีทางหลุดออกทางนี้
 *    เพราะ query กรองด้วย reported_by_employee_id = ตัวเอง
 *    และเพื่อนร่วมงานก็อ่านของกันไม่ได้ด้วยเหตุผลเดียวกัน
 *
 * token ที่หมดอายุ / ถูกยกเลิก / พนักงานลาออก → ไม่ผ่านตั้งแต่ employeeByToken
 */

function rateLimited(req: NextRequest): NextResponse | null {
  const retryAfter = staffRateLimitExceeded(req);
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
  const view = await staffMyReports(token);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: view });
}

const PRIORITIES = ["normal", "important", "urgent"] as const;

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
  const { title, detail, priority } = (body ?? {}) as {
    title?: string;
    detail?: string;
    priority?: string;
  };
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 160) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { token } = await params;
  const note = await staffReportProblem(token, {
    title,
    body: typeof detail === "string" ? detail.slice(0, 2000) : null,
    priority: (PRIORITIES as readonly string[]).includes(priority ?? "")
      ? (priority as (typeof PRIORITIES)[number])
      : "normal",
  });
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { note } }, { status: 201 });
}
