"use client";

import type { ProjectExpenseKey, ProjectFundingKey } from "@/lib/project-categories";
import { EXPENSE_CATEGORY_UI, FUNDING_SOURCE_UI } from "@/lib/project-ui";
import { ProjectIconBox } from "@/components/project/icons";

export function FundingSourceGrid({
  value,
  onChange,
  disabled,
}: {
  value: ProjectFundingKey;
  onChange: (key: ProjectFundingKey) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="แหล่งเงิน">
      {FUNDING_SOURCE_UI.map((tile) => {
        const selected = value === tile.key;
        return (
          <button
            key={tile.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(tile.key)}
            className={`tap-target flex flex-col items-center gap-2 rounded-[12px] px-3 py-3.5 transition-colors disabled:opacity-50 ${
              tile.dashed
                ? selected
                  ? "border border-dashed border-rz-purple-border bg-rz-purple-bg"
                  : "border border-dashed border-rz-border bg-rz-card active:bg-rz-elevated"
                : selected
                  ? "border-[0.5px] border-rz-purple-border bg-rz-purple-bg"
                  : "border-[0.5px] border-rz-border bg-rz-card active:bg-rz-elevated"
            }`}
          >
            <ProjectIconBox name={tile.icon} color={tile.color} bg={tile.bg} size={32} />
            <span
              className={`text-center text-xs font-medium leading-tight ${
                selected ? "text-rz-purple" : "text-rz-text"
              }`}
            >
              {tile.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ExpenseCategoryGrid({
  value,
  onChange,
  disabled,
}: {
  value: ProjectExpenseKey;
  onChange: (key: ProjectExpenseKey) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="หมวดรายจ่าย">
      {EXPENSE_CATEGORY_UI.map((tile) => {
        const selected = value === tile.key;
        return (
          <button
            key={tile.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(tile.key)}
            className={`tap-target flex flex-col items-center gap-1.5 rounded-[12px] border-[0.5px] px-2 py-3 transition-colors disabled:opacity-50 ${
              selected
                ? "border-rz-purple-border bg-rz-purple-bg"
                : "border-rz-border bg-rz-card active:bg-rz-elevated"
            }`}
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${tile.color}22`, color: tile.color }}
            >
              <ProjectIconBox name={tile.icon} color={tile.color} bg="transparent" size={28} />
            </div>
            <span
              className={`text-center text-[11px] font-medium leading-tight ${
                selected ? "text-rz-purple" : "text-rz-text"
              }`}
            >
              {tile.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
