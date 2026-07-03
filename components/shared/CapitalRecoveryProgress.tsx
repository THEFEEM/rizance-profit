import { formatMoney, toCents, computeProfit } from "@/lib/money";
import {
  equityPartnerSegments,
  type PartnerSegmentColor,
} from "@/lib/partner-colors";
import type { SplitProfitResult } from "@/lib/booth-split";

function capitalRepayProgressPct(split: SplitProfitResult): number {
  const total = toCents(split.totalCapital ?? "0");
  if (total <= 0) return 0;
  const repaid = toCents(split.capitalRepaid ?? "0");
  return Math.min(100, Math.max(0, (repaid / total) * 100));
}

function SegmentBar({
  segments,
  fillPercent,
}: {
  segments: ReturnType<typeof equityPartnerSegments>;
  fillPercent: number;
}) {
  if (segments.length === 0) return null;

  return (
    <div
      className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-rz-elevated"
      role="progressbar"
      aria-valuenow={Math.round(fillPercent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="ความคืบหน้าการคืนทุน"
    >
      {segments.map((seg, index) => (
        <div
          key={seg.memberId}
          className="relative min-w-[4px] overflow-hidden"
          style={{
            flex: `${seg.weightCents} 1 0%`,
            borderRadius:
              segments.length === 1
                ? "9999px"
                : index === 0
                  ? "9999px 0 0 9999px"
                  : index === segments.length - 1
                    ? "0 9999px 9999px 0"
                    : undefined,
          }}
          title={`${seg.name} · ${seg.equityPercentLabel} · คืนทุนแล้ว ${Math.round(fillPercent)}%`}
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: seg.color.faded }}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${fillPercent}%`,
              backgroundColor: seg.color.solid,
            }}
            aria-hidden
          />
        </div>
      ))}
    </div>
  );
}

function SegmentLegend({
  segments,
}: {
  segments: ReturnType<typeof equityPartnerSegments>;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {segments.map((seg) => (
        <span
          key={seg.memberId}
          className="inline-flex max-w-full items-center gap-1 text-[10px] text-rz-muted"
        >
          <PartnerColorDot color={seg.color} />
          <span className="truncate">{seg.name}</span>
          <span className="rz-tabular shrink-0">{seg.equityPercentLabel}</span>
        </span>
      ))}
    </div>
  );
}

export function PartnerColorDot({ color }: { color: PartnerSegmentColor }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color.solid }}
      aria-hidden
    />
  );
}

export function CapitalRecoveryProgress({
  split,
  currency,
}: {
  split: SplitProfitResult;
  currency: string;
}) {
  if (!split.repayCapitalFirst || split.capitalFullyRepaid) return null;

  const totalCapital = split.totalCapital ?? "0";
  if (toCents(totalCapital) <= 0) return null;

  const segments = equityPartnerSegments(split);
  if (segments.length === 0) return null;

  const recovered = split.capitalRepaid ?? "0";
  const remaining = computeProfit(totalCapital, recovered);
  const pct = capitalRepayProgressPct(split);

  return (
    <div className="border-b-[0.5px] border-rz-border px-4 py-3">
      <p className="text-sm text-rz-text">
        คืนทุนแล้ว{" "}
        <span className="rz-tabular font-medium">
          {formatMoney(recovered, currency)} / {formatMoney(totalCapital, currency)}
        </span>
      </p>
      <div className="mt-2.5">
        <SegmentBar segments={segments} fillPercent={pct} />
      </div>
      <SegmentLegend segments={segments} />
      <p className="rz-tabular mt-1.5 text-xs text-rz-green">{Math.round(pct)}%</p>
      <p className="mt-1 text-xs text-rz-hint">
        เหลืออีก {formatMoney(remaining, currency)} ก่อนเริ่มแบ่งกำไร
      </p>
    </div>
  );
}

/** Colors for member rows while capital is being repaid. */
export function capitalRecoveryPartnerColors(
  split: SplitProfitResult,
): Map<string, PartnerSegmentColor> | null {
  if (!split.repayCapitalFirst || split.capitalFullyRepaid) return null;
  const segments = equityPartnerSegments(split);
  if (segments.length === 0) return null;
  return new Map(segments.map((s) => [s.memberId, s.color]));
}
