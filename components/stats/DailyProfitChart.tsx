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

const COLOR_POSITIVE = "#4ADE9E";
const COLOR_NEGATIVE = "#F87171";
const COLOR_GRID = "#243049";
const COLOR_AXIS = "#9AA6B8";

export type DailyProfitChartPoint = {
  label: string;
  profit: number;
  profitDisplay: string;
  date: string;
};

export function DailyProfitChart({
  data,
  currency = "THB",
}: {
  data: DailyProfitChartPoint[];
  currency?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-rz-hint">
        ยังไม่มีข้อมูลในช่วงนี้
      </div>
    );
  }

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
              const row = payload[0].payload as DailyProfitChartPoint;
              return (
                <div className="rounded-lg border-[0.5px] border-rz-border bg-rz-card px-3 py-2 text-xs shadow-lg">
                  <p className="text-rz-muted">{row.date}</p>
                  <p
                    className={`mt-0.5 font-medium rz-tabular ${
                      row.profit >= 0 ? "text-rz-green" : "text-rz-red"
                    }`}
                  >
                    {formatMoney(row.profitDisplay, currency)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.profit >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
