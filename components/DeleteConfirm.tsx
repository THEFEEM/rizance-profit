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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="delete-title" className="text-lg font-bold text-slate-900">
          Delete entry?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-medium">{title}</span>
          {" · "}
          <span className="tabular-nums">{amount}</span>
        </p>
        <p className="mt-1 text-sm text-slate-500">This cannot be undone.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
