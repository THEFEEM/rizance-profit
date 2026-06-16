"use client";

import { PAYMENT_STATUS_UI } from "@/lib/project-ui";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/types/project";

export function PaymentStatusPicker({
  value,
  onChange,
  disabled,
}: {
  value: PaymentStatus;
  onChange: (value: PaymentStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-rz-muted">สถานะ</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="สถานะการจ่าย">
        {PAYMENT_STATUSES.map((status) => {
          const cfg = PAYMENT_STATUS_UI[status];
          const selected = value === status;
          return (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(status)}
              className={`tap-target rounded-full border-[0.5px] px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50 ${
                selected
                  ? `${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass} ring-1 ring-rz-blue/50`
                  : `${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass} opacity-75`
              }`}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
