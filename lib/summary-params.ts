import { currentMonth, isValidDate, isValidMonth, today } from "@/lib/date";

export type ShopSummaryMode = "daily" | "monthly";

export function parseShopSummaryParams(params: {
  mode?: string;
  month?: string;
  date?: string;
}): { mode: ShopSummaryMode; date: string; month: string } {
  const mode: ShopSummaryMode = params.mode === "daily" ? "daily" : "monthly";
  const date = params.date && isValidDate(params.date) ? params.date : today();
  const month =
    params.month && isValidMonth(params.month)
      ? params.month
      : mode === "daily"
        ? date.slice(0, 7)
        : currentMonth();
  return { mode, date, month };
}

export const SHOP_SUMMARY_LABELS = {
  income: "รายรับ",
  expense: "รายจ่าย",
  profit: "กำไร",
} as const;
