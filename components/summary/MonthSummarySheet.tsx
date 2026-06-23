"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CategoryProgressList, type CategoryProgressRow } from "@/components/stats/CategoryProgressList";
import { SummaryRows } from "@/components/SummaryRows";
import { formatMonthLabel } from "@/lib/date";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
} from "@/lib/expense-categories";
import {
  renderShopExpenseIcon,
  renderShopIncomeIcon,
} from "@/lib/category-lucide-icons";
import { toCents } from "@/lib/money";
import { SHOP_SUMMARY_LABELS } from "@/lib/summary-params";
import type { CategoryBreakdownItem } from "@/types";

export type MonthSummaryDetail = {
  month: string;
  income: string;
  expense: string;
  profit: string;
  incomeCategories: CategoryBreakdownItem[];
  expenseCategories: CategoryBreakdownItem[];
};

function sharePercent(part: string, total: string): number {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0;
  return (toCents(part) / totalCents) * 100;
}

function toCategoryRows(
  items: CategoryBreakdownItem[],
  kind: "income" | "expense",
  totalAmount: string,
): CategoryProgressRow[] {
  const labelFn = kind === "income" ? incomeCategoryLabel : expenseCategoryLabel;
  const iconFn = kind === "income" ? renderShopIncomeIcon : renderShopExpenseIcon;
  return items
    .map((item) => ({
      category: item.category,
      label: labelFn(item.category),
      icon: iconFn(item.category),
      amount: item.amount,
      count: item.count,
      percentage: sharePercent(item.amount, totalAmount),
    }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

export function MonthSummarySheet({
  month,
  detail,
  loading,
  error,
  currency = "THB",
  onClose,
}: {
  month: string | null;
  detail: MonthSummaryDetail | null;
  loading: boolean;
  error: string | null;
  currency?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!month) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [month]);

  if (!month) return null;

  const incomeRows = detail ? toCategoryRows(detail.incomeCategories, "income", detail.income) : [];
  const expenseRows = detail
    ? toCategoryRows(detail.expenseCategories, "expense", detail.expense)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="month-summary-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[20px] border-[0.5px] border-rz-border bg-rz-card shadow-xl sm:rounded-[14px] sm:mb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-col items-center border-b-[0.5px] border-rz-border px-4 pb-3 pt-2">
          <div className="mb-2 h-1 w-10 rounded-full bg-rz-border" aria-hidden />
          <div className="flex w-full items-center justify-between gap-2">
            <h2 id="month-summary-title" className="text-lg font-medium text-rz-text">
              {formatMonthLabel(month)}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="tap-target rounded-full px-3 py-1.5 text-sm font-medium text-rz-muted active:bg-rz-elevated"
            >
              ปิด
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {loading && (
            <p className="px-4 py-8 text-center text-sm text-rz-hint">กำลังโหลด…</p>
          )}
          {error && !loading && (
            <p className="px-4 py-8 text-center text-sm text-rz-red">{error}</p>
          )}
          {detail && !loading && !error && (
            <>
              <div className="mt-4">
                <SummaryRows
                  income={detail.income}
                  expense={detail.expense}
                  profit={detail.profit}
                  currency={currency}
                  labels={SHOP_SUMMARY_LABELS}
                  appearance="stats"
                />
              </div>

              {incomeRows.length > 0 && (
                <div className="mt-6">
                  <h3 className="px-4 pb-2 text-sm font-medium text-rz-muted">รายรับตามหมวด</h3>
                  <div className="mx-4 overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
                    <CategoryProgressList
                      rows={incomeRows}
                      entriesByCategory={{}}
                      currency={currency}
                      tone="income"
                    />
                  </div>
                </div>
              )}

              {expenseRows.length > 0 && (
                <div className="mt-6">
                  <h3 className="px-4 pb-2 text-sm font-medium text-rz-muted">รายจ่ายตามหมวด</h3>
                  <div className="mx-4 overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
                    <CategoryProgressList
                      rows={expenseRows}
                      entriesByCategory={{}}
                      currency={currency}
                      tone="expense"
                    />
                  </div>
                </div>
              )}

              <p className="mt-6 text-center">
                <Link
                  href={`/summary/monthly?mode=monthly&month=${month}`}
                  className="text-sm font-medium text-rz-green active:opacity-90"
                  onClick={onClose}
                >
                  ดูสรุปเดือนเต็ม →
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
