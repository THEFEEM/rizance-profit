"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, toCents, centsToDecimalString } from "@/lib/money";

export function PersonalBudgetBar({
  monthlyBudget,
  monthExpense,
  currency = "THB",
}: {
  monthlyBudget: string | null;
  monthExpense: string;
  currency?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveBudget() {
    const parsed = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("กรุณาระบุจำนวนงบที่ถูกต้อง");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudget: parsed }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!monthlyBudget && !editing) {
    return (
      <section className="px-4 pt-3">
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setAmount("");
            setError(null);
          }}
          className="w-full rounded-[14px] border-[0.5px] border-dashed border-rz-border bg-rz-card px-4 py-3 text-left text-sm text-rz-muted active:bg-rz-elevated"
        >
          ตั้งงบประมาณเดือน →
        </button>
      </section>
    );
  }

  if (editing) {
    return (
      <section className="px-4 pt-3">
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
          <p className="text-xs text-rz-muted">งบประมาณรายเดือน</p>
          <div className="mt-2 flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="เช่น 15000"
              className="min-w-0 flex-1 rounded-lg border-[0.5px] border-rz-border bg-rz-bg px-3 py-2 text-sm text-rz-text outline-none focus:border-rz-rose"
            />
            <button
              type="button"
              onClick={saveBudget}
              disabled={saving}
              className="shrink-0 rounded-lg bg-rz-rose px-4 py-2 text-sm font-medium text-rz-bg disabled:opacity-50"
            >
              บันทึก
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rz-red">{error}</p>}
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="mt-2 text-xs text-rz-hint"
          >
            ยกเลิก
          </button>
        </div>
      </section>
    );
  }

  const budgetCents = toCents(monthlyBudget!);
  const expenseCents = toCents(monthExpense);
  const usedPct = budgetCents > 0 ? Math.min(100, (expenseCents / budgetCents) * 100) : 0;
  const remainCents = budgetCents - expenseCents;
  const remain = centsToDecimalString(remainCents);

  return (
    <section className="px-4 pt-3">
      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-rz-muted">งบเดือนนี้</p>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setAmount(monthlyBudget ?? "");
              setError(null);
            }}
            className="text-xs text-rz-rose"
          >
            แก้ไข
          </button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-rz-elevated">
          <div
            className={`h-full rounded-full transition-all ${
              usedPct >= 100 ? "bg-rz-red" : "bg-rz-rose"
            }`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-rz-hint">
          ใช้ไป {usedPct.toFixed(0)}% ของงบ · เหลือ {formatMoney(remain, currency)}
        </p>
      </div>
    </section>
  );
}
