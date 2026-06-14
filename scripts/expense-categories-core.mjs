// Mirrors lib/expense-categories.ts for Node test scripts (keep in sync).
export const EXPENSE_CATEGORY_KEYS = [
  "rent",
  "wage",
  "equipment",
  "materials",
  "utilities",
  "shipping",
  "marketing",
  "expense_misc",
];

export const INCOME_CATEGORY_KEYS = [
  "storefront",
  "online",
  "delivery",
  "service",
  "other_income",
  "misc",
];

export const EXPENSE_CATEGORIES = [
  { key: "rent", label: "ค่าเช่า", type: "fixed" },
  { key: "wage", label: "ค่าแรง", type: "fixed" },
  { key: "equipment", label: "อุปกรณ์", type: "fixed" },
  { key: "materials", label: "วัตถุดิบ", type: "variable" },
  { key: "utilities", label: "สาธารณูปโภค", type: "variable" },
  { key: "shipping", label: "ขนส่ง", type: "variable" },
  { key: "marketing", label: "การตลาด", type: "variable" },
  { key: "expense_misc", label: "อื่นๆ", type: "variable" },
];

export const INCOME_CATEGORIES = [
  { key: "storefront", label: "ขายหน้าร้าน" },
  { key: "online", label: "ขายออนไลน์" },
  { key: "delivery", label: "เดลิเวอรี" },
  { key: "service", label: "บริการ" },
  { key: "other_income", label: "รายได้อื่น" },
  { key: "misc", label: "อื่นๆ" },
];

const EXPENSE_TYPE_BY_KEY = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.key, c.type]),
);

const LEGACY_INCOME_TO_CANONICAL = {
  storefront: "storefront",
  delivery: "delivery",
  other: "other_income",
};

const LEGACY_EXPENSE_TO_CANONICAL = {
  supplies: "materials",
  rent: "rent",
  salary: "wage",
  utilities: "utilities",
  equipment: "equipment",
  other: "expense_misc",
};

export function getExpenseType(categoryKey) {
  return EXPENSE_TYPE_BY_KEY[categoryKey] ?? null;
}

export function isFixed(categoryKey) {
  return getExpenseType(categoryKey) === "fixed";
}

export function normalizeIncomeCategory(value, fallback = "storefront") {
  if (!value) return fallback;
  if (INCOME_CATEGORY_KEYS.includes(value)) return value;
  if (value in LEGACY_INCOME_TO_CANONICAL) return LEGACY_INCOME_TO_CANONICAL[value];
  return fallback;
}

export function boothCategoryFromCostType(costType, label) {
  if (costType === "variable") return "materials";
  const text = label?.trim() ?? "";
  if (text) {
    if (text.includes("พนักงาน") || text.includes("ค่าแรง")) return "wage";
    if (text.includes("ค่าที่")) return "rent";
    if (text.includes("น้ำมัน")) return "expense_misc";
  }
  return "rent";
}

export function normalizeExpenseCategory(value, fallback = "expense_misc") {
  if (!value) return fallback;
  if (EXPENSE_CATEGORY_KEYS.includes(value)) return value;
  if (value in LEGACY_EXPENSE_TO_CANONICAL) return LEGACY_EXPENSE_TO_CANONICAL[value];
  return fallback;
}
