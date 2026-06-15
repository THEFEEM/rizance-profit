/**
 * Project mode funding sources + expense categories (system-defined, fixed).
 */

export const PROJECT_FUNDING_KEYS = [
  "faculty_grant",
  "membership",
  "participant_fee",
  "sponsor",
  "donation",
  "activity_income",
  "other_income",
] as const;

export type ProjectFundingKey = (typeof PROJECT_FUNDING_KEYS)[number];

export const PROJECT_EXPENSE_KEYS = [
  "venue",
  "food",
  "transport",
  "materials",
  "printing",
  "reward",
  "service",
  "other_expense",
] as const;

export type ProjectExpenseKey = (typeof PROJECT_EXPENSE_KEYS)[number];

export type ProjectFundingDef = {
  key: ProjectFundingKey;
  label: string;
};

export type ProjectExpenseDef = {
  key: ProjectExpenseKey;
  label: string;
};

export const PROJECT_FUNDING_SOURCES: readonly ProjectFundingDef[] = [
  { key: "faculty_grant", label: "งบจากคณะ/มหา'ลัย" },
  { key: "membership", label: "ค่าสมาชิก" },
  { key: "participant_fee", label: "ค่าสมัคร/ค่าเข้าร่วม" },
  { key: "sponsor", label: "เงินสนับสนุน/สปอนเซอร์" },
  { key: "donation", label: "เงินบริจาค" },
  { key: "activity_income", label: "รายได้จากกิจกรรม" },
  { key: "other_income", label: "อื่นๆ" },
] as const;

export const PROJECT_EXPENSE_CATEGORIES: readonly ProjectExpenseDef[] = [
  { key: "venue", label: "สถานที่" },
  { key: "food", label: "อาหาร/เครื่องดื่ม" },
  { key: "transport", label: "ขนส่ง/เดินทาง" },
  { key: "materials", label: "วัสดุ/อุปกรณ์" },
  { key: "printing", label: "เอกสาร/ของที่ระลึก" },
  { key: "reward", label: "ของรางวัล" },
  { key: "service", label: "ค่าจ้าง/บริการ" },
  { key: "other_expense", label: "อื่นๆ" },
] as const;

const FUNDING_LABELS = Object.fromEntries(
  PROJECT_FUNDING_SOURCES.map((c) => [c.key, c.label]),
) as Record<ProjectFundingKey, string>;

const EXPENSE_LABELS = Object.fromEntries(
  PROJECT_EXPENSE_CATEGORIES.map((c) => [c.key, c.label]),
) as Record<ProjectExpenseKey, string>;

export function projectFundingLabel(key: string): string {
  return FUNDING_LABELS[key as ProjectFundingKey] ?? key;
}

export function projectExpenseLabel(key: string): string {
  return EXPENSE_LABELS[key as ProjectExpenseKey] ?? key;
}

export function isProjectFundingKey(key: string): key is ProjectFundingKey {
  return (PROJECT_FUNDING_KEYS as readonly string[]).includes(key);
}

export function isProjectExpenseKey(key: string): key is ProjectExpenseKey {
  return (PROJECT_EXPENSE_KEYS as readonly string[]).includes(key);
}
