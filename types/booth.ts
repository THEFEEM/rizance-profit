// Mode Even (booth/event mode) domain types.
// Money fields are decimal STRINGS (e.g. "420.00") — same convention as types/index.ts.

export const BOOTH_STATUSES = ["open", "closed"] as const;
export type BoothStatus = (typeof BOOTH_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BOOTH_COST_TYPES = ["fixed", "variable"] as const;
export type BoothCostType = (typeof BOOTH_COST_TYPES)[number];

export const PROFIT_SPLIT_METHODS = ["equal", "by_equity"] as const;
export type ProfitSplitMethod = (typeof PROFIT_SPLIT_METHODS)[number];

export const MEMBER_ROLES = ["investor", "employee", "manager"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const WAGE_TYPES = ["daily", "event"] as const;
export type WageType = (typeof WAGE_TYPES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
};

export const BOOTH_COST_TYPE_LABELS: Record<BoothCostType, string> = {
  fixed: "ค่าคงที่ (ค่าที่/ค่าแรง)",
  variable: "ค่าผันแปร (วัตถุดิบ/รายจ่าย)",
};

export const PROFIT_SPLIT_METHOD_LABELS: Record<ProfitSplitMethod, string> = {
  equal: "เท่ากัน",
  by_equity: "ตามสัดส่วนลงทุน",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  investor: "นักลงทุน",
  employee: "พนักงาน",
  manager: "ผู้จัดการ",
};

export const WAGE_TYPE_LABELS: Record<WageType, string> = {
  daily: "รายวัน",
  event: "ต่องาน",
};

export type Booth = {
  id: string;
  name: string;
  poolBudget: string;
  /** When true, pool_budget participates as virtual shareholder in profit split. */
  poolGetsShare: boolean;
  profitSplitMethod: ProfitSplitMethod;
  /** SUM(investment_amount) for investors + managers — derived. */
  memberEquity: string;
  /** poolBudget + memberEquity — derived, never stored. */
  totalBudget: string;
  startDate: string;
  endDate: string;
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
  category: string;
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
  /** Canonical expense category — fixed/variable derived via isFixed(category). */
  category: string;
  label: string | null;
  note: string | null;
  payerMemberId: string | null;
  /** Trimmed non-empty when payer is outside the member list. */
  externalPayerName: string | null;
  entryDate: string;
  createdAt: string;
};

export type BoothMember = {
  id: string;
  boothId: string;
  name: string;
  role: MemberRole;
  investmentAmount: string;
  wageAmount: string | null;
  wageType: WageType | null;
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
  /** Expenses from booth_expense_entries only. */
  entryExpense: string;
  /** Computed from employee + manager wage fields. */
  wageCost: string;
  /** entryExpense + wageCost — used for budget bar. */
  totalExpense: string;
  profit: string;
  incomeCount: number;
  expenseCount: number;
};

export type {
  SplitProfitResult,
  MemberShare,
  AdvanceRepayment,
  PoolShare,
} from "@/lib/booth-split";

/** Result of a booth entry write; failures are explicit, not thrown. */
export type BoothEntryResult<T> =
  | { ok: true; entry: T }
  | {
      ok: false;
      reason:
        | "booth_not_found"
        | "booth_closed"
        | "date_out_of_range"
        | "invalid_payer"
        | "invalid_advance_payer";
    };

export type BoothUpdateResult =
  | { ok: true; booth: Booth }
  | {
      ok: false;
      reason: "booth_not_found" | "booth_closed" | "entries_outside_new_range";
      count?: number;
    };

export type BoothMemberResult =
  | { ok: true; member: BoothMember }
  | {
      ok: false;
      reason: "booth_not_found" | "booth_closed" | "member_not_found" | "invalid_payer";
    };

/** Close is permanent in v1 — no reopen. */
export type BoothCloseResult =
  | { ok: true; booth: Booth }
  | { ok: false; reason: "booth_not_found" | "already_closed" };
