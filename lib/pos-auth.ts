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

export async function getPosSessionUser(userId: string): Promise<{
  id: string;
  shopName: string;
} | null> {
  const user = await findUserById(userId);
  if (!user) return null;
  return { id: user.id, shopName: user.shopName };
}
