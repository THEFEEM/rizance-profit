"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";

const COLOR_INCOME = "#4ADE9E";
const COLOR_EXPENSE = "#F87171";
const COLOR_GRID = "#243049";
const COLOR_AXIS = "#9AA6B8";

export type MonthlyChartPoint = {
  month: string;
  label: string;
  income: number;
  expense: number;
  incomeDisplay: string;
  expenseDisplay: string;
};

export function MonthlyIncomeExpenseChart({
  data,
  currency = "THB",
  highlightMonth,
  onMonthClick,
}: {
  data: MonthlyChartPoint[];
  currency?: string;
  highlightMonth?: string;
  onMonthClick: (month: string) => void;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-rz-hint">
        ยังไม่มีข้อมูลในปีนี้
      </div>
    );
  }

  function handleBarClick(barData: { payload?: MonthlyChartPoint }) {
    const month = barData?.payload?.month;
    if (month) onMonthClick(month);
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={({ x, y, payload, index }) => {
              const point = data[index];
              const isHighlight = point?.month === highlightMonth;
              return (
                <text
                  x={x}
                  y={y}
                  dy={12}
                  textAnchor="middle"
                  fill={isHighlight ? "#E8EDF5" : COLOR_AXIS}
                  fontSize={11}
                  fontWeight={isHighlight ? 600 : 400}
                >
                  {payload.value}
                </text>
              );
            }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
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
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as MonthlyChartPoint;
              return (
                <div className="rounded-lg border-[0.5px] border-rz-border bg-rz-card px-3 py-2 text-xs shadow-lg">
                  <p className="text-rz-muted">{row.label}</p>
                  <p className="mt-0.5 font-medium rz-tabular text-rz-green">
                    รายรับ {formatMoney(row.incomeDisplay, currency)}
                  </p>
                  <p className="font-medium rz-tabular text-rz-red">
                    รายจ่าย {formatMoney(row.expenseDisplay, currency)}
                  </p>
                  <p className="mt-1 text-rz-hint">แตะเพื่อดูรายละเอียด</p>
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: COLOR_AXIS, paddingBottom: 4 }}
            formatter={(value) => (value === "income" ? "รายรับ" : "รายจ่าย")}
          />
          <Bar dataKey="income" name="income" radius={[4, 4, 0, 0]} cursor="pointer" onClick={handleBarClick}>
            {data.map((entry) => (
              <Cell
                key={`income-${entry.month}`}
                fill={COLOR_INCOME}
                fillOpacity={highlightMonth && entry.month !== highlightMonth ? 0.65 : 1}
              />
            ))}
          </Bar>
          <Bar dataKey="expense" name="expense" radius={[4, 4, 0, 0]} cursor="pointer" onClick={handleBarClick}>
            {data.map((entry) => (
              <Cell
                key={`expense-${entry.month}`}
                fill={COLOR_EXPENSE}
                fillOpacity={highlightMonth && entry.month !== highlightMonth ? 0.65 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <span className="sr-only">กราฟรายรับและรายจ่ายรายเดือน</span>
    </div>
  );
}
