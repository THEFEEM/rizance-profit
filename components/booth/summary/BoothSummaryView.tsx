import { BoothSummaryBudgetCard } from "@/components/booth/summary/BoothSummaryBudgetCard";
import { BoothSummaryEmployeeCards } from "@/components/booth/summary/BoothSummaryEmployeeCards";
import { BoothSummaryHeader } from "@/components/booth/summary/BoothSummaryHeader";
import { BoothSummaryLegend } from "@/components/booth/summary/BoothSummaryLegend";
import { BoothSummaryNetCard } from "@/components/booth/summary/BoothSummaryNetCard";
import { BoothSummaryPLCard } from "@/components/booth/summary/BoothSummaryPLCard";
import { BoothSummarySplitCard } from "@/components/booth/summary/BoothSummarySplitCard";
import type { BoothSummary, SplitProfitResult } from "@/types/booth";

/** Full booth summary page layout — presentation only, spec §1 order. */
export function BoothSummaryView({
  boothId,
  summary,
  split,
  currency = "THB",
}: {
  boothId: string;
  summary: BoothSummary;
  split: SplitProfitResult | null;
  currency?: string;
}) {
  const closed = summary.booth.status === "closed";

  return (
    <div className="pb-6">
      <BoothSummaryHeader
        booth={summary.booth}
        boothId={boothId}
        split={split}
        closed={closed}
      />
      <BoothSummaryBudgetCard summary={summary} currency={currency} />
      <BoothSummaryPLCard summary={summary} currency={currency} />
      {split ? (
        <>
          <BoothSummarySplitCard split={split} currency={currency} />
          <BoothSummaryEmployeeCards split={split} currency={currency} />
          <BoothSummaryLegend />
          <BoothSummaryNetCard split={split} currency={currency} />
        </>
      ) : (
        <p className="mt-6 px-4 pb-8 text-center text-sm text-rz-hint">
          ไม่สามารถคำนวณการแบ่งกำไรได้
        </p>
      )}
    </div>
  );
}
