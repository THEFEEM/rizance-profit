import Link from "next/link";
import type { ShopSummaryMode } from "@/lib/summary-params";

export function SummaryModeToggle({
  mode,
  date,
  month,
}: {
  mode: ShopSummaryMode;
  date: string;
  month: string;
}) {
  const dailyHref = `/summary/monthly?mode=daily&date=${date}`;
  const monthlyHref = `/summary/monthly?mode=monthly&month=${month}`;

  if (mode === "daily") {
    return (
      <Link href={monthlyHref} className="text-sm font-medium text-rz-green active:opacity-90">
        รายเดือน →
      </Link>
    );
  }

  return (
    <Link href={dailyHref} className="text-sm font-medium text-rz-green active:opacity-90">
      รายวัน →
    </Link>
  );
}
