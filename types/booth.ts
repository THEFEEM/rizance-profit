// Mode Even (booth/event mode) domain types.
// Money fields are decimal STRINGS (e.g. "420.00") — same convention as types/index.ts.

export const BOOTH_STATUSES = ["open", "closed"] as const;
export type BoothStatus = (typeof BOOTH_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BOOTH_COST_TYPES = ["fixed", "variable"] as const;
export type BoothCostType = (typeof BOOTH_COST_TYPES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
};

export const BOOTH_COST_TYPE_LABELS: Record<BoothCostType, string> = {
  fixed: "ค่าคงที่ (ค่าที่/ค่าแรง)",
  variable: "ค่าผันแปร (วัตถุดิบ/รายจ่าย)",
};

export type Booth = {
  id: string;
  name: string;
  startingBudget: string;
  startDate: string; // YYYY-MM-DD (Bangkok)
  endDate: string; // YYYY-MM-DD (Bangkok)
  status: BoothStatus;
  closedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoothIncome = {
  id: string;
  boothId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  note: string | null;
  entryDate: string;
  createdAt: string;
};

export type BoothExpense = {
  id: string;
  boothId: string;
  amount: string;
  costType: BoothCostType;
  label: string | null;
  note: string | null;
  entryDate: string;
  createdAt: string;
};

export type BoothMember = {
  id: string;
  boothId: string;
  name: string;
  role: string | null;
  createdAt: string;
};

/** Fully derived — nothing here is ever stored. */
export type BoothSummary = {
  booth: Booth;
  cashIncome: string;
  transferIncome: string;
  totalIncome: string;
  fixedExpense: string;
  variableExpense: string;
  totalExpense: string;
  profit: string; // totalIncome − totalExpense (starting budget shown separately)
  incomeCount: number;
  expenseCount: number;
};

/** Result of a booth entry write; failures are explicit, not thrown. */
export type BoothEntryResult<T> =
  | { ok: true; entry: T }
  | { ok: false; reason: "booth_not_found" | "booth_closed" | "date_out_of_range" };

export type BoothUpdateResult =
  | { ok: true; booth: Booth }
  | {
      ok: false;
      reason: "booth_not_found" | "booth_closed" | "entries_outside_new_range";
      count?: number;
    };
