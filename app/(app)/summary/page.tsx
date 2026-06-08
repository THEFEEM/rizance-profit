import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { dailySummary, listIncomeByDate, listExpenseByDate } from "@/lib/queries";
import { today, isValidDate, formatDateLabel } from "@/lib/date";
import { DateNav } from "@/components/DateNav";
import { SummaryRows } from "@/components/SummaryRows";
import { EntryList, type EntryRow } from "@/components/EntryList";

export const dynamic = "force-dynamic";

export default async function DailySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const date = params.date && isValidDate(params.date) ? params.date : today();

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
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-lg font-bold text-slate-900">Daily Summary</h1>
        <Link href="/summary/monthly" className="text-sm font-medium text-emerald-700">
          Monthly →
        </Link>
      </div>

      <DateNav date={date} label={formatDateLabel(date)} />

      <SummaryRows
        income={summary.income}
        expense={summary.expense}
        profit={summary.profit}
        currency={user.currency}
      />

      <div className="mt-6">
        <h2 className="px-4 pb-1 text-sm font-semibold text-slate-500">Entries</h2>
        <div className="mx-2 overflow-hidden rounded-2xl bg-white shadow-sm">
          <EntryList
            entries={entries}
            currency={user.currency}
            emptyHint="No entries on this day."
          />
        </div>
      </div>
    </div>
  );
}
