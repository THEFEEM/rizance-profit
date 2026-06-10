export type User = {
  id: string;
  email: string;
  shopName: string;
  currency: string;
  createdAt: string;
};

// Money fields are decimal STRINGS (e.g. "420.00") to preserve exact decimals.
export const INCOME_CATEGORIES = ["storefront", "delivery", "other"] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const INCOME_CATEGORY_LABELS: Record<IncomeCategory, string> = {
  storefront: "ขายหน้าร้าน",
  delivery: "เดลิเวอรี",
  other: "อื่นๆ",
};

export const INCOME_CATEGORY_OPTIONS: {
  value: IncomeCategory;
  label: string;
  icon: string;
}[] = [
  { value: "storefront", label: "ขายหน้าร้าน", icon: "🏪" },
  { value: "delivery", label: "เดลิเวอรี", icon: "🛵" },
  { value: "other", label: "อื่นๆ", icon: "⋯" },
];

export type Income = {
  id: string;
  amount: string;
  category: IncomeCategory;
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
  supplies: "วัตถุดิบ",
  rent: "ค่าเช่า",
  salary: "ค่าแรง",
  utilities: "สาธารณูปโภค",
  equipment: "อุปกรณ์",
  other: "อื่นๆ",
};

export const EXPENSE_CATEGORY_OPTIONS: {
  value: ExpenseCategory;
  label: string;
  icon: string;
}[] = [
  { value: "supplies", label: "วัตถุดิบ", icon: "📦" },
  { value: "rent", label: "ค่าเช่า", icon: "🏢" },
  { value: "salary", label: "ค่าแรง", icon: "👥" },
  { value: "utilities", label: "สาธารณูปโภค", icon: "⚡" },
  { value: "equipment", label: "อุปกรณ์", icon: "🔧" },
  { value: "other", label: "อื่นๆ", icon: "⋯" },
];

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
