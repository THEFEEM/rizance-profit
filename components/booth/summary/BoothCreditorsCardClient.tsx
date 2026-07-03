"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntryField } from "@/components/entry/EntryField";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { SetupPrimaryButton } from "@/components/booth/setup/SetupField";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { formatMoney, toCents } from "@/lib/money";
import type { BoothCreditorRow } from "@/lib/advance-creditors";
import type { CreditorRepayment } from "@/types/shop";
import type { PayerKind } from "@/types";

const KIND_LABELS: Record<PayerKind, string> = {
  member: "สมาชิก",
  external: "บุคคลภายนอก",
};

type BoothCreditorDisplayRow = BoothCreditorRow & { payerKind: PayerKind };

function BoothCreditorRowItem({
  row,
  boothId,
  currency,
  cashOnHand,
  panel,
  onOpen,
  onClose,
}: {
  row: BoothCreditorDisplayRow;
  boothId: string;
  currency: string;
  cashOnHand: string;
  panel: BoothCreditorDisplayRow | null;
  onOpen: (row: BoothCreditorDisplayRow) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amountRaw, setAmountRaw] = useState("");
  const [padOpen, setPadOpen] = useState(false);
  const [note, setNote] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDate = today();
  const isPaidOff = toCents(row.remaining) <= 0;
  const paidPercent =
    toCents(row.owed) > 0
      ? Math.round((toCents(row.paid) / toCents(row.owed)) * 100)
      : isPaidOff
        ? 100
        : 0;
  const isOpen = panel?.name === row.name && panel?.payerKind === row.payerKind;
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

  async function submitRepayment() {
    const amount = amountRaw === "" ? 0 : Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await apiFetch<CreditorRepayment>(
      `/api/booths/${boothId}/creditor-repayment`,
      {
        method: "POST",
        body: JSON.stringify({
          payerKind: row.payerKind,
          payerName: row.name,
          amount,
          paymentMethod: "cash",
          note: note.trim() || undefined,
          entryDate,
        }),
      },
    );

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
          จ่ายแล้ว {formatMoney(row.paid, currency)} · เหลือ{" "}
          {formatMoney(row.remaining, currency)}
        </span>
        {isPaidOff ? (
          <span className="shrink-0 text-xs text-rz-hint">คืนครบแล้ว</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAmountRaw(row.remaining);
              setPadOpen(false);
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
          <p className="rz-tabular mb-3 text-xs text-rz-hint">
            เงินคงเหลือ {formatMoney(cashOnHand, currency)}
          </p>
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
              {saving ? "กำลังบันทึก…" : "บันทึก"}
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
  title,
  rows,
  boothId,
  currency,
  cashOnHand,
  panel,
  onOpen,
  onClose,
}: {
  title: string;
  rows: BoothCreditorDisplayRow[];
  boothId: string;
  currency: string;
  cashOnHand: string;
  panel: BoothCreditorDisplayRow | null;
  onOpen: (row: BoothCreditorDisplayRow) => void;
  onClose: () => void;
}) {
  if (rows.length === 0) return null;
  const subtotalCents = rows.reduce((sum, row) => sum + toCents(row.remaining), 0);

  return (
    <div className="border-b-[0.5px] border-rz-border last:border-b-0">
      <p className="bg-rz-elevated/30 px-4 py-2 text-xs font-medium text-rz-muted">
        {title}
      </p>
      <ul className="divide-y divide-rz-border">
        {rows.map((row) => (
          <BoothCreditorRowItem
            key={`${row.payerKind}-${row.name}`}
            row={row}
            boothId={boothId}
            currency={currency}
            cashOnHand={cashOnHand}
            panel={panel}
            onOpen={onOpen}
            onClose={onClose}
          />
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/20 px-4 py-2.5 text-sm">
        <span className="text-rz-muted">รวมเหลือ{title}</span>
        <span className="font-medium rz-tabular text-rz-red">
          {formatMoney((subtotalCents / 100).toFixed(2), currency)}
        </span>
      </div>
    </div>
  );
}

export function BoothCreditorsCard({
  boothId,
  rows,
  cashOnHand,
  currency = "THB",
}: {
  boothId: string;
  rows: BoothCreditorDisplayRow[];
  cashOnHand: string;
  currency?: string;
}) {
  const [panel, setPanel] = useState<BoothCreditorDisplayRow | null>(null);

  if (rows.length === 0) return null;

  const memberRows = rows.filter((row) => row.payerKind === "member");
  const externalRows = rows.filter((row) => row.payerKind === "external");
  const totalRemainingCents = rows.reduce((sum, row) => sum + toCents(row.remaining), 0);

  return (
    <section className="mt-4 px-4">
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <GroupBlock
          title="สมาชิก"
          rows={memberRows}
          boothId={boothId}
          currency={currency}
          cashOnHand={cashOnHand}
          panel={panel}
          onOpen={setPanel}
          onClose={() => setPanel(null)}
        />
        <GroupBlock
          title="บุคคลภายนอก"
          rows={externalRows}
          boothId={boothId}
          currency={currency}
          cashOnHand={cashOnHand}
          panel={panel}
          onOpen={setPanel}
          onClose={() => setPanel(null)}
        />
        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3 text-sm">
          <span className="text-rz-muted">รวมเหลือต้องคืนทั้งหมด</span>
          <span className="font-medium rz-tabular text-rz-red">
            {formatMoney((totalRemainingCents / 100).toFixed(2), currency)}
          </span>
        </div>
      </div>
    </section>
  );
}
