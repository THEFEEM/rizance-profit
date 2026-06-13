import {
  AlertIcon,
  BankIcon,
  CheckIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/booth/summary/icons";
import { computeProfit, formatMoney, moneySign } from "@/lib/money";
import type { BoothSummary } from "@/types/booth";

function IconTile({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  const bg =
    tone === "blue"
      ? "bg-[#15293F] text-rz-blue"
      : tone === "green"
        ? "bg-[#16352A] text-rz-green"
        : tone === "red"
          ? "bg-[#2E1A1A] text-rz-red"
          : "bg-rz-elevated text-rz-muted";
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-rz-border ${bg}`}
    >
      {children}
    </span>
  );
}

function BudgetRow({
  icon,
  iconTone = "neutral",
  label,
  value,
  currency,
  indent = false,
  valueMuted = false,
}: {
  icon: React.ReactNode;
  iconTone?: "neutral" | "blue" | "green" | "red";
  label: string;
  value: string;
  currency: string;
  indent?: boolean;
  valueMuted?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 py-3 ${indent ? "pl-6" : ""}`}>
      <IconTile tone={iconTone}>{icon}</IconTile>
      <span className="min-w-0 flex-1 text-sm text-rz-muted">{label}</span>
      <span
        className={`rz-tabular text-sm font-medium ${valueMuted ? "text-rz-muted" : "text-rz-text"}`}
      >
        {formatMoney(value, currency)}
      </span>
    </div>
  );
}

export function BoothSummaryBudgetCard({
  summary,
  currency = "THB",
}: {
  summary: BoothSummary;
  currency?: string;
}) {
  const { booth } = summary;
  const hasEquity = moneySign(booth.memberEquity) > 0;
  const remaining = computeProfit(booth.totalBudget, summary.totalExpense);
  const remSign = moneySign(remaining);
  const remColor = remSign < 0 ? "text-rz-red" : remSign > 0 ? "text-rz-green" : "text-rz-text";
  const remSub =
    remSign < 0
      ? `ใช้ไป ${formatMoney(summary.totalExpense, currency)} · เกินงบ`
      : `ใช้ไป ${formatMoney(summary.totalExpense, currency)} · เหลือ`;

  return (
    <section className="px-4">
      <h2 className="mb-2 text-sm font-medium text-rz-muted">งบรวม (อ้างอิง)</h2>
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <div className="divide-y divide-rz-border px-4">
          <BudgetRow
            icon={<WalletIcon />}
            label="งบทั้งหมด"
            value={booth.totalBudget}
            currency={currency}
          />
          <BudgetRow
            icon={<BankIcon />}
            iconTone="blue"
            label="↳ กองกลาง"
            value={booth.poolBudget}
            currency={currency}
            indent
            valueMuted
          />
          {hasEquity && (
            <BudgetRow
              icon={<UsersIcon />}
              iconTone="blue"
              label="↳ สมาชิกลงทุน"
              value={booth.memberEquity}
              currency={currency}
              indent
              valueMuted
            />
          )}
        </div>
        <div
          className={`mx-3 mb-3 mt-1 rounded-[11px] border-[0.5px] px-3 py-3 ${
            remSign < 0
              ? "border-rz-red/30 bg-rz-red/5"
              : "border-rz-green/30 bg-rz-green/5"
          }`}
        >
          <div className="flex items-center gap-3">
            <IconTile tone={remSign < 0 ? "red" : "green"}>
              {remSign < 0 ? <AlertIcon /> : <CheckIcon />}
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-rz-text">งบคงเหลือ</p>
              <p className="text-xs text-rz-hint">{remSub}</p>
            </div>
            <p className={`rz-tabular text-base font-medium ${remColor}`}>
              {formatMoney(remaining, currency)}
            </p>
          </div>
        </div>
        {booth.poolGetsShare && (
          <p className="border-t-[0.5px] border-rz-border px-4 py-2 text-xs text-rz-blue">
            กองกลางรับส่วนแบ่งกำไร
          </p>
        )}
        <p className="border-t-[0.5px] border-rz-border px-4 py-2 text-xs text-rz-hint">
          แสดงเพื่ออ้างอิง — ไม่หักจากกำไร
        </p>
      </div>
    </section>
  );
}
