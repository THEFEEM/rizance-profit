import type { EntryRow } from "@/components/EntryList";
import { sumDecimals, toCents } from "@/lib/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_OPTIONS,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_OPTIONS,
  expenseCategoryLabel,
  incomeCategoryLabel,
} from "@/lib/expense-categories";

export type TodayCategoryGroup = {
  key: string;
  kind: "income" | "expense";
  icon: string;
  label: string;
  subtotal: string;
};

const incomeIconByKey = Object.fromEntries(INCOME_CATEGORIES.map((c) => [c.key, c.icon]));
const expenseIconByKey = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.icon]));
const legacyIncomeIcon = Object.fromEntries(INCOME_CATEGORY_OPTIONS.map((o) => [o.value, o.icon]));
const legacyExpenseIcon = Object.fromEntries(EXPENSE_CATEGORY_OPTIONS.map((o) => [o.value, o.icon]));

/** Group today's entries by kind+category — client-side from existing entry list. */
export function buildTodayCategoryGroups(entries: EntryRow[]): TodayCategoryGroup[] {
  const totals = new Map<string, { kind: "income" | "expense"; amounts: string[] }>();

  for (const e of entries) {
    const category = e.category ?? (e.kind === "income" ? "storefront" : "expense_misc");
    const key = `${e.kind}:${category}`;
    const existing = totals.get(key);
    if (existing) {
      existing.amounts.push(e.amount);
    } else {
      totals.set(key, { kind: e.kind, amounts: [e.amount] });
    }
  }

  const groups: TodayCategoryGroup[] = [];
  for (const [key, { kind, amounts }] of totals) {
    const subtotal = sumDecimals(...amounts);
    if (toCents(subtotal) === 0) continue;
    const category = key.split(":")[1]!;
    const label =
      kind === "income" ? incomeCategoryLabel(category) : expenseCategoryLabel(category);
    const icon =
      kind === "income"
        ? (incomeIconByKey[category] ?? legacyIncomeIcon[category] ?? "•")
        : (expenseIconByKey[category] ?? legacyExpenseIcon[category] ?? "•");
    groups.push({
      key,
      kind,
      icon,
      label,
      subtotal,
    });
  }

  return groups.sort((a, b) => toCents(b.subtotal) - toCents(a.subtotal));
}
