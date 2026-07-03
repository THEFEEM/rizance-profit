import {
  boothCreditorsWithTableRepayments,
} from "@/lib/advance-creditors";
import { computeBoothCashOnHand } from "@/lib/booth-cash-on-hand";
import { listBoothRepaymentsByCreditor } from "@/lib/booth-creditor-repayment-queries";
import { listBoothAdvances } from "@/lib/booth-queries";
import { BoothCreditorsCard } from "@/components/booth/summary/BoothCreditorsCardClient";
import type { PayerKind } from "@/types";

export async function BoothCreditorsCardSection({
  userId,
  boothId,
  currency = "THB",
}: {
  userId: string;
  boothId: string;
  currency?: string;
}) {
  const advances = await listBoothAdvances(userId, boothId);
  if (advances.length === 0) return null;

  const [repayments, cashOnHand] = await Promise.all([
    listBoothRepaymentsByCreditor(userId, boothId),
    computeBoothCashOnHand(userId, boothId),
  ]);

  const rows = boothCreditorsWithTableRepayments(
    advances.map((a) => ({
      creditorName: a.creditorName,
      amount: a.amount,
      isExternal: a.isExternal,
    })),
    repayments,
  ).map((row) => ({
    ...row,
    payerKind: (row.isExternal ? "external" : "member") as PayerKind,
  }));

  return (
    <BoothCreditorsCard
      boothId={boothId}
      rows={rows}
      cashOnHand={cashOnHand}
      currency={currency}
    />
  );
}
