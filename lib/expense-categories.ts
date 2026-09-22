/**
 * Single source of truth for income/expense category keys, labels, and
 * fixed/variable derivation (never read from DB columns).
 */

export const INCOME_CATEGORY_KEYS = [
  "storefront",
  "online",
  "delivery",
  "service",
  "other_income",
  "misc",
] as const;

export type IncomeCategoryKey = (typeof INCOME_CATEGORY_KEYS)[number];

export const EXPENSE_CATEGORY_KEYS = [
  "rent",
  "wage",
  "equipment",
  "materials",
  "utilities",
  "shipping",
  "marketing",
  "expense_misc",
] as const;

export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORY_KEYS)[number];

export type ExpenseCostType = "fixed" | "variable";

/**
 * NOTE: ไฟล์นี้เก็บ **ข้อมูล** เท่านั้น (key · label · fixed/variable)
 * การแสดงผล icon ทั้งหมดอยู่ที่ lib/category-lucide-icons.tsx (Lucide, monochrome)
 * ห้ามเพิ่ม emoji / icon string กลับมาที่นี่ — เคยมีสองแหล่งแล้วทำให้หน้าแชท
 * โหมดส่วนตัวหยิบ emoji ไปแสดงในขณะที่ฟอร์มอื่นเป็น Lucide
 */
export type IncomeCategoryDef = {
  key: IncomeCategoryKey;
  label: string;
};

export type ExpenseCategoryDef = {
  key: ExpenseCategoryKey;
  label: string;
  type: ExpenseCostType;
};

export const INCOME_CATEGORIES: IncomeCategoryDef[] = [
  { key: "storefront", label: "ขายหน้าร้าน" },
  { key: "online", label: "ขายออนไลน์" },
  { key: "delivery", label: "เดลิเวอรี" },
  { key: "service", label: "บริการ" },
  { key: "misc", label: "อื่นๆ" },
  { key: "other_income", label: "รายได้อื่น" },
];

export const EXPENSE_CATEGORIES: ExpenseCategoryDef[] = [
  { key: "rent", label: "ค่าเช่า", type: "fixed" },
  { key: "wage", label: "ค่าแรง", type: "fixed" },
  { key: "equipment", label: "อุปกรณ์", type: "fixed" },
  { key: "materials", label: "วัตถุดิบ", type: "variable" },
  { key: "utilities", label: "สาธารณูปโภค", type: "variable" },
  { key: "shipping", label: "ขนส่ง", type: "variable" },
  { key: "marketing", label: "การตลาด", type: "variable" },
  { key: "expense_misc", label: "อื่นๆ", type: "variable" },
];

/** Display-only fixed/variable badge text under expense category chips. */
export const EXPENSE_COST_TYPE_LABELS: Record<ExpenseCostType, string> = {
  fixed: "คงที่",
  variable: "ผันแปร",
};

/** Round 1 forms still expose legacy picker values until Round 3 UI. */
export const LEGACY_INCOME_FORM_KEYS = ["storefront", "delivery", "other"] as const;
export type LegacyIncomeFormKey = (typeof LEGACY_INCOME_FORM_KEYS)[number];

export const LEGACY_EXPENSE_FORM_KEYS = [
  "supplies",
  "rent",
  "salary",
  "utilities",
  "equipment",
  "other",
] as const;
export type LegacyExpenseFormKey = (typeof LEGACY_EXPENSE_FORM_KEYS)[number];

const INCOME_LABEL_BY_KEY = Object.fromEntries(
  INCOME_CATEGORIES.map((c) => [c.key, c.label]),
) as Record<IncomeCategoryKey, string>;

const EXPENSE_LABEL_BY_KEY = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.key, c.label]),
) as Record<ExpenseCategoryKey, string>;

const EXPENSE_TYPE_BY_KEY = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.key, c.type]),
) as Record<ExpenseCategoryKey, ExpenseCostType>;

const LEGACY_INCOME_TO_CANONICAL: Record<LegacyIncomeFormKey, IncomeCategoryKey> = {
  storefront: "storefront",
  delivery: "delivery",
  other: "other_income",
};

const LEGACY_EXPENSE_TO_CANONICAL: Record<LegacyExpenseFormKey, ExpenseCategoryKey> = {
  supplies: "materials",
  rent: "rent",
  salary: "wage",
  utilities: "utilities",
  equipment: "equipment",
  other: "expense_misc",
};

export function isIncomeCategoryKey(value: string): value is IncomeCategoryKey {
  return (INCOME_CATEGORY_KEYS as readonly string[]).includes(value);
}

