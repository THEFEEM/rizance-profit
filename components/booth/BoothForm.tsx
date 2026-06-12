"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import {
  PROFIT_SPLIT_METHODS,
  PROFIT_SPLIT_METHOD_LABELS,
  type Booth,
  type ProfitSplitMethod,
} from "@/types/booth";

export function BoothForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [poolBudgetRaw, setPoolBudgetRaw] = useState("");
  const [profitSplitMethod, setProfitSplitMethod] = useState<ProfitSplitMethod>("equal");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [note, setNote] = useState("");
  const [padBudget, setPadBudget] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch<Booth>("/api/booths", {
      method: "POST",
      body: JSON.stringify({
        name,
        poolBudget: poolBudgetRaw === "" ? 0 : Number(poolBudgetRaw),
        profitSplitMethod,
        startDate,
        endDate,
        note: note.trim() || undefined,
      }),
    });
    if (res.ok) {
      router.push("/booth");
      router.refresh();
    } else {
      setError(res.message);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <Input
        label="ชื่องาน / บูธ"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="เช่น งานวัดปากน้ำ 3 วัน"
      />

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-slate-700">งบกองกลาง / ทุนสนับสนุน (บาท)</p>
        <p className="mt-0.5 text-xs text-slate-400">ไม่นับเป็นสัดส่วนลงทุนสมาชิก</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
          {formatTyped(poolBudgetRaw) || "0"}
        </p>
        {padBudget ? (
          <QuickAmountPad
            value={poolBudgetRaw}
            onChange={setPoolBudgetRaw}
            onSave={() => setPadBudget(false)}
            saveLabel="ตกลง"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPadBudget(true)}
            className="tap-target mt-2 text-sm font-medium text-emerald-700"
          >
            ใส่จำนวนเงิน →
          </button>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">วิธีแบ่งกำไร</p>
        <div className="flex flex-col gap-2">
          {PROFIT_SPLIT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setProfitSplitMethod(m)}
              className={`tap-target rounded-2xl border px-4 py-2.5 text-left text-sm font-medium ${
                profitSplitMethod === m
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"
              }`}
            >
              {PROFIT_SPLIT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <Input
        label="วันเริ่ม"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
      <Input
        label="วันสิ้นสุด"
        type="date"
        value={endDate}
        min={startDate}
        onChange={(e) => setEndDate(e.target.value)}
      />
      <Input
        label="หมายเหตุ (ไม่บังคับ)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button onClick={save} disabled={saving || !name.trim()}>
        {saving ? "กำลังบันทึก…" : "สร้างงานบูธ"}
      </Button>
    </div>
  );
}
