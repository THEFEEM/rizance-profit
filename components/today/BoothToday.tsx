import {
  boothSummary,
  listBoothExpense,
  listBoothIncome,
} from "@/lib/booth-queries";
import { computeProfit, sumDecimals } from "@/lib/money";
import { BoothTodayHeroCard } from "@/components/today/BoothTodayHeroCard";
import { BoothBudgetBar } from "@/components/today/BoothBudgetBar";
import { TodayStatCards } from "@/components/TodayStatCards";
import { BoothDayEntryList } from "@/components/BoothDayEntryList";
import { ViewFullSummaryButton } from "@/components/shared/ViewFullSummaryButton";
import type { Booth } from "@/types/booth";
import type { User } from "@/types";

/** Booth Today — event totals hero, budget bar, event entry list. */
export async function BoothToday({
  user,
  booth,
}: {
  user: User;
  booth: Booth;
  date: string;
}) {
  const [eventSummary, incomes, expenses] = await Promise.all([
    boothSummary(user.id, booth.id),
    listBoothIncome(user.id, booth.id),
    listBoothExpense(user.id, booth.id),
  ]);

  const event = eventSummary ?? {
    totalIncome: "0.00",
    totalExpense: "0.00",
    profit: "0.00",
  };

  const totalIncome = event.totalIncome;
  const totalExpense = event.totalExpense;
  const boothProfit = event.profit;
  const remainingBudget = computeProfit(booth.totalBudget, totalExpense);
  const cashInHand = sumDecimals(remainingBudget, totalIncome);

  const hasEntries = incomes.length + expenses.length > 0;

  return (
    <>
      <BoothTodayHeroCard
        totalSales={totalIncome}
        cashInHand={cashInHand}
        boothProfit={boothProfit}
        currency={user.currency}
      />

      <BoothBudgetBar
        totalBudget={booth.totalBudget}
        totalExpense={totalExpense}
        currency={user.currency}
      />

      <TodayStatCards
        income={totalIncome}
        expense={totalExpense}
        incomeLabel="รายรับรวมบูธ"
        expenseLabel="รายจ่ายรวมบูธ"
        currency={user.currency}
      />

      <div className="mt-3 px-4">
        {hasEntries ? (
          <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
            <BoothDayEntryList
              boothId={booth.id}
              incomes={incomes}
              expenses={expenses}
              currency={user.currency}
              appearance="today"
            />
          </div>
        ) : (
          <p className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-6 text-center text-[13px] text-rz-hint">
            ยังไม่มีรายการในงาน — แตะ +In หรือ −Out เพื่อเริ่ม
          </p>
        )}
      </div>

      <ViewFullSummaryButton href={`/booth/${booth.id}/summary`} accent="amber" className="mt-4 pb-2" />
    </>
  );
}
