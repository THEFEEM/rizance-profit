import Link from "next/link";
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
      ? "text-emerald-600"
      : tone === "expense"
        ? "text-red-600"
        : tone === "muted"
          ? "text-slate-400"
          : "text-slate-700";

  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${indent ? "pl-3" : ""}`}>
      <span className={`text-sm ${tone === "muted" ? "text-slate-400" : "text-slate-600"}`}>
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

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
    sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";

  const { booth } = summary;
  const hasEquity = moneySign(booth.memberEquity) > 0;

  return (
    <div className={compact ? "" : "px-4 pb-6"}>
      {!compact && (
        <section className="py-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            กำไร/ขาดทุน
          </p>
          <p
            className={`mt-2 break-all text-5xl font-extrabold leading-tight tracking-tight ${profitColor}`}
          >
            {formatMoney(summary.profit, currency)}
          </p>
        </section>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
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
            <p className="text-xs text-emerald-700">กองกลางรับส่วนแบ่งกำไร</p>
          )}
          <p className="text-xs text-slate-400">แสดงเพื่ออ้างอิง — ไม่หักจากกำไร</p>
          <BoothRemainingBudget
            totalBudget={booth.totalBudget}
            totalExpense={summary.totalExpense}
            currency={currency}
            variant="inline"
          />
        </div>

        <div className="border-b border-slate-100 px-4 py-1">
          {!compact && (
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              รายรับ
            </p>
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

        <div className="border-b border-slate-100 px-4 py-1">
          {!compact && (
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
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

        {split && !compact && (
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              แบ่งกำไร (ตัวอย่าง)
            </p>
            <p className="mt-1 text-sm text-slate-600">
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
              <p className="mt-1 text-xs text-slate-500">
                เศษเข้ากองกลาง {formatMoney(split.remainder, currency)}
              </p>
            )}
            {split.warning && (
              <p className="mt-1 text-xs text-amber-700">{split.warning}</p>
            )}
          </div>
        )}

        {compact && (
          <div className="px-4 py-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              กำไร/ขาดทุน
            </p>
            <p className={`mt-1 text-3xl font-extrabold tabular-nums ${profitColor}`}>
              {formatMoney(summary.profit, currency)}
            </p>
            {split && boothId && (
              <Link
                href={`/booth/${boothId}/summary`}
                className="tap-target mt-2 inline-block text-xs font-medium text-emerald-700"
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
