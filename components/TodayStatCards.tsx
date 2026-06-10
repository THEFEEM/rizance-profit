import { formatMoney } from "@/lib/money";

/** Display-only today income/expense cards — not interactive. */
export function TodayStatCards({
  income,
  expense,
  currency = "THB",
}: {
  income: string;
  expense: string;
  currency?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4">
      <div className="flex h-20 flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white">
        <p className="text-sm font-medium">รายรับวันนี้</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums">{formatMoney(income, currency)}</p>
      </div>
      <div className="flex h-20 flex-col items-center justify-center rounded-2xl bg-red-600 text-white">
        <p className="text-sm font-medium">รายจ่ายวันนี้</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums">{formatMoney(expense, currency)}</p>
      </div>
    </div>
  );
}
