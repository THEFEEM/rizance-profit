import {
  allTimeSummary,
  dailySummary,
  listIncomeByDate,
  listExpenseByDate,
} from "@/lib/queries";
import { today } from "@/lib/date";
import { TodayBalanceCard } from "@/components/TodayBalanceCard";
import { TodayStatCards } from "@/components/TodayStatCards";
import { EntryList, type EntryRow } from "@/components/EntryList";
import type { User } from "@/types";

/** Regular-shop Today — cumulative hero + today's breakdown; booth mode unchanged. */
export async function RegularToday({ user }: { user: User }) {
  const date = today();
  const [allTime, summary, incomes, expenses] = await Promise.all([
    allTimeSummary(user.id),
    dailySummary(user.id, date),
    listIncomeByDate(user.id, date),
    listExpenseByDate(user.id, date),
  ]);

  const entries: EntryRow[] = [
    ...incomes.map((i) => ({
      id: i.id,
      kind: "income" as const,
      amount: i.amount,
      note: i.note,
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

  return (
    <>
      <TodayBalanceCard
        cumulativeProfit={allTime.profit}
        todayProfit={summary.profit}
        currency={user.currency}
      />

      <TodayStatCards
        income={summary.income}
        expense={summary.expense}
        currency={user.currency}
      />

      <div className="mt-6">
        <h2 className="px-4 pb-1 text-sm font-semibold text-slate-500">Recent today</h2>
        <div className="mx-2 overflow-hidden rounded-2xl bg-white shadow-sm">
          <EntryList
            entries={entries}
            currency={user.currency}
            emptyHint="No entries today — tap +In or −Out in the nav to start."
          />
        </div>
      </div>
    </>
  );
}
