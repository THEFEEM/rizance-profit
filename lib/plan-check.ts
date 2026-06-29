/** @deprecated Use checkAndDeductTokens from lib/token-budget.ts instead. */
import { getPlanLimits, getUsage, incrementUsage } from "@/lib/usage";

export type PlanCheckResult =
  | { allowed: true; remaining: number }
  | { allowed: false; limit: number; used: number; upgradeMessage: string };

export async function checkAndIncrement(
  userId: string,
  plan: string,
  key: "rizq_chat" | "scan_slip" | "scan_receipt",
): Promise<PlanCheckResult> {
  const limits = getPlanLimits(plan);
  const limitMap = {
    rizq_chat: limits.rizqChat,
    scan_slip: limits.scanSlip,
    scan_receipt: limits.scanReceipt,
  };

  const limit = limitMap[key];
  if (limit === -1) {
    await incrementUsage(userId, key);
    return { allowed: true, remaining: -1 };
  }

  const used = await getUsage(userId, key);
  if (used >= limit) {
    return {
      allowed: false,
      limit,
      used,
      upgradeMessage: `คุณใช้ครบ ${limit} ครั้งแล้ว อัพเกรดเพื่อใช้ต่อ`,
    };
  }

  const count = await incrementUsage(userId, key);
  return { allowed: true, remaining: limit - count };
}
