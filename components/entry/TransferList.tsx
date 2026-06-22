"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { TRANSFER_DIRECTION_LABELS, type MoneyTransfer } from "@/types";
import { ArrowLeftRight } from "lucide-react";

export function TransferList({
  transfers,
  currency = "THB",
  emptyHint = "ยังไม่มีรายการย้ายเงิน",
}: {
  transfers: MoneyTransfer[];
  currency?: string;
  emptyHint?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<MoneyTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = transfers.filter((t) => !removed.has(t.id));

  async function confirmDelete() {
    if (!pending || deleting) return;
    setDeleting(pending.id);
    setError(null);
    const res = await fetch(`/api/transfer/${pending.id}`, { method: "DELETE" });
    if (res.ok) {
      setRemoved((prev) => new Set(prev).add(pending.id));
      setPending(null);
      router.refresh();
    } else {
      setError("ลบรายการไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
    setDeleting(null);
  }

  if (visible.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-rz-hint">{emptyHint}</p>;
  }

  return (
    <>
      {error && (
        <p className="px-4 py-2 text-center text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-rz-border">
        {visible.map((t) => {
          const title = t.note
            ? `${TRANSFER_DIRECTION_LABELS[t.direction]} · ${t.note}`
            : TRANSFER_DIRECTION_LABELS[t.direction];
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rz-blue/15 text-rz-blue">
                <ArrowLeftRight size={16} strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-rz-text">{title}</p>
                <p className="text-[10px] text-rz-hint">{t.entryDate}</p>
              </div>
              <span className="rz-tabular shrink-0 text-[13px] font-medium text-rz-blue">
                {formatMoney(t.amount, currency)}
              </span>
              <button
                onClick={() => setPending(t)}
                disabled={deleting === t.id}
                aria-label={`Delete ${title}`}
                className="tap-target -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated disabled:opacity-40"
              >
                {deleting === t.id ? "…" : "✕"}
              </button>
            </li>
          );
        })}
      </ul>

      {pending && (
        <DeleteConfirm
          title={TRANSFER_DIRECTION_LABELS[pending.direction]}
          amount={formatMoney(pending.amount, currency)}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
          busy={deleting === pending.id}
        />
      )}
    </>
  );
}
