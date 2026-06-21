import { AdvanceCreditorsSection } from "@/components/shared/AdvanceCreditorsSection";
import { advanceCreditorsTotal } from "@/lib/advance-creditors";
import { toCents } from "@/lib/money";

export function ProjectAdvanceCreditorsSection({
  advanceByPayer,
  currency = "THB",
}: {
  advanceByPayer: { payerName: string; unreimbursed: string }[];
  currency?: string;
}) {
  const rows = advanceByPayer
    .filter((p) => toCents(p.unreimbursed) > 0)
    .map((p) => ({
      name: p.payerName,
      amount: p.unreimbursed,
    }));

  if (rows.length === 0) return null;

  return (
    <AdvanceCreditorsSection
      rows={rows}
      total={advanceCreditorsTotal(rows)}
      currency={currency}
    />
  );
}
