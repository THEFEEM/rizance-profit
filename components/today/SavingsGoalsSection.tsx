"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, toCents } from "@/lib/money";
import type { SavingsGoal } from "@/types/personal";

function goalProgress(balance: string, target: string): number {
  const targetCents = toCents(target);
  if (targetCents <= 0) return 0;
  return Math.min(100, (toCents(balance) / targetCents) * 100);
}

export function SavingsGoalsSection({
  goals: initialGoals,
  balance,
  currency = "THB",
}: {
  goals: SavingsGoal[];
  balance: string;
  currency?: string;
}) {
  const router = useRouter();
  const [goals, setGoals] = useState(initialGoals);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addGoal() {
    const parsed = Number(target.replace(/,/g, ""));
    if (!name.trim()) {
      setError("กรุณาระบุชื่อเป้าหมาย");
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("กรุณาระบุจำนวนเป้าหมายที่ถูกต้อง");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/personal/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), targetAmount: parsed }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "บันทึกไม่สำเร็จ");
        return;
      }
      const json = await res.json();
      setGoals((prev) => [...prev, json.data]);
      setName("");
      setTarget("");
      setAdding(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const showSection = goals.length > 0 || adding;

  return (
    <section className="mt-4 px-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-rz-text">เป้าหมายออม</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
            className="text-xs font-medium text-rz-rose"
          >
            + เพิ่มเป้าหมาย
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อเป้าหมาย เช่น ซื้อ iPad"
            className="w-full rounded-lg border-[0.5px] border-rz-border bg-rz-bg px-3 py-2 text-sm text-rz-text outline-none focus:border-rz-rose"
          />
          <input
            type="number"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="จำนวนเป้าหมาย"
            className="mt-2 w-full rounded-lg border-[0.5px] border-rz-border bg-rz-bg px-3 py-2 text-sm text-rz-text outline-none focus:border-rz-rose"
          />
          {error && <p className="mt-2 text-xs text-rz-red">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={addGoal}
              disabled={saving}
              className="rounded-lg bg-rz-rose px-4 py-2 text-sm font-medium text-rz-bg disabled:opacity-50"
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="rounded-lg px-3 py-2 text-sm text-rz-hint"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {showSection && goals.length > 0 && (
        <div className="space-y-2">
          {goals.map((goal) => {
            const pct = goalProgress(balance, goal.targetAmount);
            return (
              <div
                key={goal.id}
                className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3"
              >
                <div className="flex items-start gap-2">
                  <span className="text-base" aria-hidden>
                    🎯
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-rz-text">{goal.name}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rz-elevated">
                      <div
                        className="h-full rounded-full bg-rz-rose transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-rz-hint rz-tabular">
                      {formatMoney(balance, currency)} / {formatMoney(goal.targetAmount, currency)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!showSection && (
        <p className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4 text-center text-xs text-rz-hint">
          ยังไม่มีเป้าหมายออม — แตะ + เพิ่มเป้าหมาย
        </p>
      )}
    </section>
  );
}
