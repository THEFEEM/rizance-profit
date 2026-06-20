import { RoleBadge } from "@/components/booth/summary/role-styles";
import { splitPercents } from "@/components/booth/summary/split-percents";
import { formatMoney, moneySign } from "@/lib/money";
import { MEMBER_ROLE_LABELS, type SplitProfitResult } from "@/types/booth";

function shareAmountColor(isLoss: boolean, amount: string) {
  const sign = moneySign(amount);
  if (isLoss || sign < 0) return "text-rz-red";
  if (sign > 0) return "text-rz-green";
  return "text-rz-hint";
}

export type SplitProfitCardProps = {
  split: SplitProfitResult;
  currency?: string;
  accent?: "green" | "amber";
  periodLabel?: string;
  emptyHint?: string;
  variant?: "full" | "compact";
  className?: string;
};

export function SplitProfitCard({
  split,
  currency = "THB",
  accent = "green",
  periodLabel,
  emptyHint = "ยังไม่มีผู้ลงทุน — เพิ่มหุ้นส่วนเพื่อแบ่งกำไร",
  variant = "full",
  className = "",
}: SplitProfitCardProps) {
  const percents = splitPercents(split);
  const titleAccent = accent === "amber" ? "text-rz-amber" : "text-rz-green";

  const shareMembers = split.memberShares.filter(
    (s) => s.role === "investor" || s.role === "manager",
  );

  const showPoolShare =
    split.poolGetsShare && moneySign(split.poolShare.flooredShare) !== 0;

  const hasParticipants = shareMembers.length > 0 || showPoolShare;

  const heading = periodLabel ? `การแบ่งกำไร (${periodLabel})` : "การแบ่งกำไร";

  if (variant === "compact") {
    if (!hasParticipants) return null;

    return (
      <section className={`px-4 pt-3 ${className}`}>
        <h2 className={`mb-2 text-sm font-medium ${titleAccent}`}>{heading}</h2>
        <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <ul className="divide-y divide-rz-border">
            {shareMembers.map((s) => {
              const pct = percents.members.get(s.memberId) ?? "0%";
              const shareColor = shareAmountColor(split.isLoss, s.flooredShare);
              return (
                <li
                  key={s.memberId}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-medium text-rz-text">
                    {s.name}{" "}
                    <span className="font-normal text-rz-hint">({pct})</span>
                  </span>
                  <span className={`rz-tabular font-medium ${shareColor}`}>
                    {formatMoney(s.flooredShare, currency)}
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
              const shareColor = shareAmountColor(split.isLoss, s.flooredShare);

              return (
                <li key={s.memberId} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-rz-text">{s.name}</span>
                    <span className={`rz-tabular text-[15px] font-medium ${shareColor}`}>
                      {formatMoney(s.flooredShare, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-rz-hint">
                    <RoleBadge role={s.role} label={MEMBER_ROLE_LABELS[s.role]} />
                    {hasEquity && pct && (
                      <span>
                        ลงทุน {formatMoney(s.investmentAmount, currency)} · {pct}
                      </span>
                    )}
                    {moneySign(s.wageCost) > 0 && (
                      <span className="text-rz-red">
                        + ค่าแรง {formatMoney(s.wageCost, currency)}
                      </span>
                    )}
                  </div>
                  {s.exactShare !== s.flooredShare && (
                    <p className="mt-1 text-xs text-rz-placeholder">
                      ส่วนแบ่งแท้จริง {formatMoney(s.exactShare, currency)}
                    </p>
                  )}
                  {moneySign(s.advanceRepayment) > 0 && (
                    <p className="mt-1 text-xs text-rz-green">
                      ได้คืนออกก่อน {formatMoney(s.advanceRepayment, currency)}
                    </p>
                  )}
                  {s.eventDays !== null && s.eventDays > 0 && (
                    <p className="mt-0.5 text-xs text-rz-placeholder">รายวัน × {s.eventDays} วัน</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
