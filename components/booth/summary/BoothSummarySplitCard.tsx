import { SplitProfitCard } from "@/components/shared/SplitProfitCard";
import type { SplitProfitResult } from "@/types/booth";

/** Booth summary split section — amber accent, booth empty hint. */
export function BoothSummarySplitCard({
  split,
  currency = "THB",
}: {
  split: SplitProfitResult;
  currency?: string;
}) {
  return (
    <SplitProfitCard
      split={split}
      currency={currency}
      accent="amber"
      emptyHint="ยังไม่มีผู้ลงทุน — เพิ่มสมาชิกตอนสร้างบูธใหม่"
    />
  );
}
