import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { dailySummary, listIncomeByDate, listExpenseByDate } from "@/lib/queries";
import { today } from "@/lib/date";
import { ProfitCard } from "@/components/ProfitCard";
import { EntryList, type EntryRow } from "@/components/EntryList";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const date = today();
  const [summary, incomes, expenses] = await Promise.all([
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
    <div className="pb-4">
      <ProfitCard
        profit={summary.profit}
        income={summary.income}
        expense={summary.expense}
        currency={user.currency}
      />

      <div className="grid grid-cols-2 gap-3 px-4">
        <Link
          href="/income"
          className="tap-target flex h-20 items-center justify-center rounded-2xl bg-emerald-600 text-lg font-bold text-white active:bg-emerald-700"
        >
          + INCOME
        </Link>
        <Link
          href="/expense"
          className="tap-target flex h-20 items-center justify-center rounded-2xl bg-red-600 text-lg font-bold text-white active:bg-red-700"
        >
          − EXPENSE
        </Link>
      </div>

      <div className="mt-6">
        <h2 className="px-4 pb-1 text-sm font-semibold text-slate-500">Recent today</h2>
        <div className="mx-2 overflow-hidden rounded-2xl bg-white shadow-sm">
          <EntryList
            entries={entries}
            currency={user.currency}
            emptyHint="No entries today — tap + INCOME or − EXPENSE to start."
          />
        </div>
      </div>
    </div>
  );
}
