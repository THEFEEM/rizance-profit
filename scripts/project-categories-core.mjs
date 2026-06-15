// Mirrors lib/project-categories.ts for Node test scripts (keep in sync).
export const PROJECT_FUNDING_KEYS = [
  "faculty_grant",
  "membership",
  "participant_fee",
  "sponsor",
  "donation",
  "activity_income",
  "other_income",
];

export const PROJECT_EXPENSE_KEYS = [
  "venue",
  "food",
  "transport",
  "materials",
  "printing",
  "reward",
  "service",
  "other_expense",
];

export const PROJECT_FUNDING_SOURCES = [
  { key: "faculty_grant", label: "งบจากคณะ/มหา'ลัย" },
  { key: "membership", label: "ค่าสมาชิก" },
  { key: "participant_fee", label: "ค่าสมัคร/ค่าเข้าร่วม" },
  { key: "sponsor", label: "เงินสนับสนุน/สปอนเซอร์" },
  { key: "donation", label: "เงินบริจาค" },
  { key: "activity_income", label: "รายได้จากกิจกรรม" },
  { key: "other_income", label: "อื่นๆ" },
];

export const PROJECT_EXPENSE_CATEGORIES = [
  { key: "venue", label: "สถานที่" },
  { key: "food", label: "อาหาร/เครื่องดื่ม" },
  { key: "transport", label: "ขนส่ง/เดินทาง" },
  { key: "materials", label: "วัสดุ/อุปกรณ์" },
  { key: "printing", label: "เอกสาร/ของที่ระลึก" },
  { key: "reward", label: "ของรางวัล" },
  { key: "service", label: "ค่าจ้าง/บริการ" },
  { key: "other_expense", label: "อื่นๆ" },
];

export function projectFundingLabel(key) {
  return PROJECT_FUNDING_SOURCES.find((c) => c.key === key)?.label ?? key;
}

export function projectExpenseLabel(key) {
  return PROJECT_EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
