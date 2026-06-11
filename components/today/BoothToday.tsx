import Link from "next/link";
import {
  boothDaySummary,
  boothSummary,
  listBoothExpenseByDate,
  listBoothIncomeByDate,
} from "@/lib/booth-queries";
import { ProfitCard } from "@/components/ProfitCard";
import { BoothBudgetBar } from "@/components/today/BoothBudgetBar";
import { BoothDayEntryList } from "@/components/BoothDayEntryList";
import type { Booth } from "@/types/booth";
import type { User } from "@/types";

export async function BoothToday({
  user,
  booth,
  date,
}: {
  user: User;
  booth: Booth;
  date: string;
}) {
  const [summary, incomes, expenses, eventSummary] = await Promise.all([
    boothDaySummary(user.id, booth.id, date),
    listBoothIncomeByDate(user.id, booth.id, date),
    listBoothExpenseByDate(user.id, booth.id, date),
    boothSummary(user.id, booth.id),
  ]);

  const day = summary ?? { income: "0.00", expense: "0.00", profit: "0.00" };

  return (
    <>
      <BoothBudgetBar
        startingBudget={booth.startingBudget}
        totalExpense={eventSummary?.totalExpense ?? "0.00"}
        currency={user.currency}
      />

      <ProfitCard
        profit={day.profit}
        income={day.income}
        expense={day.expense}
        currency={user.currency}
        label="TODAY'S PROFIT"
        subtitle={booth.name}
      />

      <div className="grid grid-cols-2 gap-3 px-4">
        <Link
          href={`/booth/${booth.id}/income`}
          className="tap-target flex h-20 items-center justify-center rounded-2xl bg-emerald-600 text-lg font-bold text-white active:bg-emerald-700"
        >
          + INCOME
        </Link>
        <Link
          href={`/booth/${booth.id}/expense`}
          className="tap-target flex h-20 items-center justify-center rounded-2xl bg-red-600 text-lg font-bold text-white active:bg-red-700"
        >
          − EXPENSE
        </Link>
      </div>

      <div className="mt-6">
        <h2 className="px-4 pb-1 text-sm font-semibold text-slate-500">Recent today</h2>
        <div className="mx-2 overflow-hidden rounded-2xl bg-white shadow-sm">
          <BoothDayEntryList
            boothId={booth.id}
            incomes={incomes}
            expenses={expenses}
            currency={user.currency}
          />
        </div>
      </div>
    </>
  );
}
