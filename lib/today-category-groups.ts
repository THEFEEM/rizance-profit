import type { EntryRow } from "@/components/EntryList";
import { sumDecimals, toCents } from "@/lib/money";
import {
  expenseCategoryLabel,
  expenseCategoryOrder,
  incomeCategoryLabel,
  incomeCategoryOrder,
} from "@/lib/expense-categories";

export type TodayCategoryGroup = {
  key: string;
  kind: "income" | "expense";
  category: string;
  label: string;
  subtotal: string;
};

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
    groups.push({
      key,
      kind,
      category,
      label,
      subtotal,
    });
  }

  return groups.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
    const catA = a.key.split(":")[1]!;
    const catB = b.key.split(":")[1]!;
    const orderA = a.kind === "income" ? incomeCategoryOrder(catA) : expenseCategoryOrder(catA);
    const orderB = b.kind === "income" ? incomeCategoryOrder(catB) : expenseCategoryOrder(catB);
    if (orderA !== orderB) return orderA - orderB;
    return toCents(b.subtotal) - toCents(a.subtotal);
  });
}
