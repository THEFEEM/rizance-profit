"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";

const COLOR_POSITIVE_GREEN = "#4ADE9E";
const COLOR_POSITIVE_AMBER = "#EF9F27";
const COLOR_POSITIVE_PURPLE = "#B69CE8";
const COLOR_NEGATIVE = "#F87171";
const COLOR_EXPENSE = "#F87171";
const COLOR_GRID = "#243049";
const COLOR_AXIS = "#9AA6B8";

export type DailyProfitChartPoint = {
  label: string;
  profit: number;
  profitDisplay: string;
  date: string;
};

export type DailyExpenseChartPoint = {
  label: string;
  expense: number;
  expenseDisplay: string;
  date: string;
};

type ChartPoint = DailyProfitChartPoint | DailyExpenseChartPoint;

export function DailyProfitChart({
  data,
  currency = "THB",
  accent = "green",
  mode = "profit",
}: {
  data: ChartPoint[];
  currency?: string;
  accent?: "green" | "amber" | "purple";
  mode?: "profit" | "expense";
}) {
  const positiveColor =
    accent === "amber"
      ? COLOR_POSITIVE_AMBER
      : accent === "purple"
        ? COLOR_POSITIVE_PURPLE
        : COLOR_POSITIVE_GREEN;
  const positiveTextClass =
    accent === "amber"
      ? "text-rz-amber"
      : accent === "purple"
        ? "text-rz-purple"
        : "text-rz-green";

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-rz-hint">
        ยังไม่มีข้อมูลในช่วงนี้
      </div>
    );
  }

  const dataKey = mode === "expense" ? "expense" : "profit";
  const emptyLabel = mode === "expense" ? "รายจ่ายรายวัน" : "กำไรรายวัน";

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLOR_AXIS, fontSize: 11 }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
            interval={data.length > 14 ? Math.floor(data.length / 7) : 0}
          />
          <YAxis
            tick={{ fill: COLOR_AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v: number) =>
              Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
            }
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const row = payload[0].payload as ChartPoint;
              if (mode === "expense") {
                const expenseRow = row as DailyExpenseChartPoint;
                return (
                  <div className="rounded-lg border-[0.5px] border-rz-border bg-rz-card px-3 py-2 text-xs shadow-lg">
                    <p className="text-rz-muted">{expenseRow.date}</p>
                    <p className="mt-0.5 font-medium rz-tabular text-rz-red">
                      {formatMoney(expenseRow.expenseDisplay, currency)}
                    </p>
                  </div>
                );
              }
              const profitRow = row as DailyProfitChartPoint;
              return (
                <div className="rounded-lg border-[0.5px] border-rz-border bg-rz-card px-3 py-2 text-xs shadow-lg">
                  <p className="text-rz-muted">{profitRow.date}</p>
                  <p
                    className={`mt-0.5 font-medium rz-tabular ${
                      profitRow.profit >= 0 ? positiveTextClass : "text-rz-red"
                    }`}
                  >
                    {formatMoney(profitRow.profitDisplay, currency)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey={dataKey} radius={[4, 4, 0, 0]}>
            {data.map((entry) => {
              if (mode === "expense") {
                return <Cell key={entry.date} fill={COLOR_EXPENSE} />;
              }
              const profitRow = entry as DailyProfitChartPoint;
              return (
                <Cell
                  key={entry.date}
                  fill={profitRow.profit >= 0 ? positiveColor : COLOR_NEGATIVE}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <span className="sr-only">{emptyLabel}</span>
    </div>
  );
}
