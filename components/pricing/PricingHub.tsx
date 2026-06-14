import Link from "next/link";
import { BreakEvenOverview } from "@/components/pricing/BreakEvenDisplay";
import {
  CalculateIcon,
  IngredientsIcon,
  OverheadsIcon,
  RecipesIcon,
} from "@/components/pricing/icons";
import { PRICING_LABELS, type PricingSummary } from "@/types/pricing";

const SECTIONS = [
  {
    href: "/pricing/ingredients",
    title: PRICING_LABELS.ingredients,
    icon: IngredientsIcon,
    tone: "blue" as const,
  },
  {
    href: "/pricing/recipes",
    title: PRICING_LABELS.recipes,
    icon: RecipesIcon,
    tone: "green" as const,
  },
  {
    href: "/pricing/overheads",
    title: PRICING_LABELS.overheads,
    icon: OverheadsIcon,
    tone: "muted" as const,
  },
  {
    href: "/pricing/calculate",
    title: PRICING_LABELS.calculate,
    icon: CalculateIcon,
    tone: "green" as const,
  },
] as const;

function SectionIconTile({
  icon: Icon,
  tone,
}: {
  icon: typeof IngredientsIcon;
  tone: "blue" | "green" | "muted";
}) {
  const bg =
    tone === "blue"
      ? "bg-[#15293F] text-rz-blue"
      : tone === "green"
        ? "bg-[#16352A] text-rz-green"
        : "bg-rz-elevated text-rz-muted";
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-rz-border ${bg}`}
    >
      <Icon />
    </span>
  );
}

export function PricingHub({ summary }: { summary: PricingSummary }) {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-medium text-rz-text">{PRICING_LABELS.module}</h1>
      <p className="mt-1 text-sm text-rz-hint">วางแผนต้นทุนและราคาขาย — ไม่กระทบหน้า Today</p>
      <div className="mt-6 grid gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="tap-target flex items-center gap-4 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-4 active:bg-rz-elevated"
          >
            <SectionIconTile icon={s.icon} tone={s.tone} />
            <span className="min-w-0 flex-1 text-base font-medium text-rz-text">{s.title}</span>
            <span className="shrink-0 text-rz-hint" aria-hidden>
              →
            </span>
          </Link>
        ))}
      </div>

      <BreakEvenOverview
        monthlyOverheadTotal={summary.monthlyOverheadTotal}
        needsSetup={summary.breakEvenNeedsSetup}
        estimatedCupsPerMonth={summary.settings.estimatedCupsPerMonth}
        rows={summary.rows.map((r) => r.breakEven)}
      />
    </div>
  );
}
