"use client";

import { Button } from "@/components/ui/Button";

/** Inline confirm step before deleting an entry (replaces window.confirm). */
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
    >
      <div className="w-full max-w-sm rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-5 shadow-xl">
        <h2 id="delete-title" className="text-lg font-medium text-rz-text">
          Delete entry?
        </h2>
        <p className="mt-2 text-sm text-rz-muted">
          <span className="font-medium text-rz-text">{title}</span>
          {" · "}
          <span className="rz-tabular">{amount}</span>
        </p>
        <p className="mt-1 text-sm text-rz-hint">This cannot be undone.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" fullWidth onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
