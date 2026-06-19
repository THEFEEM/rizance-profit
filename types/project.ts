// Project mode domain types.
// Money fields are decimal STRINGS — same convention as shop/booth types.

export const PROJECT_TYPES = ["short", "long"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = ["planning", "active", "closed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "approved", "paid", "rejected"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PROJECT_MEMBER_ROLES = ["president", "treasurer", "member", "advisor"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  president: "ประธาน",
  treasurer: "เหรัญญิก",
  member: "สมาชิก",
  advisor: "อาจารย์ที่ปรึกษา",
};

export type Project = {
  id: string;
  name: string;
  projectType: ProjectType;
  orgName: string | null;
  projectCode: string | null;
  objective: string | null;
  chairmanName: string | null;
  budgetTarget: string;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  note: string | null;
  createdAt: string;
};

export type ProjectActivity = {
  id: string;
  projectId: string;
  name: string;
  budgetTarget: string;
  chairmanName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  note: string | null;
  isGeneral: boolean;
  sortOrder: number;
  createdAt: string;
};

export const PROJECT_INCOME_PAYMENT_METHODS = ["cash", "transfer"] as const;
export type ProjectIncomePaymentMethod = (typeof PROJECT_INCOME_PAYMENT_METHODS)[number];

export type ProjectIncome = {
  id: string;
  activityId: string;
  amount: string;
  source: string;
  label: string | null;
  entryDate: string;
  note: string | null;
  receiptUrl: string | null;
  paymentMethod: ProjectIncomePaymentMethod;
  paymentStatus: PaymentStatus;
  createdAt: string;
};

export type ProjectExpense = {
  id: string;
  activityId: string;
  amount: string;
  category: string;
  label: string | null;
  payerName: string | null;
  /** Income source key, or null = กองกลาง (unassigned). */
  fundSource: string | null;
  entryDate: string;
  note: string | null;
  receiptUrl: string | null;
  isAdvance: boolean;
  reimbursedAt: string | null;
  paymentStatus: PaymentStatus;
  createdAt: string;
};

/** Per-fund balance — derived, never stored. */
export type FundBalance = {
  sourceKey: string;
  sourceLabel: string;
  totalReceived: string;
  totalSpent: string;
  remaining: string;
  isOverspent: boolean;
};

export type ProjectMember = {
  id: string;
  projectId: string;
  name: string;
  role: ProjectMemberRole;
  note: string | null;
  createdAt: string;
};

/** Derived activity totals — never stored. */
export type ActivitySummary = {
  activityId: string;
  name: string;
  budgetTarget: string;
  totalFunding: string;
  paidFunding: string;
  committedFunding: string;
  cashFunding: string;
  transferFunding: string;
  rejectedFundingCount: number;
  totalSpent: string;
  paidSpent: string;
  committedSpent: string;
  advanceTotal: string;
  advanceUnreimbursed: string;
  advanceByPayer: Array<{ payerName: string; total: string; unreimbursed: string }>;
  rejectedExpenseCount: number;
  remaining: string;
  budgetRemaining: string;
  budgetUsedPct: number;
  isOverBudget: boolean;
  incomeBySource: Record<string, string>;
  expenseByCategory: Record<string, string>;
  fundBreakdown: FundBalance[];
  unassignedSpent: string;
  incomeCount: number;
  expenseCount: number;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
};

/** Derived project rollup — never stored. */
export type ProjectSummary = {
  projectId: string;
  name: string;
  projectType: ProjectType;
  orgName: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  totalBudgetTarget: string;
  totalFunding: string;
  paidFunding: string;
  committedFunding: string;
  rejectedFundingCount: number;
  totalSpent: string;
  paidSpent: string;
  committedSpent: string;
  rejectedExpenseCount: number;
  remaining: string;
  budgetRemaining: string;
  isOverBudget: boolean;
  budgetUsedPct: number;
  incomeBySource: Record<string, string>;
  expenseByCategory: Record<string, string>;
  fundBreakdown: FundBalance[];
  unassignedSpent: string;
  activities: ActivitySummary[];
  activityCount: number;
  closedActivityCount: number;
};

/** Compact list row for GET /api/projects. */
export type ProjectListItem = {
  id: string;
  name: string;
  projectType: ProjectType;
  orgName: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  activityCount: number;
  totalFunding: string;
  totalSpent: string;
  remaining: string;
};
