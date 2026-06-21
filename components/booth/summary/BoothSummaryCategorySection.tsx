import { CategoryProgressList, type CategoryProgressRow } from "@/components/stats/CategoryProgressList";
import { BreakdownSection } from "@/components/stats/BreakdownSection";
import type { CategoryBreakdownEntry } from "@/components/stats/CategoryBreakdownPanel";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
} from "@/lib/expense-categories";
import {
  renderShopExpenseIcon,
  renderShopIncomeIcon,
} from "@/lib/category-lucide-icons";
import { listBoothExpense, listBoothIncome } from "@/lib/booth-queries";
import { toCents } from "@/lib/money";

function sharePercent(part: string, total: string): number {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0;
  return (toCents(part) / totalCents) * 100;
}

function aggregateCategoryRows(
  entries: { id: string; category: string; amount: string; entryDate: string; note: string | null }[],
  kind: "income" | "expense",
  totalAmount: string,
): CategoryProgressRow[] {
  const labelFn = kind === "income" ? incomeCategoryLabel : expenseCategoryLabel;
  const iconFn = kind === "income" ? renderShopIncomeIcon : renderShopExpenseIcon;
  const map = new Map<string, { amountCents: number; count: number }>();

  for (const e of entries) {
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
        label: labelFn(category),
        icon: iconFn(category),
        amount,
        count,
        percentage: sharePercent(amount, totalAmount),
      };
    })
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

function groupEntriesByCategory(
  entries: { id: string; category: string; entryDate: string; amount: string; note: string | null }[],
): Record<string, CategoryBreakdownEntry[]> {
  const map: Record<string, CategoryBreakdownEntry[]> = {};
  for (const e of entries) {
    (map[e.category] ??= []).push({
      id: e.id,
      entryDate: e.entryDate,
      amount: e.amount,
      note: e.note,
    });
  }
  return map;
}

/** Full income/expense category breakdown for a closed booth summary. */
export async function BoothSummaryCategorySection({
  userId,
  boothId,
  totalIncome,
  totalExpense,
  currency = "THB",
}: {
  userId: string;
  boothId: string;
  totalIncome: string;
  totalExpense: string;
  currency?: string;
}) {
  const [incomes, expenses] = await Promise.all([
    listBoothIncome(userId, boothId),
    listBoothExpense(userId, boothId),
  ]);

  const incomeRows = aggregateCategoryRows(incomes, "income", totalIncome);
  const expenseRows = aggregateCategoryRows(expenses, "expense", totalExpense);
  const incomeEntries = groupEntriesByCategory(incomes);
  const expenseEntries = groupEntriesByCategory(expenses);

  if (incomeRows.length === 0 && expenseRows.length === 0) return null;

  return (
    <div className="mt-6 space-y-6">
      {incomeRows.length > 0 && (
        <BreakdownSection title="รายรับตามหมวด">
          <CategoryProgressList
            rows={incomeRows}
            entriesByCategory={incomeEntries}
            currency={currency}
            tone="income"
            accent="amber"
          />
        </BreakdownSection>
      )}
      {expenseRows.length > 0 && (
        <BreakdownSection title="รายจ่ายตามหมวด">
          <CategoryProgressList
            rows={expenseRows}
            entriesByCategory={expenseEntries}
            currency={currency}
            tone="expense"
          />
        </BreakdownSection>
      )}
    </div>
  );
}
