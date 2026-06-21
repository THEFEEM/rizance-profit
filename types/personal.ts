/** Personal income entry — stored in personal_income_entries. */
export type PersonalIncome = {
  id: string;
  userId: string;
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
  createdAt: string;
  savingsGoalId?: string | null;
  isSavingsWithdrawal?: boolean;
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
  savingsGoalId?: string | null;
  isSavingsDeposit?: boolean;
};

/** Per-day income/expense/balance for personal charts (operating only). */
export type PersonalDailyPoint = {
  date: string;
  income: string;
  expense: string;
  balance: string;
};

/** Derived personal totals — never stored. */
export type PersonalSummary = {
  /** Operating income — excludes savings withdrawals. */
  income: string;
  /** Operating expense — excludes savings deposits. */
  expense: string;
  /** Operating surplus (income − expense). */
  balance: string;
  /** Cash on hand — all income − all expense including savings moves. */
  walletBalance: string;
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
  savingsGoalId?: string | null;
  savingsGoalName?: string | null;
};

/** Savings goal — current_amount cached from deposit/withdrawal transactions. */
export type SavingsGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  createdAt: string;
};

/** Savings deposit or withdrawal linked to a goal. */
export type SavingsTransaction = {
  id: string;
  kind: "deposit" | "withdrawal";
  amount: string;
  goalId: string | null;
  goalName: string;
  entryDate: string;
  note: string | null;
  createdAt: string;
};
