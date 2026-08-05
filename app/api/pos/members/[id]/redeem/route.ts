import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";

/**
 * ⛔ เลิกใช้แล้ว (0070)
 *
 * เดิม endpoint นี้ตัดแต้มได้ตามใจโดยระบุจำนวนเอง — ซึ่งข้ามตัวลูกค้าไปเลย
 * ตอนนี้การแลกแต้มต้องผ่าน "โค้ดใช้ครั้งเดียวจากบัตรลูกค้า" ที่ POS สแกน:
 *   POST /api/pos/members/redeem-code  { code }
 *
 * คงไฟล์ไว้เพื่อตอบ 410 ให้ชัด ไม่ใช่ 404 ที่ทำให้เข้าใจผิดว่าพิมพ์ path ผิด
 * ลบโฟลเดอร์นี้ได้เมื่อมั่นใจว่าไม่มี client เก่าเรียกอยู่
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return posErrorResponse("redeem_requires_customer_code", 410);
}
