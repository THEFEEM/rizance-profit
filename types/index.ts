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
  note: string | null;
  entryDate: string; // YYYY-MM-DD
  createdAt: string;
};

export const EXPENSE_CATEGORIES = [
  "supplies",
  "rent",
  "salary",
  "utilities",
  "equipment",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  supplies: "Supplies",
  rent: "Rent",
  salary: "Salary",
  utilities: "Utilities",
  equipment: "Equipment",
  other: "Other",
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

export type DailySummary = {
  date: string; // YYYY-MM-DD
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
