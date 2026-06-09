import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  dailySummary,
  listIncomeByDate,
  listExpenseByDate,
  periodSummary,
} from "@/lib/queries";
import {
  today,
  isValidDate,
  isValidPeriod,
  formatDateLabel,
  formatPeriodRangeLabel,
  currentMonth,
  type PeriodKey,
} from "@/lib/date";
import { PeriodSelector } from "@/components/PeriodSelector";
import { DateNav } from "@/components/DateNav";
import { SummaryRows } from "@/components/SummaryRows";
import { EntryList, type EntryRow } from "@/components/EntryList";

export const dynamic = "force-dynamic";

const PERIOD_SUMMARY_LABELS = {
  income: "สรุปรายรับ",
  expense: "สรุปรายจ่าย",
  profit: "กำไร",
};

const CLOSE_OUT_LABELS = {
  income: "รายรับ",
  expense: "รายจ่าย",
  profit: "กำไร",
};

export default async function StatsSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const period: PeriodKey =
    params.period && isValidPeriod(params.period) ? params.period : "today";

  const bangkokToday = today();
  let closeDate =
    params.date && isValidDate(params.date) ? params.date : bangkokToday;
  if (closeDate > bangkokToday) closeDate = bangkokToday;

  const [periodData, closeOut, incomes, expenses] = await Promise.all([
    periodSummary(user.id, period),
    dailySummary(user.id, closeDate),
    listIncomeByDate(user.id, closeDate),
    listExpenseByDate(user.id, closeDate),
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

  const entryTotal = periodData.incomeCount + periodData.expenseCount;

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-lg font-bold text-slate-900">สถิติ</h1>
        <Link href="/pricing" className="text-sm font-medium text-emerald-700">
          ต้นทุนและราคา →
        </Link>
      </div>

      <div className="mt-3">
        <PeriodSelector period={period} date={closeDate} />
      </div>

      <div className="mt-4">
        <SummaryRows
          income={periodData.income}
          expense={periodData.expense}
          profit={periodData.profit}
          currency={user.currency}
          labels={PERIOD_SUMMARY_LABELS}
        />
        <p className="px-4 pt-2 text-center text-xs text-slate-400">
          {formatPeriodRangeLabel(periodData.start, periodData.end)}
          {entryTotal > 0 && ` · ${entryTotal.toLocaleString()} รายการ`}
        </p>
        {period === "month" && (
          <p className="px-4 pt-2 text-center">
            <Link
              href={`/summary/monthly?month=${currentMonth()}`}
              className="text-sm font-medium text-emerald-700"
            >
              ดูรายวันในเดือน →
            </Link>
          </p>
        )}
      </div>

      <div className="mt-8">
        <h2 className="px-4 text-base font-bold text-slate-900">ปิดร้าน</h2>
        <DateNav
          date={closeDate}
          label={formatDateLabel(closeDate)}
          period={period}
          maxDate={bangkokToday}
        />
        <SummaryRows
          income={closeOut.income}
          expense={closeOut.expense}
          profit={closeOut.profit}
          currency={user.currency}
          labels={CLOSE_OUT_LABELS}
        />
        <p className="px-4 pb-1 text-center text-xs text-slate-400">
          {closeOut.incomeCount + closeOut.expenseCount > 0
            ? `${closeOut.incomeCount} รายรับ · ${closeOut.expenseCount} รายจ่าย`
            : "ยังไม่มีรายการในวันนี้"}
        </p>
      </div>

      <div className="mt-6">
        <h2 className="px-4 pb-1 text-sm font-semibold text-slate-500">รายการ</h2>
        <div className="mx-2 overflow-hidden rounded-2xl bg-white shadow-sm">
          <EntryList
            entries={entries}
            currency={user.currency}
            emptyHint="ไม่มีรายการในวันนี้"
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
