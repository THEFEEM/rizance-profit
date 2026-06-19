"use client";

import type { ProjectFundingKey } from "@/lib/project-categories";
import { formatMoney } from "@/lib/money";
import { FUNDING_SOURCE_UI } from "@/lib/project-ui";
import type { FundBalance } from "@/types/project";
import { ProjectIconBox } from "@/components/project/icons";

function fundBalanceLabel(fund: FundBalance | undefined, currency: string): string {
  if (!fund || (Number(fund.totalReceived) === 0 && Number(fund.totalSpent) === 0)) {
    return "ยังไม่มีรายรับ";
  }
  if (fund.isOverspent) {
    return `เกิน ${formatMoney(fund.remaining, currency)}`;
  }
  return `เหลือ ${formatMoney(fund.remaining, currency)}`;
}

export function FundSourceBalanceGrid({
  value,
  onChange,
  fundBreakdown,
  disabled,
  currency = "THB",
}: {
  value: ProjectFundingKey | null;
  onChange: (key: ProjectFundingKey | null) => void;
  fundBreakdown: FundBalance[];
  disabled?: boolean;
  currency?: string;
}) {
  const byKey = Object.fromEntries(fundBreakdown.map((f) => [f.sourceKey, f]));

  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="แหล่งเงินทุน">
      {FUNDING_SOURCE_UI.map((tile) => {
        const selected = value === tile.key;
        const fund = byKey[tile.key];
        const balanceText = fundBalanceLabel(fund, currency);
        const overspent = fund?.isOverspent ?? false;

        return (
          <button
            key={tile.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(tile.key)}
            className={`tap-target flex flex-col items-start gap-1.5 rounded-[12px] px-3 py-3 text-left transition-colors disabled:opacity-50 ${
              tile.dashed
                ? selected
                  ? "border border-dashed border-rz-purple-border bg-rz-purple-bg"
                  : "border border-dashed border-rz-border bg-rz-card active:bg-rz-elevated"
                : selected
                  ? "border-[0.5px] border-rz-purple-border bg-rz-purple-bg"
                  : "border-[0.5px] border-rz-border bg-rz-card active:bg-rz-elevated"
            }`}
          >
            <div className="flex w-full items-center gap-2">
              <ProjectIconBox name={tile.icon} color={tile.color} bg={tile.bg} size={28} />
              <span
                className={`text-xs font-medium leading-tight ${
                  selected ? "text-rz-purple" : "text-rz-text"
                }`}
              >
                {tile.label}
              </span>
            </div>
            <span
              className={`text-[11px] rz-tabular ${
                overspent ? "text-rz-red" : "text-rz-hint"
              }`}
            >
              {balanceText}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={`tap-target col-span-2 flex flex-col items-start gap-1 rounded-[12px] border-[0.5px] border-dashed px-3 py-3 text-left transition-colors disabled:opacity-50 ${
          value === null
            ? "border-rz-purple-border bg-rz-purple-bg"
            : "border-rz-border bg-rz-card active:bg-rz-elevated"
        }`}
      >
        <span className={`text-xs font-medium ${value === null ? "text-rz-purple" : "text-rz-text"}`}>
          ไม่ระบุ (กองกลาง)
        </span>
        <span className="text-[11px] text-rz-hint">ไม่ผูกกับกองเงินเฉพาะ</span>
      </button>
    </div>
  );
}
