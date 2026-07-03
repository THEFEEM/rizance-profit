import { query } from "@/lib/db";
import { isUndefinedColumnError } from "@/lib/db-migration-guard";
import { listRepaymentsByCreditor } from "@/lib/creditor-repayment-queries";
import {
  centsToDecimalString,
  computeProfit,
  sumDecimals,
  toCents,
} from "@/lib/money";
import type { CreditorWithRepayment } from "@/types/shop";
import type { PayerKind } from "@/types";

export type { CreditorWithRepayment };

export type AdvanceCreditorRow = {
  name: string;
  amount: string;
  count?: number;
  payerKind?: PayerKind;
};

export type BoothCreditorRow = {
  name: string;
  owed: string;
  paid: string;
  remaining: string;
  isExternal: boolean;
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

/** Booth creditors with owed/paid/remaining — keeps fully-paid rows for history. */
export function boothCreditorsWithRepayment(
  advances: { creditorName: string; amount: string; isExternal: boolean }[],
  repayments: { name: string; amount: string }[],
): BoothCreditorRow[] {
  const owedMap = new Map<string, { cents: number; isExternal: boolean }>();

  for (const a of advances) {
    const name = a.creditorName.trim() || "ไม่ระบุ";
    const prev = owedMap.get(name);
    owedMap.set(name, {
      cents: (prev?.cents ?? 0) + toCents(a.amount),
      isExternal: a.isExternal,
    });
  }

  const paidMap = new Map<string, number>();
  for (const r of repayments) {
    const name = r.name.trim() || "ไม่ระบุ";
    paidMap.set(name, (paidMap.get(name) ?? 0) + toCents(r.amount));
  }

  return [...owedMap.entries()]
    .map(([name, { cents: owedCents, isExternal }]) => {
      const paidCents = Math.min(paidMap.get(name) ?? 0, owedCents);
      const remainingCents = owedCents - paidCents;
      return {
        name,
        owed: centsToDecimalString(owedCents),
        paid: centsToDecimalString(paidCents),
        remaining: centsToDecimalString(remainingCents),
        isExternal,
      };
    })
    .sort((a, b) => toCents(b.remaining) - toCents(a.remaining));
}

export function mergeCreditorsWithRepayments(
  advances: AdvanceCreditorRow[],
  repayments: { payerKind: string; name: string; repaid: string }[],
): CreditorWithRepayment[] {
  const repaidMap = new Map<string, string>();
  for (const r of repayments) {
    repaidMap.set(`${r.payerKind}:${r.name}`, r.repaid);
  }
  return advances.map((a) => {
    const payerKind = a.payerKind ?? "external";
    const repaid = repaidMap.get(`${payerKind}:${a.name}`) ?? "0.00";
    const remaining = computeProfit(a.amount, repaid);
    return {
      name: a.name,
      payerKind,
      owed: a.amount,
      repaid,
      remaining: toCents(remaining) < 0 ? "0.00" : remaining,
      count: a.count ?? 0,
    };
  });
}

export async function listCreditorsWithRepayments(
  userId: string,
): Promise<CreditorWithRepayment[]> {
  const [advances, repayments] = await Promise.all([
    listShopAdvanceCreditors(userId),
    listRepaymentsByCreditor(userId),
  ]);
  return mergeCreditorsWithRepayments(advances, repayments);
}

export function creditorsRemainingTotal(rows: CreditorWithRepayment[]): string {
  return sumDecimals(...rows.map((r) => r.remaining), "0.00");
}

export async function getShopCreditorOwed(
  userId: string,
  payerKind: PayerKind,
  payerName: string,
): Promise<string | null> {
  const advances = await listShopAdvanceCreditors(userId);
  const row = advances.find(
    (a) => (a.payerKind ?? "external") === payerKind && a.name === payerName,
  );
  return row?.amount ?? null;
}

export async function getBoothCreditorOwed(
  userId: string,
  boothId: string,
  payerKind: PayerKind,
  payerName: string,
): Promise<string | null> {
  const { listBoothAdvances } = await import("@/lib/booth-queries");
  const advances = await listBoothAdvances(userId, boothId);
  let totalCents = 0;
  for (const a of advances) {
    const kind = a.isExternal ? "external" : "member";
    if (kind === payerKind && a.creditorName === payerName) {
      totalCents += toCents(a.amount);
    }
  }
  return totalCents > 0 ? centsToDecimalString(totalCents) : null;
}

export function boothCreditorsWithTableRepayments(
  advances: { creditorName: string; amount: string; isExternal: boolean }[],
  repayments: { payerKind: string; name: string; repaid: string }[],
): BoothCreditorRow[] {
  const repaidForRow = repayments.map((r) => ({
    name: r.name,
    amount: r.repaid,
  }));
  return boothCreditorsWithRepayment(advances, repaidForRow);
}

export function creditorsByKind(
  rows: CreditorWithRepayment[],
  kind: PayerKind,
): CreditorWithRepayment[] {
  return rows.filter((r) => r.payerKind === kind);
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
