import type { EntryRow } from "@/components/EntryList";
import { sumDecimals, toCents } from "@/lib/money";
import {
  EXPENSE_CATEGORY_OPTIONS,
  INCOME_CATEGORY_OPTIONS,
  type ExpenseCategory,
  type IncomeCategory,
} from "@/types";

export type TodayCategoryGroup = {
  key: string;
  kind: "income" | "expense";
  icon: string;
  label: string;
  subtotal: string;
};

/** Group today's entries by kind+category — client-side from existing entry list. */
export function buildTodayCategoryGroups(entries: EntryRow[]): TodayCategoryGroup[] {
  const incomeMeta = new Map(INCOME_CATEGORY_OPTIONS.map((o) => [o.value, o]));
  const expenseMeta = new Map(EXPENSE_CATEGORY_OPTIONS.map((o) => [o.value, o]));

  const totals = new Map<string, { kind: "income" | "expense"; amounts: string[] }>();

  for (const e of entries) {
    const category = e.category ?? (e.kind === "income" ? "storefront" : "other");
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
    const meta =
      kind === "income"
        ? incomeMeta.get(category as IncomeCategory)
        : expenseMeta.get(category as ExpenseCategory);
    groups.push({
      key,
      kind,
      icon: meta?.icon ?? "•",
      label: meta?.label ?? category,
      subtotal,
    });
  }

  return groups.sort((a, b) => toCents(b.subtotal) - toCents(a.subtotal));
}