export function isExpenseCategoryKey(value: string): value is ExpenseCategoryKey {
  return (EXPENSE_CATEGORY_KEYS as readonly string[]).includes(value);
}

export function normalizeIncomeCategory(
  value: string | undefined | null,
  fallback: IncomeCategoryKey = "storefront",
): IncomeCategoryKey {
  if (!value) return fallback;
  if (isIncomeCategoryKey(value)) return value;
  if ((LEGACY_INCOME_FORM_KEYS as readonly string[]).includes(value)) {
    return LEGACY_INCOME_TO_CANONICAL[value as LegacyIncomeFormKey];
  }
  return fallback;
}

export function normalizeExpenseCategory(
  value: string | undefined | null,
  fallback: ExpenseCategoryKey = "expense_misc",
): ExpenseCategoryKey {
  if (!value) return fallback;
  if (isExpenseCategoryKey(value)) return value;
  if ((LEGACY_EXPENSE_FORM_KEYS as readonly string[]).includes(value)) {
    return LEGACY_EXPENSE_TO_CANONICAL[value as LegacyExpenseFormKey];
  }
  return fallback;
}

export function incomeCategoryLabel(key: string): string {
  if (isIncomeCategoryKey(key)) return INCOME_LABEL_BY_KEY[key];
  if ((LEGACY_INCOME_FORM_KEYS as readonly string[]).includes(key)) {
    return INCOME_LABEL_BY_KEY[LEGACY_INCOME_TO_CANONICAL[key as LegacyIncomeFormKey]];
  }
  return key;
}

export function expenseCategoryLabel(key: string): string {
  if (isExpenseCategoryKey(key)) return EXPENSE_LABEL_BY_KEY[key];
  if ((LEGACY_EXPENSE_FORM_KEYS as readonly string[]).includes(key)) {
    return EXPENSE_LABEL_BY_KEY[LEGACY_EXPENSE_TO_CANONICAL[key as LegacyExpenseFormKey]];
  }
  return key;
}

/** Canonical sort index for display lists (unknown keys sort last). */
export function incomeCategoryOrder(key: string): number {
  const canonical = normalizeIncomeCategory(key);
  const idx = (INCOME_CATEGORY_KEYS as readonly string[]).indexOf(canonical);
  return idx >= 0 ? idx : INCOME_CATEGORY_KEYS.length;
}

export function expenseCategoryOrder(key: string): number {
  const canonical = normalizeExpenseCategory(key);
  const idx = (EXPENSE_CATEGORY_KEYS as readonly string[]).indexOf(canonical);
  return idx >= 0 ? idx : EXPENSE_CATEGORY_KEYS.length;
}

export function getExpenseType(categoryKey: string): ExpenseCostType | null {
  if (!isExpenseCategoryKey(categoryKey)) return null;
  return EXPENSE_TYPE_BY_KEY[categoryKey];
}

export function expenseCostTypeLabel(categoryKey: string): string | null {
  const type = getExpenseType(categoryKey);
  return type ? EXPENSE_COST_TYPE_LABELS[type] : null;
}

export function isFixed(categoryKey: string): boolean {
  return getExpenseType(categoryKey) === "fixed";
}

/**
 * Round 1 booth expense form still sends cost_type only — derive category on write.
 * Uses B+ label rules when label is present; otherwise fixed→rent, variable→materials.
 */
export function boothCategoryFromCostType(
  costType: "fixed" | "variable",
  label?: string | null,
): ExpenseCategoryKey {
  if (costType === "variable") return "materials";
  const text = label?.trim() ?? "";
  if (text) {
    if (text.includes("พนักงาน") || text.includes("ค่าแรง")) return "wage";
    if (text.includes("ค่าที่")) return "rent";
    if (text.includes("น้ำมัน")) return "expense_misc";
  }
  return "rent";
}

/** Form pickers — legacy subset (Round 3 expands to full list). */
export const INCOME_CATEGORY_OPTIONS = [
  { value: "storefront" as const, label: "ขายหน้าร้าน" },
  { value: "delivery" as const, label: "เดลิเวอรี" },
  { value: "other" as const, label: "อื่นๆ" },
];

export const EXPENSE_CATEGORY_OPTIONS = [
  { value: "supplies" as const, label: "วัตถุดิบ" },
  { value: "rent" as const, label: "ค่าเช่า" },
  { value: "salary" as const, label: "ค่าแรง" },
  { value: "utilities" as const, label: "สาธารณูปโภค" },
  { value: "equipment" as const, label: "อุปกรณ์" },
  { value: "other" as const, label: "อื่นๆ" },
];

export const PAYMENT_METHODS = ["cash", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
};
