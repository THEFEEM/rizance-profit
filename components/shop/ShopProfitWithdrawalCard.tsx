"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { SetupPrimaryButton } from "@/components/booth/setup/SetupField";
import { ROLE_STYLES } from "@/components/booth/summary/role-styles";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { ShopOnHand } from "@/lib/shop-on-hand";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/types/booth";
import {
  SHOP_MEMBER_ROLE_LABELS,
  type MemberProfitWithdrawable,
  type ProfitWithdrawal,
} from "@/types/shop";

export function ShopProfitWithdrawalCard({
  members: initialMembers,
  onHand,
  currency = "THB",
  variant = "full",
}: {
  members: MemberProfitWithdrawable[];
  onHand: ShopOnHand;
  currency?: string;
  variant?: "full" | "compact";
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [panel, setPanel] = useState<MemberProfitWithdrawable | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [padOpen, setPadOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDate = today();

  if (members.length === 0) return null;

  function openPanel(m: MemberProfitWithdrawable) {
    setPanel(m);
    setAmountRaw("");
    setPadOpen(false);
    setPaymentMethod("cash");
    setNote("");
    setEntryDate(today());
    setError(null);
  }

  function closePanel() {
    setPanel(null);
    setError(null);
  }

  async function refreshMembers() {
    const res = await apiFetch<MemberProfitWithdrawable[]>("/api/shop/profit-withdrawable");
    if (res.ok) setMembers(res.data);
  }

  async function submitWithdrawal() {
    if (!panel) return;
    const amount = amountRaw === "" ? 0 : Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await apiFetch<ProfitWithdrawal>("/api/shop/profit-withdrawal", {
      method: "POST",
      body: JSON.stringify({
        memberId: panel.memberId,
        amount,
        paymentMethod,
        note: note.trim() || undefined,
        entryDate,
      }),
    });

    if (res.ok) {
      closePanel();
      await refreshMembers();
      router.refresh();
    } else {
      setError(res.message);
    }
    setSaving(false);
  }

  const sectionClass = variant === "compact" ? "px-4 pt-3" : "mt-6 px-4";
  const selectedOnHand =
    paymentMethod === "cash" ? onHand.cashOnHand : onHand.transferOnHand;

  return (
    <section className={sectionClass}>
      <h2 className="mb-2 text-sm font-medium text-rz-green">ถอนส่วนแบ่งกำไร</h2>
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <ul className="divide-y divide-rz-border">
          {members.map((m) => (
            <li key={m.memberId} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-rz-text">{m.name}</p>
                  <p className={`text-xs ${ROLE_STYLES[m.role].text}`}>
                    {SHOP_MEMBER_ROLE_LABELS[m.role]} · ลงทุน{" "}
                    {formatMoney(m.investmentAmount, currency)}
                  </p>
                  <p className="mt-1 text-xs text-rz-hint">
                    ส่วนแบ่งสะสม {formatMoney(m.accumulatedShare, currency)}
                    {Number(m.withdrawn) > 0 && (
                      <> · ถอนแล้ว {formatMoney(m.withdrawn, currency)}</>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-rz-hint">ถอนได้อีก</p>
                  <p className="rz-tabular text-sm font-medium text-rz-green">
                    {formatMoney(m.available, currency)}
                  </p>
                  <button
                    type="button"
                    onClick={() => openPanel(m)}
                    disabled={Number(m.available) <= 0}
                    className="tap-target mt-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-rz-green active:bg-rz-elevated disabled:text-rz-hint"
                  >
                    ถอน
                  </button>
                </div>
              </div>

              {panel?.memberId === m.memberId && (
                <div className="mt-3 rounded-[10px] border-[0.5px] border-rz-border bg-rz-elevated p-3">
                  <p className="mb-2 text-xs text-rz-hint">
                    ถอนส่วนแบ่งกำไร (หักจากเงินคงเหลือ)
                  </p>
                  <p className="rz-tabular mb-2 text-lg font-medium text-rz-text">
                    {formatTyped(amountRaw) || "0"}
                  </p>
                  {padOpen ? (
                    <QuickAmountPad
                      value={amountRaw}
                      onChange={setAmountRaw}
                      onSave={() => setPadOpen(false)}
                      saveLabel="ตกลง"
                      accent="green"
                      saveTone="green"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPadOpen(true)}
                      className="tap-target mb-3 text-sm font-medium text-rz-green"
                    >
                      ใส่จำนวน →
                    </button>
                  )}
                  <div>
                    <p className="mb-1.5 text-xs text-rz-muted">ถอนจาก</p>
                    <div className="flex flex-wrap gap-2">
                      {PAYMENT_METHODS.map((method) => (
                        <EntryOptionButton
                          key={method}
                          selected={paymentMethod === method}
                          onClick={() => setPaymentMethod(method)}
                          accent="green"
                        >
                          {PAYMENT_METHOD_LABELS[method]}
                        </EntryOptionButton>
                      ))}
                    </div>
                    <p className="rz-tabular mt-2 text-xs text-rz-hint">
                      {PAYMENT_METHOD_LABELS[paymentMethod]}คงเหลือ{" "}
                      {formatMoney(selectedOnHand, currency)}
                    </p>
                  </div>
                  <EntryField
                    label="บันทึกเพิ่มเติม (ไม่บังคับ)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={255}
                    accent="green"
                  />
                  <div className="mt-3">
                    <EntryField
                      label="วันที่"
                      type="date"
                      value={entryDate}
                      max={maxDate}
                      onChange={(e) => setEntryDate(e.target.value || maxDate)}
                      accent="green"
                    />
                  </div>
                  {error && (
                    <p className="mt-3 text-sm text-rz-red" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <SetupPrimaryButton onClick={submitWithdrawal} disabled={saving}>
                      {saving ? "กำลังบันทึก…" : "บันทึก"}
                    </SetupPrimaryButton>
                    <button
                      type="button"
                      onClick={closePanel}
                      className="tap-target rounded-[11px] px-4 py-2.5 text-sm text-rz-hint"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
