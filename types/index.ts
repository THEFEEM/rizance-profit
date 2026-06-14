// Re-export canonical category model (Round 1 migration).
export type {
  ExpenseCategoryKey,
  ExpenseCostType,
  IncomeCategoryKey,
  LegacyExpenseFormKey,
  LegacyIncomeFormKey,
  PaymentMethod,
} from "@/lib/expense-categories";

export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  EXPENSE_CATEGORY_OPTIONS,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_GRID_OPTIONS,
  INCOME_CATEGORY_KEYS,
  INCOME_CATEGORY_OPTIONS,
  LEGACY_EXPENSE_FORM_KEYS,
  LEGACY_INCOME_FORM_KEYS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  expenseCategoryLabel,
  getExpenseType,
  incomeCategoryLabel,
  isFixed,
  isExpenseCategoryKey,
  isIncomeCategoryKey,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
} from "@/lib/expense-categories";

import type { ExpenseCategoryKey, IncomeCategoryKey } from "@/lib/expense-categories";

/** Canonical keys stored in DB after Round 1 migration. */
export type IncomeCategory = IncomeCategoryKey;
export type ExpenseCategory = ExpenseCategoryKey;

export type User = {
  id: string;
  email: string;
  shopName: string;
  currency: string;
  createdAt: string;
};

// Money fields are decimal STRINGS (e.g. "420.00") to preserve exact decimals.
export type Income = {
  id: string;
  amount: string;
  category: IncomeCategory;
  paymentMethod?: string;
  note: string | null;
  entryDate: string; // YYYY-MM-DD
  createdAt: string;
};

export type Expense = {
  id: string;
  amount: string;
  category: ExpenseCategory;
  note: string | null;
  entryDate: string; // YYYY-MM-DD
  createdAt: string;
};

export const PERIOD_KEYS = ["today", "month", "last_7", "last_14", "last_30"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export type PeriodSummary = {
  period: PeriodKey;
  start: string;
  end: string;
  income: string;
  expense: string;
  profit: string;
  incomeCount: number;
  expenseCount: number;
};

export type CategoryBreakdownItem = {
  category: string;
  amount: string;
  count: number;
};

export type CategoryBreakdown = {
  start: string;
  end: string;
  income: CategoryBreakdownItem[];
  expense: CategoryBreakdownItem[];
};

export type DailySummary = {
  date: string; // YYYY-MM-DD
  income: string;
  expense: string;
  profit: string;
  incomeCount: number;
  expenseCount: number;
};

/** All-time regular-shop totals — computed on read, never stored. */
export type AllTimeSummary = {
  income: string;
  expense: string;
  profit: string;
  incomeCount: number;
  expenseCount: number;
};

export type MonthlyDay = {
  date: string;
  income: string;
  expense: string;
  profit: string;
};

export type MonthlySummary = {
  month: string; // YYYY-MM
  income: string;
  expense: string;
  profit: string;
  days: MonthlyDay[];
};

// Standard API envelopes.
export type ApiSuccess<T> = { data: T };
export type ApiError = { error: { message: string; fields?: Record<string, string[] | undefined> } };
