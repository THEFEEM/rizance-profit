import { projectExpenseLabel, projectFundingLabel } from "@/lib/project-categories";
import { toCents } from "@/lib/money";
import type { CategoryProgressRow } from "@/components/stats/CategoryProgressList";
import type { CategoryBreakdownEntry } from "@/components/stats/CategoryBreakdownPanel";
import type { ActivitySummary, FundBalance, ProjectExpense } from "@/types/project";

const FUNDING_EMOJI: Record<string, string> = {
  faculty_grant: "🏦",
  membership: "👥",
  participant_fee: "🎫",
  sponsor: "🤝",
  donation: "💝",
  activity_income: "🏪",
  other_income: "✏️",
};

const EXPENSE_EMOJI: Record<string, string> = {
  venue: "🏗",
  food: "🍔",
  transport: "🚌",
  materials: "🔧",
  printing: "📄",
  reward: "🏆",
  service: "👷",
  other_expense: "📦",
};

export function projectFundingEmoji(key: string): string {
  return FUNDING_EMOJI[key] ?? "💰";
}

export function projectExpenseEmoji(key: string): string {
  return EXPENSE_EMOJI[key] ?? "📦";
}

export function sharePercent(part: string, total: string): number {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0;
  return (toCents(part) / totalCents) * 100;
}

export function buildOrgExpenseCategoryRows(
  expenses: ProjectExpense[],
  totalSpent: string,
): CategoryProgressRow[] {
  const map = new Map<string, { amountCents: number; count: number }>();

  for (const e of expenses) {
    if (e.paymentStatus === "rejected") continue;
    const prev = map.get(e.category) ?? { amountCents: 0, count: 0 };
    map.set(e.category, {
      amountCents: prev.amountCents + toCents(e.amount),
      count: prev.count + 1,
    });
  }

  return [...map.entries()]
    .map(([category, { amountCents, count }]) => {
      const amount = (amountCents / 100).toFixed(2);
      return {
        category,
        label: projectExpenseLabel(category),
        icon: projectExpenseEmoji(category),
        amount,
        count,
        percentage: sharePercent(amount, totalSpent),
      };
    })
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

export function groupProjectExpensesByCategory(
  expenses: ProjectExpense[],
): Record<string, CategoryBreakdownEntry[]> {
  const map: Record<string, CategoryBreakdownEntry[]> = {};
  for (const e of expenses) {
    if (e.paymentStatus === "rejected") continue;
    (map[e.category] ??= []).push({
      id: e.id,
      entryDate: e.entryDate,
      amount: e.amount,
      note: e.note ?? e.label,
    });
  }
  return map;
}

export type FundProgressItem = FundBalance & { percentage: number };

export function buildFundProgressItems(funds: FundBalance[]): FundProgressItem[] {
  return funds
    .map((f) => ({
      ...f,
      percentage:
        toCents(f.totalReceived) > 0
          ? sharePercent(f.totalSpent, f.totalReceived)
          : 0,
    }))
    .sort((a, b) => toCents(b.totalSpent) - toCents(a.totalSpent));
}

export type ActivityProgressItem = ActivitySummary & { percentage: number };

export function buildActivityProgressItems(activities: ActivitySummary[]): ActivityProgressItem[] {
  return activities
    .map((a) => ({
      ...a,
      percentage:
        toCents(a.budgetTarget) > 0 ? sharePercent(a.totalSpent, a.budgetTarget) : 0,
    }))
    .sort((a, b) => toCents(b.totalSpent) - toCents(a.totalSpent));
}
