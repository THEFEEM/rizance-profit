"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { BoothMemberEditor } from "@/components/booth/BoothMemberEditor";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { computeProfit, formatMoney, moneySign } from "@/lib/money";
import {
  PROFIT_SPLIT_METHODS,
  PROFIT_SPLIT_METHOD_LABELS,
  type Booth,
  type BoothMember,
  type ProfitSplitMethod,
} from "@/types/booth";

export function BoothSetup({
  booth,
  members,
  closed,
  currency = "THB",
  createMode = false,
}: {
  booth?: Booth;
  members: BoothMember[];
  closed: boolean;
  currency?: string;
  createMode?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(booth?.name ?? "");
  const [poolBudgetRaw, setPoolBudgetRaw] = useState(
    booth ? String(Math.round(Number(booth.poolBudget) * 100) / 100) : "",
  );
  const [poolGetsShare, setPoolGetsShare] = useState(booth?.poolGetsShare ?? false);
  const [profitSplitMethod, setProfitSplitMethod] = useState<ProfitSplitMethod>(
    booth?.profitSplitMethod ?? "equal",
  );
  const [startDate, setStartDate] = useState(booth?.startDate ?? today());
  const [endDate, setEndDate] = useState(booth?.endDate ?? today());
  const [note, setNote] = useState(booth?.note ?? "");
  const [padBudget, setPadBudget] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const poolNum = poolBudgetRaw === "" ? 0 : Number(poolBudgetRaw);
  const memberEquity = members.reduce((sum, m) => {
    if (m.role === "investor" || m.role === "manager") {
      return sum + Number(m.investmentAmount);
    }
    return sum;
  }, 0);
  const totalBudget = poolNum + memberEquity;

  async function persistSettings(): Promise<boolean> {
    if (closed || !name.trim()) return false;

    const payload = {
      name: name.trim(),
      poolBudget: poolNum,
      poolGetsShare,
      profitSplitMethod,
      startDate,
      endDate,
      note: note.trim() || undefined,
    };

    if (createMode) {
      const res = await apiFetch<Booth>("/api/booths", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.replace(`/booth/${res.data.id}/setup`);
        router.refresh();
        return true;
      }
      setError(res.message);
      return false;
    }

    if (!booth) return false;
    const res = await apiFetch<Booth>(`/api/booths/${booth.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setSavedFlash(true);
      router.refresh();
      return true;
    }
    setError(res.message);
    return false;
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    await persistSettings();
    setSaving(false);
  }

  async function finishSetup() {
    if (!booth || createMode || closed) return;
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    const ok = await persistSettings();
    setSaving(false);
    if (ok) {
      router.push(`/booth/${booth.id}`);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <section className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">โครงสร้างทุน</h2>
          <p className="mt-0.5 text-xs text-slate-500">กองกลาง + สมาชิกลงทุน = งบรวม</p>
        </div>
        <div className="space-y-4 px-4 py-4">
          <Input
            label="ชื่องาน / บูธ"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น งานวัดปากน้ำ 3 วัน"
            disabled={closed}
          />

          <div>
            <p className="text-sm font-medium text-slate-700">งบกองกลาง (บาท)</p>
            <p className="mt-0.5 text-xs text-slate-400">ทุนสนับสนุน / เงินสำรองร้าน</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {formatTyped(poolBudgetRaw) || "0"}
            </p>
            {!closed &&
              (padBudget ? (
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
                  ใส่จำนวน →
                </button>
              ))}
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <input
              type="checkbox"
              checked={poolGetsShare}
              disabled={closed}
              onChange={(e) => setPoolGetsShare(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="text-sm font-medium text-slate-800">กองกลางรับส่วนแบ่งกำไร</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                น้ำหนักตามงบกองกลาง · ส่วนแบ่งแสดงเป็น &quot;เข้ากองกลาง&quot;
              </span>
            </span>
          </label>

          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">กองกลาง</span>
              <span className="font-semibold tabular-nums">{formatMoney(String(poolNum), currency)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-slate-600">สมาชิกลงทุน</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(String(memberEquity.toFixed(2)), currency)}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2">
              <span className="font-medium text-slate-800">งบรวม</span>
              <span className="text-base font-bold tabular-nums text-emerald-700">
                {formatMoney(String(totalBudget.toFixed(2)), currency)}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">วิธีแบ่งกำไร</p>
            <div className="flex flex-col gap-2">
              {PROFIT_SPLIT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={closed}
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
            disabled={closed}
          />
          <Input
            label="วันสิ้นสุด"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={closed}
          />
          <Input
            label="หมายเหตุ (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={closed}
          />

          {!closed && (
            <>
              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
              {savedFlash && !createMode && (
                <p className="text-sm text-emerald-700">บันทึกการตั้งค่าแล้ว</p>
              )}
              <Button onClick={saveSettings} disabled={saving || !name.trim()}>
                {saving
                  ? "กำลังบันทึก…"
                  : createMode
                    ? "สร้างงานบูธ"
                    : "บันทึกการตั้งค่า"}
              </Button>
            </>
          )}
        </div>
      </section>

      {!createMode && booth && (
        <section>
          <div className="px-4 pb-2">
            <h2 className="text-sm font-semibold text-slate-800">สมาชิกทีม</h2>
            <p className="text-xs text-slate-500">
              นักลงทุน / ผู้จัดการ (ลงทุน+ค่าแรง) / พนักงาน (ค่าแรง)
            </p>
          </div>
          <BoothMemberEditor
            boothId={booth.id}
            members={members}
            profitSplitMethod={profitSplitMethod}
            closed={closed}
            currency={currency}
          />
          {!closed && (
            <div className="px-4 pt-4">
              {error && (
                <p className="mb-2 text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
              <Button onClick={finishSetup} disabled={saving || !name.trim()}>
                {saving ? "กำลังบันทึก…" : "เสร็จสิ้น"}
              </Button>
            </div>
          )}
        </section>
      )}

      {createMode && (
        <p className="px-4 text-sm text-slate-500">
          หลังสร้างงานบูธ จะเพิ่มสมาชิกในหน้านี้ทันที — ไม่ต้องเปลี่ยนหน้า
        </p>
      )}
    </div>
  );
}

/** Compact remaining-budget strip for expense form. */
export function BoothRemainingBar({
  totalBudget,
  totalExpense,
  currency = "THB",
}: {
  totalBudget: string;
  totalExpense: string;
  currency?: string;
}) {
  const remaining = computeProfit(totalBudget, totalExpense);
  const sign = moneySign(remaining);
  const color =
    sign < 0 ? "text-red-600" : sign > 0 ? "text-emerald-700" : "text-slate-700";

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">งบคงเหลือ</p>
          <p className="text-xs text-slate-400">
            งบรวม {formatMoney(totalBudget, currency)} − ใช้ไป{" "}
            {formatMoney(totalExpense, currency)}
          </p>
        </div>
        <p className={`text-xl font-bold tabular-nums ${color}`}>
          {formatMoney(remaining, currency)}
        </p>
      </div>
    </div>
  );
}
