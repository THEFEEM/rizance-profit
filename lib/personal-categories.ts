/**
 * Personal mode income/expense category keys, labels, and icons.
 */

export const PERSONAL_INCOME_KEYS = [
  "salary",
  "business",
  "freelance",
  "scholarship",
  "family",
  "bonus",
  "loan_return",
  "other_income",
] as const;

export type PersonalIncomeKey = (typeof PERSONAL_INCOME_KEYS)[number];

export const PERSONAL_EXPENSE_KEYS = [
  "food",
  "transport",
  "education",
  "rent",
  "water",
  "electricity",
  "internet",
  "phone",
  "health",
  "clothing",
  "donation",
  "installment",
  "social",
  "other_expense",
] as const;

export type PersonalExpenseKey = (typeof PERSONAL_EXPENSE_KEYS)[number];

export const PERSONAL_INCOME_LABELS: Record<PersonalIncomeKey, string> = {
  salary: "เงินเดือน",
  business: "ธุรกิจ",
  freelance: "ฟรีแลนซ์",
  scholarship: "ทุนการศึกษา",
  family: "เงินจากครอบครัว",
  bonus: "โบนัส",
  loan_return: "เงินกู้คืนมา",
  other_income: "อื่นๆ",
};

export const PERSONAL_INCOME_ICONS: Record<PersonalIncomeKey, string> = {
  salary: "💰",
  business: "💼",
  freelance: "💻",
  scholarship: "🎓",
  family: "👨‍👩‍👧",
  bonus: "🎁",
  loan_return: "💸",
  other_income: "···",
};

export const PERSONAL_EXPENSE_LABELS: Record<PersonalExpenseKey, string> = {
  food: "อาหาร",
  transport: "เดินทาง",
  education: "การศึกษา",
  rent: "ค่าเช่า/ที่พัก",
  water: "ค่าน้ำ",
  electricity: "ค่าไฟ",
  internet: "ค่าเน็ต",
  phone: "ค่าโทรศัพท์",
  health: "สุขภาพ",
  clothing: "เสื้อผ้า",
  donation: "บริจาค",
  installment: "ผ่อน/บัตรเครดิต",
  social: "สังคม",
  other_expense: "อื่นๆ",
};

export const PERSONAL_EXPENSE_ICONS: Record<PersonalExpenseKey, string> = {
  food: "🍔",
  transport: "🚌",
  education: "📚",
  rent: "🏠",
  water: "💧",
  electricity: "⚡",
  internet: "📱",
  phone: "📞",
  health: "🏥",
  clothing: "👕",
  donation: "🤝",
  installment: "💳",
  social: "👥",
  other_expense: "···",
};

export const PERSONAL_INCOME_GRID_OPTIONS = PERSONAL_INCOME_KEYS.map((key) => ({
  value: key,
  label: PERSONAL_INCOME_LABELS[key],
  icon: PERSONAL_INCOME_ICONS[key],
}));

export const PERSONAL_EXPENSE_GRID_OPTIONS = PERSONAL_EXPENSE_KEYS.map((key) => ({
  value: key,
  label: PERSONAL_EXPENSE_LABELS[key],
  icon: PERSONAL_EXPENSE_ICONS[key],
}));

export function personalIncomeLabel(key: string): string {
  return PERSONAL_INCOME_LABELS[key as PersonalIncomeKey] ?? key;
}

export function personalExpenseLabel(key: string): string {
  return PERSONAL_EXPENSE_LABELS[key as PersonalExpenseKey] ?? key;
}

export function personalIncomeIcon(key: string): string {
  return PERSONAL_INCOME_ICONS[key as PersonalIncomeKey] ?? "💰";
}

export function personalExpenseIcon(key: string): string {
  return PERSONAL_EXPENSE_ICONS[key as PersonalExpenseKey] ?? "📦";
}

export function isPersonalIncomeKey(key: string): key is PersonalIncomeKey {
  return (PERSONAL_INCOME_KEYS as readonly string[]).includes(key);
}

export function isPersonalExpenseKey(key: string): key is PersonalExpenseKey {
  return (PERSONAL_EXPENSE_KEYS as readonly string[]).includes(key);
}
