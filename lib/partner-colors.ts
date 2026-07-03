import { toCents } from "@/lib/money";
import type { SplitProfitResult } from "@/lib/booth-split";

/** Segment colors for equity partners — distinct on dark navy backgrounds. */
export const PARTNER_SEGMENT_COLORS = [
  { solid: "#4ADE9E", faded: "rgba(74, 222, 158, 0.22)" },
  { solid: "#6BB6FF", faded: "rgba(107, 182, 255, 0.22)" },
  { solid: "#FBBF24", faded: "rgba(251, 191, 36, 0.22)" },
  { solid: "#B69CE8", faded: "rgba(182, 156, 232, 0.22)" },
  { solid: "#F472B6", faded: "rgba(244, 114, 182, 0.22)" },
  { solid: "#38BDF8", faded: "rgba(56, 189, 248, 0.22)" },
] as const;

export type PartnerSegmentColor = (typeof PARTNER_SEGMENT_COLORS)[number];

export function partnerColorByIndex(index: number): PartnerSegmentColor {
  return PARTNER_SEGMENT_COLORS[index % PARTNER_SEGMENT_COLORS.length];
}

export type EquityPartnerSegment = {
  memberId: string;
  name: string;
  weightCents: number;
  widthPercent: number;
  equityPercentLabel: string;
  color: PartnerSegmentColor;
};

/** Equity holders for capital-recovery bar — width by investment share. */
export function equityPartnerSegments(split: SplitProfitResult): EquityPartnerSegment[] {
  const totalCents = toCents(split.totalCapital ?? "0");
  if (totalCents <= 0) return [];

  const members = split.memberShares.filter(
    (s) =>
      (s.role === "investor" || s.role === "manager") &&
      toCents(s.investmentAmount) > 0,
  );

  return members.map((m, index) => {
    const weightCents = toCents(m.investmentAmount);
    return {
      memberId: m.memberId,
      name: m.name,
      weightCents,
      widthPercent: (weightCents / totalCents) * 100,
      equityPercentLabel: `${((weightCents / totalCents) * 100).toFixed(1)}%`,
      color: partnerColorByIndex(index),
    };
  });
}

export function partnerColorMap(
  segments: EquityPartnerSegment[],
): Map<string, PartnerSegmentColor> {
  return new Map(segments.map((s) => [s.memberId, s.color]));
}
