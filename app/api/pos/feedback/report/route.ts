import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  getPosFeedbackReport,
  listPosFeedback,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/pos-feedback-queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/pos/feedback/report?from=&to=&kind=&status=&limit=
 *
 * คืน report + รายการในครั้งเดียว — ร้านเปิดจากมือถือ ยิงรอบเดียวจบดีกว่าสองรอบ
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const sp = req.nextUrl.searchParams;
  const from = DATE_RE.test(sp.get("from") ?? "") ? sp.get("from")! : undefined;
  const to = DATE_RE.test(sp.get("to") ?? "") ? sp.get("to")! : undefined;

  const kindParam = sp.get("kind");
  const kind = FEEDBACK_KINDS.includes(kindParam as FeedbackKind)
    ? (kindParam as FeedbackKind)
    : undefined;

  const statusParam = sp.get("status");
  const status = FEEDBACK_STATUSES.includes(statusParam as FeedbackStatus)
    ? (statusParam as FeedbackStatus)
    : undefined;

  const limitRaw = Number(sp.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

  // report ไม่กรองตาม kind/status โดยเจตนา — คะแนนเฉลี่ยต้องเป็นภาพรวมเสมอ
  // ไม่งั้นกดกรอง "แจ้งปัญหา" แล้วเห็น "เฉลี่ย 2.1" จะเข้าใจผิดว่าร้านแย่
  const [report, items] = await Promise.all([
    getPosFeedbackReport(userId, { from, to }),
    listPosFeedback(userId, { from, to, kind, status, limit }),
  ]);

  return NextResponse.json({ data: { report, items } });
}
