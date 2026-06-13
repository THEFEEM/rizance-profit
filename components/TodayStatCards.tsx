import { formatMoney } from "@/lib/money";
import { ExpenseArrowIcon, IncomeArrowIcon } from "@/components/today/today-icons";

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
    <div className="grid grid-cols-2 gap-2.5 px-4 pt-3">
      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-3 py-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rz-green/15 text-rz-green">
            <IncomeArrowIcon />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-rz-hint">รายรับวันนี้</p>
            <p className="rz-tabular mt-0.5 text-[17px] font-medium text-rz-text">
              {formatMoney(income, currency)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-3 py-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rz-red/15 text-rz-red">
            <ExpenseArrowIcon />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-rz-hint">รายจ่ายวันนี้</p>
            <p className="rz-tabular mt-0.5 text-[17px] font-medium text-rz-text">
              {formatMoney(expense, currency)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
