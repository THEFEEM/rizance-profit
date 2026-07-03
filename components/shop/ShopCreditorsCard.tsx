"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditorRepaymentPaymentToggle } from "@/components/creditors/CreditorRepaymentPaymentToggle";
import { EntryField } from "@/components/entry/EntryField";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { SetupPrimaryButton } from "@/components/booth/setup/SetupField";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { formatMoney, toCents } from "@/lib/money";
import type { CreditorWithRepayment } from "@/types/shop";
import type { ShopOnHand } from "@/lib/shop-on-hand";
import {
  type PaymentMethod,
} from "@/types/booth";
import type { CreditorRepayment } from "@/types/shop";
import type { PayerKind } from "@/types";

const KIND_LABELS: Record<PayerKind, string> = {
  member: "สมาชิก",
  external: "บุคคลภายนอก",
};

function CreditorRow({
  row,
  currency,
  onHand,
  panel,
  onOpen,
  onClose,
}: {
  row: CreditorWithRepayment;
  currency: string;
  onHand: ShopOnHand;
  panel: CreditorWithRepayment | null;
  onOpen: (row: CreditorWithRepayment) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amountRaw, setAmountRaw] = useState("");
  const [padOpen, setPadOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDate = today();
  const isPaidOff = Number(row.remaining) <= 0;
  const paidPercent =
    toCents(row.owed) > 0
      ? Math.round((toCents(row.repaid) / toCents(row.owed)) * 100)
      : isPaidOff
        ? 100
        : 0;
  const isOpen =
    panel?.payerKind === row.payerKind && panel?.name === row.name;
  const barColor = isPaidOff
    ? "bg-rz-green"
    : paidPercent === 0
      ? "bg-rz-red"
      : "bg-[#FBBF24]";
  const percentColor = isPaidOff
    ? "text-rz-green"
    : paidPercent === 0
      ? "text-rz-red"
      : "text-[#FBBF24]";
  const selectedOnHand =
    paymentMethod === "cash" ? onHand.cashOnHand : onHand.transferOnHand;

  async function submitRepayment() {
    const amount = amountRaw === "" ? 0 : Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await apiFetch<CreditorRepayment>("/api/shop/creditor-repayment", {
      method: "POST",
      body: JSON.stringify({
        payerKind: row.payerKind,
        payerName: row.name,
        amount,
        paymentMethod,
        note: note.trim() || undefined,
        entryDate,
      }),
    });

    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      setError(res.message);
    }
    setSaving(false);
  }

  return (
    <li className={`px-4 py-3 ${isPaidOff ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-rz-text">{row.name}</p>
            <span className="shrink-0 text-xs text-rz-muted rz-tabular">
              ติด {formatMoney(row.owed, currency)}
            </span>
          </div>
          <span className="mt-0.5 inline-block rounded-full bg-rz-elevated px-2 py-0.5 text-[10px] text-rz-muted">
            {KIND_LABELS[row.payerKind]}
          </span>
          {row.count > 0 && (
            <p className="mt-1 text-xs text-rz-hint">{row.count} รายการ advance</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-rz-elevated">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, paidPercent))}%` }}
          role="progressbar"
          aria-valuenow={paidPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className={`mt-1 text-[10px] ${percentColor}`}>{paidPercent}%</p>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="text-xs text-rz-muted">
          จ่ายแล้ว {formatMoney(row.repaid, currency)} · เหลือ{" "}
          {formatMoney(row.remaining, currency)}
        </span>
        {isPaidOff ? (
          <span className="shrink-0 text-xs text-rz-hint">คืนครบแล้ว</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAmountRaw("");
              setPadOpen(false);
              setPaymentMethod("cash");
              setNote("");
              setEntryDate(today());
              setError(null);
              onOpen(row);
            }}
            className="tap-target shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-rz-green active:bg-rz-elevated"
          >
            จ่ายคืน
          </button>
        )}
      </div>

      {isOpen && (
        <div className="mt-3 rounded-[10px] border-[0.5px] border-rz-border bg-rz-elevated p-3">
          <p className="mb-2 text-xs text-rz-hint">
            จ่ายคืนเจ้าหนี้ (หักจากเงินคงเหลือ · คืนได้ไม่เกิน{" "}
            {formatMoney(row.remaining, currency)})
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
              beforeSave={
                <CreditorRepaymentPaymentToggle
                  paymentMethod={paymentMethod}
                  onChange={setPaymentMethod}
                  selectedOnHand={selectedOnHand}
                  currency={currency}
                />
              }
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
            <SetupPrimaryButton onClick={submitRepayment} disabled={saving}>
              {saving ? "กำลังบันทึก…" : "ยืนยันจ่ายคืน"}
            </SetupPrimaryButton>
            <button
              type="button"
              onClick={onClose}
              className="tap-target rounded-[11px] px-4 py-2.5 text-sm text-rz-hint"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function GroupBlock({
  kind,
  rows,
  currency,
  onHand,
  panel,
  onOpen,
  onClose,
}: {
  kind: PayerKind;
  rows: CreditorWithRepayment[];
  currency: string;
  onHand: ShopOnHand;
  panel: CreditorWithRepayment | null;
  onOpen: (row: CreditorWithRepayment) => void;
  onClose: () => void;
}) {
  if (rows.length === 0) return null;
  const subtotal = rows.reduce(
    (sum, r) => sum + Number(r.remaining),
    0,
  );

  return (
    <div className="border-b-[0.5px] border-rz-border last:border-b-0">
      <p className="bg-rz-elevated/30 px-4 py-2 text-xs font-medium text-rz-muted">
        {KIND_LABELS[kind]}
      </p>
      <ul className="divide-y divide-rz-border">
        {rows.map((row) => (
          <CreditorRow
            key={`${row.payerKind}-${row.name}`}
            row={row}
            currency={currency}
            onHand={onHand}
            panel={panel}
            onOpen={onOpen}
            onClose={onClose}
          />
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/20 px-4 py-2.5 text-sm">
        <span className="text-rz-muted">รวมเหลือ{KIND_LABELS[kind]}</span>
        <span className="font-medium rz-tabular text-rz-red">
          {formatMoney(subtotal.toFixed(2), currency)}
        </span>
      </div>
    </div>
  );
}

export function ShopCreditorsCard({
  rows: initialRows,
  onHand,
  totalRemaining,
  currency = "THB",
}: {
  rows: CreditorWithRepayment[];
  onHand: ShopOnHand;
  totalRemaining: string;
  currency?: string;
}) {
  const [panel, setPanel] = useState<CreditorWithRepayment | null>(null);

  if (initialRows.length === 0) return null;

  const memberRows = initialRows.filter((r) => r.payerKind === "member");
  const externalRows = initialRows.filter((r) => r.payerKind === "external");

  function openPanel(row: CreditorWithRepayment) {
    setPanel(row);
  }

  function closePanel() {
    setPanel(null);
  }

  return (
    <section className="mt-4 px-4">
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <GroupBlock
          kind="member"
          rows={memberRows}
          currency={currency}
          onHand={onHand}
          panel={panel}
          onOpen={openPanel}
          onClose={closePanel}
        />
        <GroupBlock
          kind="external"
          rows={externalRows}
          currency={currency}
          onHand={onHand}
          panel={panel}
          onOpen={openPanel}
          onClose={closePanel}
        />
        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3 text-sm">
          <span className="text-rz-muted">รวมเหลือต้องคืนทั้งหมด</span>
          <span className="font-medium rz-tabular text-rz-red">
            {formatMoney(totalRemaining, currency)}
          </span>
        </div>
      </div>
    </section>
  );
}
