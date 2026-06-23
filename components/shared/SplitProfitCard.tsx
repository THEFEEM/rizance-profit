import { RoleBadge } from "@/components/booth/summary/role-styles";
import { splitPercents } from "@/components/booth/summary/split-percents";
import { formatMoney, moneySign, toCents } from "@/lib/money";
import type { SplitProfitResult } from "@/lib/booth-split";
import type { MemberProfitWithdrawable } from "@/types/shop";
import { MEMBER_ROLE_LABELS } from "@/types/booth";

function shareAmountColor(isLoss: boolean, amount: string) {
  const sign = moneySign(amount);
  if (isLoss || sign < 0) return "text-rz-red";
  if (sign > 0) return "text-rz-green";
  return "text-rz-hint";
}

function capitalRepayProgressPct(split: SplitProfitResult): number {
  const total = toCents(split.totalCapital ?? "0");
  if (total <= 0) return 0;
  const repaid = toCents(split.capitalRepaid ?? "0");
  return Math.min(100, Math.max(0, (repaid / total) * 100));
}

function CapitalRepayBanner({
  split,
  currency,
}: {
  split: SplitProfitResult;
  currency: string;
}) {
  if (!split.repayCapitalFirst || split.capitalFullyRepaid) return null;

  if (split.isLoss) {
    return (
      <div className="border-b-[0.5px] border-rz-border px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-rz-hint">ขาดทุน</span>
          <span className="rz-tabular font-medium text-rz-red">
            {formatMoney(split.netProfit, currency)}
          </span>
        </div>
      </div>
    );
  }

  const pct = capitalRepayProgressPct(split);

  return (
    <div className="border-b-[0.5px] border-rz-border px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="text-rz-hint">กำลังคืนทุน</span>
        <span className="rz-tabular text-rz-muted">
          {formatMoney(split.capitalRepaid ?? "0", currency)} /{" "}
          {formatMoney(split.totalCapital ?? "0", currency)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-rz-elevated">
        <div
          className="h-full rounded-full bg-rz-green"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export type SplitProfitCardProps = {
  split: SplitProfitResult;
  currency?: string;
  accent?: "green" | "amber";
  periodLabel?: string;
  emptyHint?: string;
  variant?: "full" | "compact";
  className?: string;
  shopWithdrawals?: MemberProfitWithdrawable[];
};

function withdrawalLines(
  memberId: string,
  shopWithdrawals: MemberProfitWithdrawable[] | undefined,
  currency: string,
) {
  const w = shopWithdrawals?.find((r) => r.memberId === memberId);
  if (!w) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-rz-hint">
      <p>ส่วนแบ่งสะสม {formatMoney(w.accumulatedShare, currency)}</p>
      <p>ถอนแล้ว {formatMoney(w.withdrawn, currency)}</p>
      <p className="font-medium text-rz-green">
        เหลือถอนได้ {formatMoney(w.available, currency)}
      </p>
    </div>
  );
}

export function SplitProfitCard({
  split,
  currency = "THB",
  accent = "green",
  periodLabel,
  emptyHint = "ยังไม่มีผู้ลงทุน — เพิ่มหุ้นส่วนเพื่อแบ่งกำไร",
  variant = "full",
  className = "",
  shopWithdrawals,
}: SplitProfitCardProps) {
  const percents = splitPercents(split);
  const titleAccent = accent === "amber" ? "text-rz-amber" : "text-rz-green";
  const showProfitSplit = !split.repayCapitalFirst || split.capitalFullyRepaid;

  const shareMembers = split.memberShares.filter(
    (s) => s.role === "investor" || s.role === "manager",
  );

  const showPoolShare =
    showProfitSplit && split.poolGetsShare && moneySign(split.poolShare.flooredShare) !== 0;

  const hasParticipants = shareMembers.length > 0 || showPoolShare;

  const heading = periodLabel ? `การแบ่งกำไร (${periodLabel})` : "การแบ่งกำไร";

  if (variant === "compact") {
    if (!hasParticipants) return null;

    return (
      <section className={`px-4 pt-3 ${className}`}>
        <h2 className={`mb-2 text-sm font-medium ${titleAccent}`}>{heading}</h2>
        <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <CapitalRepayBanner split={split} currency={currency} />
          <ul className="divide-y divide-rz-border">
            {shareMembers.map((s) => {
              const pct = percents.members.get(s.memberId) ?? "0%";
              const hasEquity = Number(s.investmentAmount) > 0;
              const displayAmount = showProfitSplit ? s.flooredShare : "0.00";
              const shareColor = showProfitSplit
                ? shareAmountColor(split.isLoss, s.flooredShare)
                : "text-rz-hint";

              return (
                <li
                  key={s.memberId}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-rz-text">
                      {s.name}
                      {showProfitSplit && hasEquity && (
                        <span className="font-normal text-rz-hint"> ({pct})</span>
                      )}
                    </span>
                    {!showProfitSplit && hasEquity && (
                      <span className="mt-0.5 block text-xs font-normal text-rz-hint">
                        ลงทุน {formatMoney(s.investmentAmount, currency)}
                      </span>
                    )}
                    {withdrawalLines(s.memberId, shopWithdrawals, currency)}
                  </div>
                  <span className={`rz-tabular shrink-0 font-medium ${shareColor}`}>
                    {formatMoney(displayAmount, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section className={`mt-6 px-4 ${className}`}>
      <h2 className={`mb-2 text-sm font-medium ${titleAccent}`}>{heading}</h2>
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        {split.warning && (
          <div className="border-b-[0.5px] border-[#5A3F12] bg-[#2E2310]/50 px-4 py-3 text-sm text-rz-amber">
            {split.warning}
          </div>
        )}

        <CapitalRepayBanner split={split} currency={currency} />

        {!hasParticipants && !split.warning && (
          <p className="px-4 py-4 text-sm text-rz-amber">{emptyHint}</p>
        )}

        {hasParticipants && (
          <ul className="divide-y divide-rz-border">
            {showPoolShare && percents.pool && (
              <li className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-rz-text">กองกลาง</span>
                  <span
                    className={`rz-tabular text-[15px] font-medium ${shareAmountColor(split.isLoss, split.poolShare.flooredShare)}`}
                  >
                    {formatMoney(split.poolShare.flooredShare, currency)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-rz-hint">
                  <RoleBadge role="pool" label="กองกลาง" />
                  <span>
                    ลงทุน {formatMoney(split.poolBudget, currency)} · {percents.pool}
                  </span>
                </div>
              </li>
            )}

            {shareMembers.map((s) => {
              const pct = percents.members.get(s.memberId);
              const hasEquity = Number(s.investmentAmount) > 0;
              const displayAmount = showProfitSplit ? s.flooredShare : "0.00";
              const shareColor = showProfitSplit
                ? shareAmountColor(split.isLoss, s.flooredShare)
                : "text-rz-hint";

              return (
                <li key={s.memberId} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-rz-text">{s.name}</span>
                    <span className={`rz-tabular text-[15px] font-medium ${shareColor}`}>
                      {formatMoney(displayAmount, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-rz-hint">
                    <RoleBadge role={s.role} label={MEMBER_ROLE_LABELS[s.role]} />
                    {hasEquity && pct && (
                      <span>
                        ลงทุน {formatMoney(s.investmentAmount, currency)} · {pct}
                      </span>
                    )}
                    {showProfitSplit && moneySign(s.wageCost) > 0 && (
                      <span className="text-rz-red">
                        + ค่าแรง {formatMoney(s.wageCost, currency)}
                      </span>
                    )}
                  </div>
                  {showProfitSplit && s.exactShare !== s.flooredShare && (
                    <p className="mt-1 text-xs text-rz-placeholder">
                      ส่วนแบ่งแท้จริง {formatMoney(s.exactShare, currency)}
                    </p>
                  )}
                  {showProfitSplit && moneySign(s.advanceRepayment) > 0 && (
                    <p className="mt-1 text-xs text-rz-green">
                      ได้คืนออกก่อน {formatMoney(s.advanceRepayment, currency)}
                    </p>
                  )}
                  {showProfitSplit && s.eventDays !== null && s.eventDays > 0 && (
                    <p className="mt-0.5 text-xs text-rz-placeholder">รายวัน × {s.eventDays} วัน</p>
                  )}
                  {withdrawalLines(s.memberId, shopWithdrawals, currency)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
