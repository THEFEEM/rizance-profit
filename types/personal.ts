/** Personal income entry — stored in personal_income_entries. */
export type PersonalIncome = {
  id: string;
  userId: string;
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
  createdAt: string;
};

/** Personal expense entry — stored in personal_expense_entries. */
export type PersonalExpense = {
  id: string;
  userId: string;
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
  createdAt: string;
};

/** Per-day income/expense/balance for personal charts. */
export type PersonalDailyPoint = {
  date: string;
  income: string;
  expense: string;
  balance: string;
};

/** Derived personal totals — never stored. */
export type PersonalSummary = {
  income: string;
  expense: string;
  balance: string;
  incomeCount: number;
  expenseCount: number;
};

export type PersonalCategoryBreakdownItem = {
  category: string;
  amount: string;
  count: number;
};

/** Merged personal ledger row for entry lists. */
export type PersonalEntryRow = {
  id: string;
  kind: "income" | "expense";
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
  createdAt: string;
};

/** Savings goal — target only; saved amount is computed from personal balance. */
export type SavingsGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: string;
  createdAt: string;
};
