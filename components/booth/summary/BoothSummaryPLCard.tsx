"use client";

import { useState } from "react";
import { ReceiptIcon } from "@/components/booth/summary/icons";
import { formatMoney, moneySign } from "@/lib/money";
import type { BoothSummary } from "@/types/booth";

function DetailRow({
  label,
  amount,
  currency,
  tone,
}: {
  label: string;
  amount: string;
  currency: string;
  tone: "income" | "expense" | "neutral";
}) {
  const color =
    tone === "income" ? "text-rz-green" : tone === "expense" ? "text-rz-red" : "text-rz-text";
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-rz-muted">{label}</span>
      <span className={`rz-tabular text-sm font-medium ${color}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

export function BoothSummaryPLCard({
  summary,
  currency = "THB",
}: {
  summary: BoothSummary;
  currency?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-6 px-4">
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="tap-target flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-rz-elevated"
          aria-expanded={open}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-rz-border bg-rz-elevated text-rz-muted">
            <ReceiptIcon />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-rz-text">รายรับ–รายจ่าย</span>
          {!open && (
            <span className="flex shrink-0 items-center gap-3 text-sm">
              <span className="rz-tabular font-medium text-rz-green">
                ↑ {formatMoney(summary.totalIncome, currency)}
              </span>
              <span className="rz-tabular font-medium text-rz-red">
                ↓ {formatMoney(summary.totalExpense, currency)}
              </span>
            </span>
          )}
          <span className="shrink-0 text-rz-hint" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>

        {open && (
          <div className="border-t-[0.5px] border-rz-border px-4 pb-4">
            <div className="grid grid-cols-2 gap-3 py-3">
              <div className="rounded-[11px] border-[0.5px] border-rz-border bg-rz-elevated/50 px-3 py-3 text-center">
                <p className="text-xs text-rz-hint">รายรับรวม</p>
                <p className="mt-1 rz-tabular text-base font-medium text-rz-green">
                  {formatMoney(summary.totalIncome, currency)}
                </p>
              </div>
              <div className="rounded-[11px] border-[0.5px] border-rz-border bg-rz-elevated/50 px-3 py-3 text-center">
                <p className="text-xs text-rz-hint">รายจ่ายรวม</p>
                <p className="mt-1 rz-tabular text-base font-medium text-rz-red">
                  {formatMoney(summary.totalExpense, currency)}
                </p>
              </div>
            </div>

            <p className="pb-1 text-xs font-medium uppercase tracking-wide text-rz-hint">รายรับ</p>
            <DetailRow
              label="รายรับเงินสด"
              amount={summary.cashIncome}
              currency={currency}
              tone="income"
            />
            <DetailRow
              label="รายรับโอน"
              amount={summary.transferIncome}
              currency={currency}
              tone="income"
            />

            <p className="mt-3 pb-1 text-xs font-medium uppercase tracking-wide text-rz-hint">
              ค่าใช้จ่าย
            </p>
            <DetailRow
              label="ค่าใช้จ่ายคงที่"
              amount={summary.fixedExpense}
              currency={currency}
              tone="expense"
            />
            <DetailRow
              label="ค่าใช้จ่ายผันแปร"
              amount={summary.variableExpense}
              currency={currency}
              tone="expense"
            />
            {moneySign(summary.wageCost) > 0 && (
              <DetailRow
                label="ค่าแรง (คำนวณ)"
                amount={summary.wageCost}
                currency={currency}
                tone="expense"
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
