import { formatMoney, moneySign } from "@/lib/money";
import {
  MEMBER_ROLE_LABELS,
  PROFIT_SPLIT_METHOD_LABELS,
  type SplitProfitResult,
} from "@/types/booth";

export function BoothSplitTable({
  split,
  currency = "THB",
}: {
  split: SplitProfitResult;
  currency?: string;
}) {
  const netSign = moneySign(split.netProfit);
  const netColor =
    netSign > 0 ? "text-emerald-600" : netSign < 0 ? "text-red-600" : "text-slate-500";

  const shareMembers = split.memberShares.filter(
    (s) => s.role === "investor" || s.role === "manager",
  );
  const wageOnly = split.memberShares.filter(
    (s) =>
      s.role === "employee" ||
      (s.role === "manager" && s.flooredShare === "0.00" && moneySign(s.wageCost) > 0),
  );

  const showPoolShare =
    split.poolGetsShare && moneySign(split.poolShare.flooredShare) !== 0;
  const showPoolExact =
    split.poolGetsShare && split.poolShare.exactShare !== split.poolShare.flooredShare;
  const showRemainder = moneySign(split.remainder) !== 0;

  return (
    <div className="px-4 pb-6">
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            การแบ่งกำไร
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {PROFIT_SPLIT_METHOD_LABELS[split.method]}
            {split.eventDays > 1 && (
              <span className="text-slate-400"> · {split.eventDays} วัน</span>
            )}
          </p>
        </div>

        <div className="border-b border-slate-100 px-4 py-2">
          <Row label="รายรับรวม" amount={split.totalIncome} currency={currency} tone="income" />
          <Row label="รายจ่าย (รายการ)" amount={split.totalExpense} currency={currency} tone="expense" />
          <Row label="ค่าแรงรวม" amount={split.wageCost} currency={currency} tone="expense" />
          <Row label="กำไรก่อนคืนออกก่อน" amount={split.grossProfit} currency={currency} />
          {split.advanceRepayments.length > 0 && (
            <div className="py-1">
              <p className="text-xs text-slate-500">คืนเงินออกก่อน (FIFO)</p>
              {split.advanceRepayments.map((r) => (
                <Row
                  key={r.creditorKey}
                  label={`↳ ${r.name}${r.role === "external" ? " (ภายนอก)" : ""}`}
                  amount={r.amount}
                  currency={currency}
                  tone="income"
                  small
                />
              ))}
            </div>
          )}
          <Row
            label="กำไรสุทธิ (แบ่ง)"
            amount={split.netProfit}
            currency={currency}
            bold
            className={netColor}
          />
        </div>

        {split.warning && (
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {split.warning}
          </div>
        )}

        {(showPoolShare || showRemainder) && (
          <div className="border-b border-slate-100 px-4 py-2">
            <p className="py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              กองกลาง
            </p>
            {showPoolShare && (
              <>
                <Row
                  label="ส่วนแบ่งกำไร (ปัดลง)"
                  amount={split.poolShare.flooredShare}
                  currency={currency}
                  bold
                  className={split.isLoss ? "text-red-600" : "text-emerald-700"}
                />
                {showPoolExact && (
                  <Row
                    label="ส่วนแบ่งแท้จริง"
                    amount={split.poolShare.exactShare}
                    currency={currency}
                    small
                    tone="muted"
                  />
                )}
              </>
            )}
            {showRemainder && (
              <Row
                label="เศษเข้ากองกลาง"
                amount={split.remainder}
                currency={currency}
                small
                tone="muted"
              />
            )}
          </div>
        )}

        {shareMembers.length > 0 && (
          <div className="border-b border-slate-100 px-4 py-2">
            <p className="py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              นักลงทุน / ผู้จัดการ
            </p>
            {shareMembers.map((s) => (
              <div key={s.memberId} className="border-t border-slate-50 py-2 first:border-t-0">
                <p className="text-sm font-medium text-slate-800">
                  {s.name}{" "}
                  <span className="font-normal text-slate-400">({MEMBER_ROLE_LABELS[s.role]})</span>
                </p>
                <Row
                  label="ส่วนแบ่ง (ปัดลง)"
                  amount={s.flooredShare}
                  currency={currency}
                  bold
                  className={split.isLoss ? "text-red-600" : "text-emerald-700"}
                />
                {s.exactShare !== s.flooredShare && (
                  <Row
                    label="ส่วนแบ่งแท้จริง"
                    amount={s.exactShare}
                    currency={currency}
                    small
                    tone="muted"
                  />
                )}
                {moneySign(s.wageCost) > 0 && (
                  <Row label="ค่าแรง" amount={s.wageCost} currency={currency} tone="expense" small />
                )}
                {s.eventDays !== null && s.eventDays > 0 && (
                  <p className="text-xs text-slate-400">รายวัน × {s.eventDays} วัน</p>
                )}
                {moneySign(s.advanceRepayment) > 0 && (
                  <Row
                    label="ได้คืนออกก่อน"
                    amount={s.advanceRepayment}
                    currency={currency}
                    small
                    tone="income"
                  />
                )}
                {Number(s.investmentAmount) > 0 && (
                  <p className="text-xs text-slate-400">
                    ลงทุน {formatMoney(s.investmentAmount, currency)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {wageOnly.filter((s) => s.role === "employee").length > 0 && (
          <div className="border-b border-slate-100 px-4 py-2">
            <p className="py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              พนักงาน (ค่าแรง)
            </p>
            {wageOnly
              .filter((s) => s.role === "employee")
              .map((s) => (
                <div key={s.memberId} className="border-t border-slate-50 py-2 first:border-t-0">
                  <p className="text-sm font-medium text-slate-800">{s.name}</p>
                  <Row label="ค่าแรงรวม" amount={s.wageCost} currency={currency} tone="expense" />
                  {s.eventDays !== null && s.eventDays > 0 && (
                    <p className="text-xs text-slate-400">รายวัน × {s.eventDays} วัน</p>
                  )}
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Row({
  label,
  amount,
  currency,
  tone = "neutral",
  bold = false,
  small = false,
  className = "",
}: {
  label: string;
  amount: string;
  currency: string;
  tone?: "income" | "expense" | "muted" | "neutral";
  bold?: boolean;
  small?: boolean;
  className?: string;
}) {
  const color =
    className ||
    (tone === "income"
      ? "text-emerald-600"
      : tone === "expense"
        ? "text-red-600"
        : tone === "muted"
          ? "text-slate-400"
          : "text-slate-700");

  return (
    <div className={`flex items-center justify-between gap-3 ${small ? "py-0.5" : "py-1"}`}>
      <span className={`${small ? "text-xs" : "text-sm"} text-slate-600`}>{label}</span>
      <span
        className={`tabular-nums ${small ? "text-xs" : "text-sm"} ${bold ? "font-bold" : "font-semibold"} ${color}`}
      >
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}
