import {
  projectExpenseLabel,
  projectFundingLabel,
  type ProjectExpenseKey,
  type ProjectFundingKey,
} from "@/lib/project-categories";
import { sumDecimals, toCents } from "@/lib/money";
import { EXPENSE_CATEGORY_UI, FUNDING_SOURCE_UI, PROJECT_UI } from "@/lib/project-ui";
import type { ProjectIconName } from "@/components/project/icons";
import type { ProjectIncome } from "@/types/project";

export type BreakdownRow = {
  key: string;
  label: string;
  amount: string;
  icon: ProjectIconName;
  color: string;
  bg?: string;
};

const FUNDING_UI_MAP = Object.fromEntries(FUNDING_SOURCE_UI.map((t) => [t.key, t])) as Record<
  string,
  (typeof FUNDING_SOURCE_UI)[number]
>;

const EXPENSE_UI_MAP = Object.fromEntries(EXPENSE_CATEGORY_UI.map((t) => [t.key, t])) as Record<
  string,
  (typeof EXPENSE_CATEGORY_UI)[number]
>;

const EXTRA_FUNDING_UI: Partial<
  Record<ProjectFundingKey, Pick<BreakdownRow, "icon" | "color" | "bg">>
> = {
  participant_fee: { icon: "calendar-event", color: PROJECT_UI.accent, bg: PROJECT_UI.accentBg },
  donation: { icon: "heart-handshake", color: PROJECT_UI.amber, bg: "#2E2310" },
  activity_income: { icon: "building-store", color: PROJECT_UI.positive, bg: "#16352A" },
};

function fundingRow(key: string, label: string, amount: string): BreakdownRow {
  const tile = FUNDING_UI_MAP[key];
  if (tile) {
    return { key, label, amount, icon: tile.icon, color: tile.color, bg: tile.bg };
  }
  const extra = EXTRA_FUNDING_UI[key as ProjectFundingKey];
  return {
    key,
    label,
    amount,
    icon: extra?.icon ?? "pencil",
    color: extra?.color ?? PROJECT_UI.muted,
    bg: extra?.bg ?? "#1A2236",
  };
}

export function buildIncomeBreakdown(
  incomeBySource: Record<string, string>,
  incomes: ProjectIncome[] = [],
): BreakdownRow[] {
  const rows: BreakdownRow[] = [];

  for (const [key, amount] of Object.entries(incomeBySource)) {
    if (toCents(amount) <= 0 || key === "other_income") continue;
    rows.push(fundingRow(key, projectFundingLabel(key), amount));
  }

  const otherEntries = incomes.filter(
    (e) => e.source === "other_income" && e.paymentStatus !== "rejected",
  );
  if (otherEntries.length > 0) {
    const byLabel = new Map<string, string>();
    for (const entry of otherEntries) {
      const label = entry.label?.trim() || projectFundingLabel("other_income");
      byLabel.set(label, sumDecimals(byLabel.get(label) ?? "0.00", entry.amount));
    }
    for (const [label, amount] of byLabel) {
      if (toCents(amount) > 0) rows.push(fundingRow("other_income", label, amount));
    }
  } else if (toCents(incomeBySource.other_income ?? "0") > 0) {
    rows.push(
      fundingRow("other_income", projectFundingLabel("other_income"), incomeBySource.other_income),
    );
  }

  rows.sort((a, b) => toCents(b.amount) - toCents(a.amount));
  return rows;
}

export function buildExpenseBreakdown(expenseByCategory: Record<string, string>): BreakdownRow[] {
  const rows: BreakdownRow[] = [];

  for (const [key, amount] of Object.entries(expenseByCategory)) {
    if (toCents(amount) <= 0) continue;
    const tile = EXPENSE_UI_MAP[key];
    rows.push({
      key,
      label: tile?.label ?? projectExpenseLabel(key),
      amount,
      icon: tile?.icon ?? "dots",
      color: tile?.color ?? PROJECT_UI.mutedDark,
    });
  }

  rows.sort((a, b) => toCents(b.amount) - toCents(a.amount));
  return rows;
}
