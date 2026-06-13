import Link from "next/link";
import {
  boothDaySummary,
  boothSummary,
  listBoothExpenseByDate,
  listBoothIncomeByDate,
} from "@/lib/booth-queries";
import {
  clampDateToRange,
  defaultBoothEntryDate,
  formatDateLabel,
  formatDayShort,
  isValidDate,
  today,
} from "@/lib/date";
import { DateNav } from "@/components/DateNav";
import { BoothStatsRows } from "@/components/BoothStatsRows";
import { BoothDayEntryList } from "@/components/BoothDayEntryList";
import { SummaryRows } from "@/components/SummaryRows";
import type { Booth } from "@/types/booth";
import type { User } from "@/types";

const DAY_LABELS = {
  income: "รายรับ",
  expense: "รายจ่าย",
  profit: "กำไร",
};

/** Booth event Stats — full event range + per-day drill-down within event dates. */
export async function BoothStatsSummary({
  user,
  booth,
  closeDate,
}: {
  user: User;
  booth: Booth;
  closeDate: string;
}) {
  const maxDate = clampDateToRange(today(), booth.startDate, booth.endDate);

  const [eventSummary, daySummary, incomes, expenses] = await Promise.all([
    boothSummary(user.id, booth.id),
    boothDaySummary(user.id, booth.id, closeDate),
    listBoothIncomeByDate(user.id, booth.id, closeDate),
    listBoothExpenseByDate(user.id, booth.id, closeDate),
  ]);

  const event = eventSummary!;
  const day = daySummary ?? { income: "0.00", expense: "0.00", profit: "0.00" };
  const dayEntryCount = incomes.length + expenses.length;

  return (
    <>
      <div className="mt-3 px-4">
        <p className="text-center text-sm font-medium text-rz-amber">{booth.name}</p>
        <p className="text-center text-xs text-rz-hint">
          {formatDayShort(booth.startDate)}
          {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
          {" · สรุปทั้งงาน"}
        </p>
      </div>

      <div className="mt-4">
        <BoothStatsRows
          cashIncome={event.cashIncome}
          transferIncome={event.transferIncome}
          fixedExpense={event.fixedExpense}
          variableExpense={event.variableExpense}
          profit={event.profit}
          currency={user.currency}
        />
        <p className="px-4 pt-2 text-center text-xs text-rz-hint">
          {event.incomeCount + event.expenseCount > 0
            ? `${event.incomeCount + event.expenseCount} รายการทั้งงาน`
            : "ยังไม่มีรายการในงานนี้"}
        </p>
        <p className="px-4 pt-2 text-center">
          <Link
            href={`/booth/${booth.id}/summary`}
            className="text-sm font-medium text-rz-amber"
          >
            ดูสรุปบูธเต็ม →
          </Link>
        </p>
      </div>

      <div className="mt-8">
        <h2 className="px-4 text-base font-medium text-rz-text">สรุปรายวัน</h2>
        <DateNav
          date={closeDate}
          label={formatDateLabel(closeDate)}
          period="today"
          minDate={booth.startDate}
          maxDate={maxDate}
          accent="amber"
        />
        <SummaryRows
          income={day.income}
          expense={day.expense}
          profit={day.profit}
          currency={user.currency}
          labels={DAY_LABELS}
        />
        <p className="px-4 pb-1 text-center text-xs text-rz-hint">
          {dayEntryCount > 0
            ? `${incomes.length} รายรับ · ${expenses.length} รายจ่าย`
            : "ไม่มีรายการในวันนี้"}
        </p>
      </div>

      <div className="mt-6">
        <h2 className="px-4 pb-2 text-sm font-medium text-rz-muted">รายการ</h2>
        <BoothDayEntryList
          boothId={booth.id}
          incomes={incomes}
          expenses={expenses}
          currency={user.currency}
          readOnly
          appearance="today"
        />
      </div>
    </>
  );
}

export function parseBoothStatsDate(
  booth: Booth,
  params: { date?: string },
): string {
  const maxDate = clampDateToRange(today(), booth.startDate, booth.endDate);
  const defaultDate = defaultBoothEntryDate(booth.startDate, booth.endDate);
  let closeDate =
    params.date && isValidDate(params.date) ? params.date : defaultDate;
  return clampDateToRange(closeDate, booth.startDate, maxDate);
}
