import Link from "next/link";
import { boothNetBalance, BoothNetBalanceRow } from "@/components/booth/BoothNetBalance";
import { BoothRemainingBudget } from "@/components/booth/BoothSetup";
import { formatMoney, moneySign } from "@/lib/money";
import type { BoothSummary, SplitProfitResult } from "@/types/booth";
import { PROFIT_SPLIT_METHOD_LABELS } from "@/types/booth";

function SummaryLine({
  label,
  amount,
  currency,
  tone = "neutral",
  indent = false,
}: {
  label: string;
  amount: string;
  currency: string;
  tone?: "income" | "expense" | "neutral" | "muted";
  indent?: boolean;
}) {
  const color =
    tone === "income"
      ? "text-rz-green"
      : tone === "expense"
        ? "text-rz-red"
        : tone === "muted"
          ? "text-rz-hint"
          : "text-rz-text";

  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${indent ? "pl-3" : ""}`}>
      <span className={`text-sm ${tone === "muted" ? "text-rz-hint" : "text-rz-muted"}`}>
        {label}
      </span>
      <span className={`rz-tabular text-sm font-medium ${color}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

/** Compact P&L preview on booth hub (closed) — dark fintech styling. */
export function BoothSummaryCard({
  summary,
  split,
  currency = "THB",
  compact = false,
  boothId,
}: {
  summary: BoothSummary;
  split?: SplitProfitResult | null;
  currency?: string;
  compact?: boolean;
  boothId?: string;
}) {
  const sign = moneySign(summary.profit);
  const profitColor =
    sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";

  const { booth } = summary;
  const hasEquity = moneySign(booth.memberEquity) > 0;
  const { remainingBudget, netBalance } = boothNetBalance(
    booth.totalBudget,
    summary.totalExpense,
    summary.totalIncome,
  );

  return (
    <div className={compact ? "" : "px-4 pb-6"}>
      {!compact && (
        <section className="py-6 text-center">
          <p className="text-sm font-medium text-rz-muted">กำไร/ขาดทุน</p>
          <p className={`mt-2 break-all text-5xl font-medium leading-tight rz-tabular ${profitColor}`}>
            {formatMoney(summary.profit, currency)}
          </p>
        </section>
      )}

      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <div className="border-b-[0.5px] border-rz-border px-4 py-3">
          <SummaryLine
            label="งบรวม (อ้างอิง)"
            amount={booth.totalBudget}
            currency={currency}
            tone="muted"
          />
          <SummaryLine
            label="กองกลาง"
            amount={booth.poolBudget}
            currency={currency}
            tone="muted"
            indent
          />
          {hasEquity && (
            <SummaryLine
              label="สมาชิกลงทุน"
              amount={booth.memberEquity}
              currency={currency}
              tone="muted"
              indent
            />
          )}
          {booth.poolGetsShare && (
            <p className="text-xs text-rz-blue">กองกลางรับส่วนแบ่งกำไร</p>
          )}
          <p className="text-xs text-rz-hint">แสดงเพื่ออ้างอิง — ไม่หักจากกำไร</p>
          <BoothRemainingBudget
            totalBudget={booth.totalBudget}
            totalExpense={summary.totalExpense}
            currency={currency}
            variant="inline"
            appearance="hub"
          />
        </div>

        <div className="border-b-[0.5px] border-rz-border px-4 py-1">
          {!compact && (
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-rz-hint">รายรับ</p>
          )}
          <SummaryLine
            label="รายรับเงินสด"
            amount={summary.cashIncome}
            currency={currency}
            tone="income"
          />
          <SummaryLine
            label="รายรับโอน"
            amount={summary.transferIncome}
            currency={currency}
            tone="income"
          />
          <SummaryLine
            label="รายรับรวม"
            amount={summary.totalIncome}
            currency={currency}
            tone="income"
          />
        </div>

        <div className="border-b-[0.5px] border-rz-border px-4 py-1">
          {!compact && (
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-rz-hint">
              ค่าใช้จ่าย
            </p>
          )}
          <SummaryLine
            label="ค่าใช้จ่ายคงที่"
            amount={summary.fixedExpense}
            currency={currency}
            tone="expense"
          />
          <SummaryLine
            label="ค่าใช้จ่ายผันแปร"
            amount={summary.variableExpense}
            currency={currency}
            tone="expense"
          />
          {moneySign(summary.wageCost) > 0 && (
            <SummaryLine
              label="ค่าแรง (คำนวณ)"
              amount={summary.wageCost}
              currency={currency}
              tone="expense"
            />
          )}
          <SummaryLine
            label="ค่าใช้จ่ายรวม"
            amount={summary.totalExpense}
            currency={currency}
            tone="expense"
          />
        </div>

        {compact && (
          <BoothNetBalanceRow
            remainingBudget={remainingBudget}
            totalIncome={summary.totalIncome}
            netBalance={netBalance}
            currency={currency}
          />
        )}

        {split && !compact && (
          <div className="border-b-[0.5px] border-rz-border px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-rz-hint">
              แบ่งกำไร (ตัวอย่าง)
            </p>
            <p className="mt-1 text-sm text-rz-muted">
              {PROFIT_SPLIT_METHOD_LABELS[split.method]}
              {split.poolGetsShare && moneySign(split.poolShare.flooredShare) > 0 && (
                <> · กอง {formatMoney(split.poolShare.flooredShare, currency)}</>
              )}
              {split.memberShares
                .filter((s) => (s.role === "investor" || s.role === "manager") && moneySign(s.flooredShare) > 0)
                .map((s) => ` · ${s.name} ${formatMoney(s.flooredShare, currency)}`)
                .join("")}
            </p>
            {moneySign(split.remainder) !== 0 && (
              <p className="mt-1 text-xs text-rz-hint">
                เศษเข้ากองกลาง {formatMoney(split.remainder, currency)}
              </p>
            )}
            {split.warning && (
              <p className="mt-1 text-xs text-rz-amber">{split.warning}</p>
            )}
          </div>
        )}

        {compact && (
          <div className="px-4 py-4 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-rz-hint">
              กำไร/ขาดทุน
            </p>
            <p className={`mt-1 text-3xl font-medium rz-tabular ${profitColor}`}>
              {formatMoney(summary.profit, currency)}
            </p>
            {sign < 0 && (
              <p className="mt-1 text-sm font-medium text-rz-red">ขาดทุน</p>
            )}
            {split && boothId && (
              <Link
                href={`/booth/${boothId}/summary`}
                className="tap-target mt-2 inline-block text-xs font-medium text-rz-amber active:opacity-90"
              >
                ดูการแบ่งกำไร →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
