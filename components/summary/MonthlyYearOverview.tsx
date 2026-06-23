"use client";

import { useCallback, useState } from "react";
import { formatMonthShortThai, currentMonth } from "@/lib/date";
import {
  MonthlyIncomeExpenseChart,
  type MonthlyChartPoint,
} from "@/components/summary/MonthlyIncomeExpenseChart";
import {
  MonthSummarySheet,
  type MonthSummaryDetail,
} from "@/components/summary/MonthSummarySheet";
import type { MonthlyProfitPoint } from "@/types";

export function MonthlyYearOverview({
  series,
  year,
  currency = "THB",
}: {
  series: MonthlyProfitPoint[];
  year: number;
  currency?: string;
}) {
  const [sheetMonth, setSheetMonth] = useState<string | null>(null);
  const [detail, setDetail] = useState<MonthSummaryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartData: MonthlyChartPoint[] = series.map((p) => ({
    month: p.month,
    label: formatMonthShortThai(p.month),
    income: Number(p.income),
    expense: Number(p.expense),
    incomeDisplay: p.income,
    expenseDisplay: p.expense,
  }));

  const highlightMonth = year === Number(currentMonth().slice(0, 4)) ? currentMonth() : undefined;

  const openMonth = useCallback(async (month: string) => {
    setSheetMonth(month);
    setDetail(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/summary/monthly/detail?month=${encodeURIComponent(month)}`);
      const json = (await res.json()) as {
        data?: MonthSummaryDetail;
        error?: { message: string };
      };
      if (!res.ok) {
        throw new Error(json.error?.message ?? "โหลดไม่สำเร็จ");
      }
      if (!json.data) {
        throw new Error("โหลดไม่สำเร็จ");
      }
      setDetail(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  const closeSheet = useCallback(() => {
    setSheetMonth(null);
    setDetail(null);
    setError(null);
    setLoading(false);
  }, []);

  return (
    <>
      <section className="mt-6 px-4">
        <h2 className="mb-2.5 text-sm font-medium text-rz-text">กราฟรายเดือน ({year})</h2>
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-3">
          <MonthlyIncomeExpenseChart
            data={chartData}
            currency={currency}
            highlightMonth={highlightMonth}
            onMonthClick={openMonth}
          />
        </div>
      </section>

      <MonthSummarySheet
        month={sheetMonth}
        detail={detail}
        loading={loading}
        error={error}
        currency={currency}
        onClose={closeSheet}
      />
    </>
  );
}
