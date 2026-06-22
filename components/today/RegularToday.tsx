import {
  monthToDateSummary,
  dailySummary,
  allTimeIncomeByCashTransfer,
  allTimeExpenseByCashTransfer,
  listIncomeByDate,
  listExpenseByDate,
} from "@/lib/queries";
import { today } from "@/lib/date";
import { computeProfit, sumDecimals } from "@/lib/money";
import { shopSplitProfit } from "@/lib/shop-split";
import { TodayBalanceCard } from "@/components/TodayBalanceCard";
import { TodayStatCards } from "@/components/TodayStatCards";
import { TodayCategoryMiniList } from "@/components/today/TodayCategoryMiniList";
import { EntryList, type EntryRow } from "@/components/EntryList";
import { SplitProfitCard } from "@/components/shared/SplitProfitCard";
import { ViewFullSummaryButton } from "@/components/shared/ViewFullSummaryButton";
import { buildTodayCategoryGroups } from "@/lib/today-category-groups";
import type { User } from "@/types";

/** Regular-shop Today — total sales hero + today's breakdown + partner split. */
export async function RegularToday({ user }: { user: User }) {
  const date = today();
  const [monthly, summary, incomes, expenses, incomeByMethod, expenseByMethod, split] =
    await Promise.all([
    monthToDateSummary(user.id),
    dailySummary(user.id, date),
    listIncomeByDate(user.id, date),
    listExpenseByDate(user.id, date),
    allTimeIncomeByCashTransfer(user.id),
    allTimeExpenseByCashTransfer(user.id),
    shopSplitProfit(user.id, date, date),
  ]);

  const cashOnHand = computeProfit(incomeByMethod.cashIncome, expenseByMethod.cashExpense);
  const transferOnHand = computeProfit(
    incomeByMethod.transferIncome,
    expenseByMethod.transferExpense,
  );
  const totalOnHand = sumDecimals(cashOnHand, transferOnHand);

  const entries: EntryRow[] = [
    ...incomes.map((i) => ({
      id: i.id,
      kind: "income" as const,
      amount: i.amount,
      note: i.note,
      category: i.category,
      createdAt: i.createdAt,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      kind: "expense" as const,
      amount: e.amount,
      note: e.note,
      category: e.category,
      createdAt: e.createdAt,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const categoryGroups = buildTodayCategoryGroups(entries);
  const hasEntries = entries.length > 0;

  return (
    <>
      <TodayBalanceCard
        totalSales={monthly.income}
        cumulativeProfit={monthly.profit}
        totalOnHand={totalOnHand}
        cashOnHand={cashOnHand}
        transferOnHand={transferOnHand}
        currency={user.currency}
        salesLabel="ยอดขายเดือนนี้"
        profitLabel="กำไรเดือนนี้"
      />

      <TodayStatCards
        income={summary.income}
        expense={summary.expense}
        currency={user.currency}
      />

      {split && (
        <SplitProfitCard
          split={split}
          currency={user.currency}
          accent="green"
          periodLabel="ทั้งหมด"
          variant="compact"
        />
      )}

      {hasEntries && (
        <TodayCategoryMiniList groups={categoryGroups} currency={user.currency} />
      )}

      <div className="mt-3 px-4">
        {hasEntries ? (
          <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
            <EntryList
              entries={entries}
              currency={user.currency}
              appearance="today"
              emptyHint="ยังไม่มีรายการวันนี้ — แตะ +In หรือ −Out เพื่อเริ่ม"
            />
          </div>
        ) : (
          <p className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-6 text-center text-[13px] text-rz-hint">
            ยังไม่มีรายการวันนี้ — แตะ +In หรือ −Out เพื่อเริ่ม
          </p>
        )}
      </div>

      <ViewFullSummaryButton href="/summary" accent="green" className="mt-4 pb-2" />
    </>
  );
}
