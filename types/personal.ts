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

/** Savings goal — target only; saved amount is computed from personal balance. */
export type SavingsGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: string;
  createdAt: string;
};
