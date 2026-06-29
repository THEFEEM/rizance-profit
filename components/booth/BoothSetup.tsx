"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { BoothMemberEditor } from "@/components/booth/BoothMemberEditor";
import {
  SetupField,
  SetupPrimaryButton,
  SetupSecondaryButton,
  SetupTextarea,
} from "@/components/booth/setup/SetupField";
import { BankIcon, CalendarIcon, PieChartIcon, TagIcon } from "@/components/booth/setup/icons";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { SHOW_PARTNERS_SECTION } from "@/lib/feature-flags";
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
  const totalBudget = SHOW_PARTNERS_SECTION ? poolNum + memberEquity : poolNum;

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
    <div className="flex flex-col gap-6 pb-8">
      <div className="px-4">
        <SetupField
          label="ชื่องาน / บูธ"
          icon={<TagIcon />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="เช่น งานวัดปากน้ำ 3 วัน"
          disabled={closed}
        />
      </div>

      <section className="px-4">
        <h2 className="mb-2 text-sm font-medium text-rz-muted">โครงสร้างทุน</h2>
        <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <div className="space-y-4 px-4 py-4">
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-xs text-rz-muted">
                <span className="text-rz-blue">
                  <BankIcon />
                </span>
                งบกองกลาง (บาท)
              </label>
              <p className="mb-2 text-xs text-rz-hint">ทุนสนับสนุน / เงินสำรองร้าน</p>
              <p className="rz-tabular text-2xl font-medium text-rz-text">
                {formatTyped(poolBudgetRaw) || "0"}
              </p>
              {!closed &&
                (padBudget ? (
                  <QuickAmountPad
                    value={poolBudgetRaw}
                    onChange={setPoolBudgetRaw}
                    onSave={() => setPadBudget(false)}
                    saveLabel="ตกลง"
                    accent="amber"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPadBudget(true)}
                    className="tap-target mt-2 text-sm font-medium text-rz-green"
                  >
                    ใส่จำนวน →
                  </button>
                ))}
            </div>

            {SHOW_PARTNERS_SECTION && (
            <label
              className={`flex items-start gap-3 rounded-[11px] border-[0.5px] px-4 py-3 transition-colors ${
                poolGetsShare
                  ? "border-[#1E3A52] bg-[#15293F]/60"
                  : "border-rz-border bg-rz-elevated/50"
              }`}
            >
              <input
                type="checkbox"
                checked={poolGetsShare}
                disabled={closed}
                onChange={(e) => setPoolGetsShare(e.target.checked)}
                className="mt-1 h-4 w-4 accent-rz-blue"
              />
              <span>
                <span className="text-sm font-medium text-rz-text">กองกลางรับส่วนแบ่งกำไร</span>
                <span className="mt-0.5 block text-xs text-rz-hint">
                  น้ำหนักตามงบกองกลาง · ส่วนแบ่งแสดงเป็น &quot;เข้ากองกลาง&quot;
                </span>
              </span>
            </label>
            )}

            <div className="rounded-[11px] border-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-rz-blue">กองกลาง</span>
                <span className="rz-tabular font-medium text-rz-muted">
                  {formatMoney(String(poolNum), currency)}
                </span>
              </div>
              {SHOW_PARTNERS_SECTION && (
              <div className="mt-1.5 flex justify-between">
                <span className="text-rz-blue">สมาชิกลงทุน</span>
                <span className="rz-tabular font-medium text-rz-muted">
                  {formatMoney(String(memberEquity.toFixed(2)), currency)}
                </span>
              </div>
              )}
              <div className={`flex justify-between ${SHOW_PARTNERS_SECTION ? "mt-2 border-t-[0.5px] border-rz-border pt-2" : "mt-1.5"}`}>
                <span className="font-medium text-rz-text">งบรวม</span>
                <span className="rz-tabular text-base font-medium text-rz-green">
                  {formatMoney(String(totalBudget.toFixed(2)), currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {SHOW_PARTNERS_SECTION && (
      <section className="px-4">
        <label className="mb-2 flex items-center gap-2 text-sm font-medium text-rz-muted">
          <span className="text-rz-hint">
            <PieChartIcon />
          </span>
          วิธีแบ่งกำไร
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PROFIT_SPLIT_METHODS.map((m) => (
            <EntryOptionButton
              key={m}
              selected={profitSplitMethod === m}
              disabled={closed}
              onClick={() => setProfitSplitMethod(m)}
              accent="green"
              layout="row"
              className="text-center"
            >
              {PROFIT_SPLIT_METHOD_LABELS[m]}
            </EntryOptionButton>
          ))}
        </div>
      </section>
      )}

      {SHOW_PARTNERS_SECTION && !createMode && booth && (
        <BoothMemberEditor
          boothId={booth.id}
          members={members}
          profitSplitMethod={profitSplitMethod}
          closed={closed}
          currency={currency}
        />
      )}

      <section className="grid grid-cols-2 gap-3 px-4">
        <SetupField
          label="วันเริ่ม"
          icon={<CalendarIcon />}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={closed}
        />
        <SetupField
          label="วันสิ้นสุด"
          icon={<CalendarIcon />}
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
          disabled={closed}
        />
      </section>

      <div className="px-4">
        <SetupTextarea
          label="หมายเหตุ (ไม่บังคับ)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={closed}
        />
      </div>

      {!closed && (
        <div className="space-y-3 px-4">
          {error && (
            <p className="text-sm text-rz-red" role="alert">
              {error}
            </p>
          )}
          {savedFlash && !createMode && (
            <p className="text-sm text-rz-green">บันทึกการตั้งค่าแล้ว</p>
          )}

          {createMode ? (
            <>
              <SetupPrimaryButton onClick={saveSettings} disabled={saving || !name.trim()}>
                {saving ? "กำลังบันทึก…" : "สร้างงานบูธ"}
              </SetupPrimaryButton>
              {SHOW_PARTNERS_SECTION && (
              <p className="text-center text-sm text-rz-hint">
                หลังสร้างงานบูธ จะเพิ่มสมาชิกในหน้านี้ทันที — ไม่ต้องเปลี่ยนหน้า
              </p>
              )}
            </>
          ) : (
            <>
              <SetupSecondaryButton onClick={saveSettings} disabled={saving || !name.trim()}>
                {saving ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
              </SetupSecondaryButton>
              <SetupPrimaryButton onClick={finishSetup} disabled={saving || !name.trim()}>
                {saving ? "กำลังบันทึก…" : "เสร็จสิ้น"}
              </SetupPrimaryButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared งบคงเหลือ = totalBudget − totalExpense (incl. wages). */
export function BoothRemainingBudget({
  totalBudget,
  totalExpense,
  currency = "THB",
  variant = "bar",
  appearance = "default",
}: {
  totalBudget: string;
  totalExpense: string;
  currency?: string;
  /** bar = expense form strip; inline = summary capital section */
  variant?: "bar" | "inline";
  /** entry = dark +In/−Out expense form; hub = dark inline on booth hub summary card */
  appearance?: "default" | "entry" | "hub";
}) {
  const remaining = computeProfit(totalBudget, totalExpense);
  const sign = moneySign(remaining);
  const isDark = appearance === "entry" || appearance === "hub";
  const color = isDark
    ? sign < 0
      ? "text-rz-red"
      : sign > 0
        ? "text-rz-green"
        : "text-rz-text"
    : sign < 0
      ? "text-red-600"
      : sign > 0
        ? "text-emerald-700"
        : "text-slate-700";

  const labelMuted =
    appearance === "entry" || appearance === "hub"
      ? "text-sm text-rz-muted"
      : variant === "inline"
        ? "text-sm text-slate-600"
        : "text-xs text-slate-500";
  const subMuted = isDark ? "text-rz-hint" : "text-xs text-slate-400";

  const body = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className={variant === "inline" && appearance === "default" ? "text-sm text-slate-600" : labelMuted}>
          งบคงเหลือ
        </p>
        <p className={`text-xs ${subMuted}`}>
          งบรวม {formatMoney(totalBudget, currency)} − ใช้ไป{" "}
          {formatMoney(totalExpense, currency)}
        </p>
      </div>
      <p
        className={`font-medium tabular-nums ${color} ${variant === "inline" ? "text-base" : "text-xl"}`}
      >
        {formatMoney(remaining, currency)}
      </p>
    </div>
  );

  if (variant === "inline") {
    return (
      <div
        className={`mt-3 pt-3 ${
          appearance === "hub"
            ? "border-t-[0.5px] border-rz-border"
            : "border-t border-slate-100"
        }`}
      >
        {body}
      </div>
    );
  }

  if (appearance === "entry") {
    return (
      <div className="mx-4 mb-3 rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
        {body}
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {body}
    </div>
  );
}

/** Compact remaining-budget strip for expense form. */
export function BoothRemainingBar(props: {
  totalBudget: string;
  totalExpense: string;
  currency?: string;
  appearance?: "default" | "entry";
}) {
  return <BoothRemainingBudget {...props} variant="bar" />;
}
