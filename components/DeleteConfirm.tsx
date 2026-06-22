"use client";

import { Button } from "@/components/ui/Button";

/** Confirm dialog before deleting a transaction entry. */
export function DeleteConfirm({
  title,
  amount,
  onConfirm,
  onCancel,
  busy = false,
}: {
  title: string;
  amount: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-title" className="text-lg font-medium text-rz-text">
          ลบรายการนี้?
        </h2>
        <p className="mt-2 text-sm text-rz-muted">
          <span className="font-medium text-rz-text">{title}</span>
          {" "}
          <span className="rz-tabular">{amount}</span>
        </p>
        <p className="mt-1 text-sm text-rz-hint">การลบไม่สามารถกู้คืนได้</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={busy}>
            ยกเลิก
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="tap-target no-select inline-flex w-full items-center justify-center rounded-[11px] border-[0.5px] border-transparent bg-[#DC2626] px-5 text-sm font-medium text-white transition-opacity active:opacity-90 disabled:opacity-40"
          >
            {busy ? "กำลังลบ…" : "ลบ"}
          </button>
        </div>
      </div>
    </div>
  );
}
