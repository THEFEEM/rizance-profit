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
  EXPENSE_COST_TYPE_LABELS,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_KEYS,
  INCOME_CATEGORY_OPTIONS,
  LEGACY_EXPENSE_FORM_KEYS,
  LEGACY_INCOME_FORM_KEYS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  expenseCategoryIcon,
  expenseCategoryLabel,
  expenseCategoryOrder,
  expenseCostTypeLabel,
  getExpenseType,
  incomeCategoryIcon,
  incomeCategoryLabel,
  incomeCategoryOrder,
  isFixed,
  isExpenseCategoryKey,
  isIncomeCategoryKey,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
} from "@/lib/expense-categories";

export {
  SHOP_EXPENSE_GRID_OPTIONS as EXPENSE_CATEGORY_GRID_OPTIONS,
  SHOP_INCOME_GRID_OPTIONS as INCOME_CATEGORY_GRID_OPTIONS,
} from "@/lib/category-lucide-icons";

import type { ExpenseCategoryKey, IncomeCategoryKey } from "@/lib/expense-categories";

/** Canonical keys stored in DB after Round 1 migration. */
export type IncomeCategory = IncomeCategoryKey;
export type ExpenseCategory = ExpenseCategoryKey;

export type AuthProvider = "email" | "google" | "both";

export type User = {
  id: string;
  email: string;
  shopName: string;
  displayName: string | null;
  avatarUrl: string | null;
  authProvider: AuthProvider;
  currency: string;
  monthlyBudget: string | null;
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
  paymentMethod?: string;
  note: string | null;
  entryDate: string; // YYYY-MM-DD
  createdAt: string;
  isAdvance?: boolean;
  payerName?: string | null;
};

export const TRANSFER_DIRECTIONS = ["cash_to_transfer", "transfer_to_cash"] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

export const TRANSFER_DIRECTION_LABELS: Record<TransferDirection, string> = {
  cash_to_transfer: "ฝากเข้าบัญชี",
  transfer_to_cash: "ถอนเป็นเงินสด",
};

export type MoneyTransfer = {
  id: string;
  amount: string;
  direction: TransferDirection;
  note: string | null;
  entryDate: string;
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

export type DailyProfitPoint = {
  date: string;
  income: string;
  expense: string;
  profit: string;
};

export type DailyExpensePoint = {
  date: string;
  expense: string;
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

/** Month rollup for history list — months with at least one entry. */
export type MonthActivity = {
  month: string;
  income: string;
  expense: string;
  profit: string;
};

// Standard API envelopes.
export type ApiSuccess<T> = { data: T };
export type ApiError = { error: { message: string; fields?: Record<string, string[] | undefined> } };
