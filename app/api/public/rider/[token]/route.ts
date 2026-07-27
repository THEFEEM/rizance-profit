import { NextRequest, NextResponse } from "next/server";
import { getRiderBoard, getRiderByToken } from "@/lib/pos-rider-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/public/rider/:token — กระดานงานของคนส่ง
 * token = pos_riders.access_token (ลิงก์ส่วนตัว · ไม่มี session)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rider = await getRiderByToken(token);
  if (!rider) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const board = await getRiderBoard(rider);
  return NextResponse.json({ data: board });
}
