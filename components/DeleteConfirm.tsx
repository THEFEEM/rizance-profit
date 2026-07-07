"use client";

import { Button } from "@/components/ui/Button";

/** Confirm dialog before destructive actions (entries, partners, etc.). */
export function DeleteConfirm({
  title,
  amount,
  heading,
  description,
  confirmLabel = "ลบ",
  onConfirm,
  onCancel,
  busy = false,
}: {
  /** Entry label — used when `description` is omitted. */
  title?: string;
  amount?: string;
  /** Dialog title — defaults to "ลบรายการนี้?" */
  heading?: string;
  /** Custom body — replaces default entry summary. */
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const dialogTitle = heading ?? "ลบรายการนี้?";

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
          {dialogTitle}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-rz-muted">{description}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-rz-muted">
              <span className="font-medium text-rz-text">{title}</span>{" "}
              <span className="rz-tabular">{amount}</span>
            </p>
            <p className="mt-1 text-sm text-rz-hint">การลบไม่สามารถกู้คืนได้</p>
          </>
        )}
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
            {busy ? "กำลังลบ…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function partnerDeleteConfirmCopy(name: string): {
  heading: string;
  description: string;
  confirmLabel: string;
} {
  return {
    heading: `ลบหุ้นส่วน ${name}?`,
    description: `ข้อมูลเงินลงทุนและสัดส่วนกำไรของ ${name} จะถูกลบออก การกระทำนี้ไม่สามารถกู้คืนได้`,
    confirmLabel: `ลบ ${name}`,
  };
}
