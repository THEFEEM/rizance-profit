import {
  AdvanceCreditorsSection,
} from "@/components/shared/AdvanceCreditorsSection";
import {
  advanceCreditorsTotal,
  boothOutstandingCreditors,
} from "@/lib/advance-creditors";
import { listBoothAdvances } from "@/lib/booth-queries";
import type { SplitProfitResult } from "@/types/booth";

export async function BoothAdvanceCreditorsSection({
  userId,
  boothId,
  split,
  currency = "THB",
}: {
  userId: string;
  boothId: string;
  split: SplitProfitResult | null;
  currency?: string;
}) {
  const advances = await listBoothAdvances(userId, boothId);
  if (advances.length === 0) return null;

  const rows = boothOutstandingCreditors(
    advances.map((a) => ({ creditorName: a.creditorName, amount: a.amount })),
    (split?.advanceRepayments ?? []).map((r) => ({ name: r.name, amount: r.amount })),
  );

  return (
    <AdvanceCreditorsSection
      rows={rows}
      total={advanceCreditorsTotal(rows)}
      currency={currency}
    />
  );
}
