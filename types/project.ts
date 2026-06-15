// Project mode domain types.
// Money fields are decimal STRINGS — same convention as shop/booth types.

export const PROJECT_TYPES = ["short", "long"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = ["active", "closed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_MEMBER_ROLES = ["treasurer", "member", "advisor"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  treasurer: "เหรัญญิก",
  member: "สมาชิก",
  advisor: "อาจารย์ที่ปรึกษา",
};

export type Project = {
  id: string;
  name: string;
  projectType: ProjectType;
  orgName: string | null;
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
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  note: string | null;
  sortOrder: number;
  createdAt: string;
};

export type ProjectIncome = {
  id: string;
  activityId: string;
  amount: string;
  source: string;
  label: string | null;
  entryDate: string;
  note: string | null;
  receiptUrl: string | null;
  createdAt: string;
};

export type ProjectExpense = {
  id: string;
  activityId: string;
  amount: string;
  category: string;
  label: string | null;
  payerName: string | null;
  entryDate: string;
  note: string | null;
  receiptUrl: string | null;
  createdAt: string;
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
  totalSpent: string;
  remaining: string;
  budgetRemaining: string;
  budgetUsedPct: number;
  isOverBudget: boolean;
  incomeBySource: Record<string, string>;
  expenseByCategory: Record<string, string>;
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
  totalSpent: string;
  remaining: string;
  budgetRemaining: string;
  isOverBudget: boolean;
  budgetUsedPct: number;
  incomeBySource: Record<string, string>;
  expenseByCategory: Record<string, string>;
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
  totalFunding: string;
  totalSpent: string;
  remaining: string;
};
