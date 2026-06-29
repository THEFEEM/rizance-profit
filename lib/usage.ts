import { query } from "@/lib/db";

export type CounterKey = "rizq_chat" | "scan_slip" | "scan_receipt";

export type PlanLimits = {
  rizqChat: number;
  scanSlip: number;
  scanReceipt: number;
  receiptSplit: boolean;
  historyDays: number;
};

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function incrementUsage(userId: string, key: CounterKey): Promise<number> {
  const period = getCurrentPeriod();
  const { rows } = await query<{ count: number }>(
    `INSERT INTO usage_counters (user_id, counter_key, period, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id, counter_key, period)
     DO UPDATE SET count = usage_counters.count + 1
     RETURNING count`,
    [userId, key, period],
  );
  return rows[0]?.count ?? 1;
}

export async function getUsage(userId: string, key: CounterKey): Promise<number> {
  const period = getCurrentPeriod();
  const { rows } = await query<{ count: number }>(
    `SELECT count FROM usage_counters
     WHERE user_id = $1 AND counter_key = $2 AND period = $3`,
    [userId, key, period],
  );
  return rows[0]?.count ?? 0;
}

export function getPlanLimits(plan: string): PlanLimits {
  switch (plan) {
    case "event_pass":
      return {
        rizqChat: 200,
        scanSlip: -1,
        scanReceipt: -1,
        receiptSplit: true,
        historyDays: -1,
      };
    case "business":
      return {
        rizqChat: 200,
        scanSlip: -1,
        scanReceipt: -1,
        receiptSplit: true,
        historyDays: -1,
      };
    case "personal_plus":
      return {
        rizqChat: 100,
        scanSlip: 100,
        scanReceipt: 100,
        receiptSplit: true,
        historyDays: -1,
      };
    default:
      return {
        rizqChat: 30,
        scanSlip: 30,
        scanReceipt: 30,
        receiptSplit: false,
        historyDays: 7,
      };
  }
}
