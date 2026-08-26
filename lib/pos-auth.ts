import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isPosPlanAllowed } from "@/lib/pos-config";
import { findUserById } from "@/lib/queries";
import { getUserId } from "@/lib/session";
import { resolveActivePlan } from "@/lib/subscription-plan";

export function posUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function posPlanRequiredResponse(): NextResponse {
  return NextResponse.json({ error: "pos_plan_required" }, { status: 403 });
}

export function posNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export function posErrorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function requirePosSession(req: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserId(req);
  if (!userId) return posUnauthorizedResponse();
  return userId;
}

export async function isUserPosAllowed(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{
    subscription_plan: string;
    subscription_expires_at: Date | string | null;
  }>(
    `SELECT subscription_plan, subscription_expires_at FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return false;
  const plan = resolveActivePlan(row.subscription_plan, row.subscription_expires_at);
  return isPosPlanAllowed(plan);
}

export async function requirePosSessionAndPlan(
  req: NextRequest,
): Promise<string | NextResponse> {
  const userId = await requirePosSession(req);
  if (userId instanceof NextResponse) return userId;
  const allowed = await isUserPosAllowed(userId);
  if (!allowed) return posPlanRequiredResponse();
  return userId;
}

/**
 * ต้องปลดล็อกโหมดผู้จัดการก่อน (0087)
 *
 * ═══ ใช้กับอะไร ═══════════════════════════════════════════════
 * เฉพาะ endpoint ใหม่ที่อ่อนไหวจริง — เปลี่ยนรหัส · จัดการหุ้นส่วน ·
 * แก้นโยบายสิทธิ์หุ้นส่วน
 *
 * ⚠️ ไม่ได้แทน requirePosSessionAndPlan — ต้องเรียกคู่กันเสมอ
 *    คุกกี้ผู้จัดการเป็น "ชั้นเพิ่ม" ไม่ใช่ตัวยืนยันตัวตนของร้าน
 *
 * ⚠️ restricted API เดิมทั้งหมดคงนโยบายเดิมไว้โดยตั้งใจ (รักษา compatibility)
 *    การเปลี่ยนทั้งระบบพร้อมกันเสี่ยงทำของที่ใช้อยู่พัง
 *
 * ตรวจ 2 ชั้น: ลายเซ็น+อายุของคุกกี้ และเวอร์ชันของรหัสปัจจุบัน
 * เปลี่ยนรหัสเมื่อไร คุกกี้เก่าตายทันทีทุกเครื่อง
 */
export async function requireManagerUnlock(
  req: NextRequest,
  userId: string,
): Promise<null | NextResponse> {
  const { MANAGER_COOKIE, verifyManagerUnlock } = await import("@/lib/manager-unlock");
  const { currentPinVersion } = await import("@/lib/manager-pin-queries");

  const unlock = await verifyManagerUnlock(req.cookies.get(MANAGER_COOKIE)?.value);
  if (!unlock || unlock.userId !== userId) {
    return posErrorResponse("manager_locked", 403);
  }
  const version = await currentPinVersion(userId);
  if (version === null || version !== unlock.version) {
    return posErrorResponse("manager_locked", 403);
  }
  return null;
}

export async function getPosSessionUser(userId: string): Promise<{
  id: string;
  shopName: string;
} | null> {
  const user = await findUserById(userId);
  if (!user) return null;
  return { id: user.id, shopName: user.shopName };
}
