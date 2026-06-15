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
