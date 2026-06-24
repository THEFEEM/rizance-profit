import { query } from "@/lib/db";
import { isUndefinedColumnError } from "@/lib/db-migration-guard";
import { sumDecimals, toCents } from "@/lib/money";
import type { PayerKind } from "@/types";

export type AdvanceCreditorRow = {
  name: string;
  amount: string;
  count?: number;
  payerKind?: PayerKind;
};

/** Shop expense entries flagged as advance — grouped by payer_kind + payer_name. */
export async function listShopAdvanceCreditors(userId: string): Promise<AdvanceCreditorRow[]> {
  try {
    const { rows } = await query<{
      name: string;
      payer_kind: string;
      amount: string;
      count: string;
    }>(
      `SELECT COALESCE(NULLIF(btrim(payer_name), ''), 'ไม่ระบุ') AS name,
              COALESCE(payer_kind, 'external') AS payer_kind,
              COALESCE(SUM(amount), 0)::text AS amount,
              COUNT(*)::text AS count
       FROM expense_entries
       WHERE user_id = $1 AND is_advance = true
       GROUP BY payer_kind, COALESCE(NULLIF(btrim(payer_name), ''), 'ไม่ระบุ')
       HAVING COALESCE(SUM(amount), 0) > 0
       ORDER BY payer_kind, SUM(amount) DESC`,
      [userId],
    );
    return rows.map((r) => ({
      name: r.name,
      amount: r.amount,
      count: Number(r.count),
      payerKind: r.payer_kind === "member" ? "member" : "external",
    }));
  } catch (err) {
    if (isUndefinedColumnError(err)) return [];
    throw err;
  }
}

export function advanceCreditorsTotal(rows: AdvanceCreditorRow[]): string {
  return sumDecimals(...rows.map((r) => r.amount), "0.00");
}

export function advanceCreditorsByKind(
  rows: AdvanceCreditorRow[],
  kind: PayerKind,
): AdvanceCreditorRow[] {
  return rows.filter((r) => (r.payerKind ?? "external") === kind);
}

export function boothOutstandingCreditors(
  advances: { creditorName: string; amount: string }[],
  repayments: { name: string; amount: string }[],
): AdvanceCreditorRow[] {
  const owed = new Map<string, number>();

  for (const a of advances) {
    const name = a.creditorName.trim() || "ไม่ระบุ";
    owed.set(name, (owed.get(name) ?? 0) + toCents(a.amount));
  }
  for (const r of repayments) {
    const name = r.name.trim() || "ไม่ระบุ";
    owed.set(name, (owed.get(name) ?? 0) - toCents(r.amount));
  }

  return [...owed.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([name, cents]) => ({
      name,
      amount: (cents / 100).toFixed(2),
    }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

export function savingsRateFromGoals(
  goals: { currentAmount: string; targetAmount: string }[],
): number {
  let currentCents = 0;
  let targetCents = 0;
  for (const g of goals) {
    currentCents += toCents(g.currentAmount);
    targetCents += toCents(g.targetAmount);
  }
  if (targetCents <= 0) return 0;
  return Math.min(100, Math.round((currentCents / targetCents) * 100));
}
