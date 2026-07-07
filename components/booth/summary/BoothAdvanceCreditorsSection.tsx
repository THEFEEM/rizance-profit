import { AdvanceCreditorsSection } from "@/components/shared/AdvanceCreditorsSection";
import {
  advanceCreditorsTotal,
  boothOutstandingCreditors,
} from "@/lib/advance-creditors";
import { listBoothRepaymentsByCreditor } from "@/lib/booth-creditor-repayment-queries";
import { listBoothAdvances } from "@/lib/booth-queries";

export async function BoothAdvanceCreditorsSection({
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

  const repayments = await listBoothRepaymentsByCreditor(userId, boothId);
  const rows = boothOutstandingCreditors(
    advances.map((a) => ({ creditorName: a.creditorName, amount: a.amount })),
    repayments.map((r) => ({ name: r.name, amount: r.repaid })),
  );

  return (
    <AdvanceCreditorsSection
      rows={rows}
      total={advanceCreditorsTotal(rows)}
      currency={currency}
    />
  );
}
