import type { ReactNode } from "react";
import {
  Bike,
  Briefcase,
  Building,
  Car,
  Coins,
  CreditCard,
  Droplet,
  Ellipsis,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  HeartPulse,
  Laptop,
  Lightbulb,
  Megaphone,
  Package,
  PartyPopper,
  Shirt,
  Smartphone,
  Store,
  Truck,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_COST_TYPE_LABELS,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_OPTIONS,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";
import {
  PERSONAL_EXPENSE_KEYS,
  PERSONAL_EXPENSE_LABELS,
  PERSONAL_INCOME_KEYS,
  PERSONAL_INCOME_LABELS,
  type PersonalExpenseKey,
  type PersonalIncomeKey,
} from "@/lib/personal-categories";

const ICON_PROPS = { strokeWidth: 2, "aria-hidden": true as const };

function renderIcon(Icon: LucideIcon, size = 20, className = ""): ReactNode {
  return <Icon size={size} className={className} {...ICON_PROPS} />;
}

const PERSONAL_INCOME_LUCIDE: Record<PersonalIncomeKey, LucideIcon> = {
  salary: Wallet,
  business: Briefcase,
  freelance: Laptop,
  scholarship: Coins,
  family: Users,
  bonus: Gift,
  loan_return: HandCoins,
  other_income: Ellipsis,
};

const PERSONAL_EXPENSE_LUCIDE: Record<PersonalExpenseKey, LucideIcon> = {
  food: Utensils,
  transport: Car,
  education: GraduationCap,
  rent: Building,
  water: Droplet,
  electricity: Zap,
  internet: Wifi,
  phone: Smartphone,
  health: HeartPulse,
  clothing: Shirt,
  donation: HandHeart,
  installment: CreditCard,
  social: PartyPopper,
  other_expense: Ellipsis,
};

const SHOP_INCOME_LUCIDE: Record<IncomeCategoryKey, LucideIcon> = {
  storefront: Store,
  online: Package,
  delivery: Bike,
  service: Wrench,
  other_income: Lightbulb,
  misc: Ellipsis,
};

const SHOP_EXPENSE_LUCIDE: Record<ExpenseCategoryKey, LucideIcon> = {
  rent: Store,
  wage: Users,
  equipment: Wrench,
  materials: Package,
  utilities: Zap,
  shipping: Truck,
  marketing: Megaphone,
  expense_misc: Ellipsis,
};

export function renderPersonalIncomeIcon(key: string, size = 20, className = ""): ReactNode {
  const Icon = PERSONAL_INCOME_LUCIDE[key as PersonalIncomeKey] ?? Wallet;
  return renderIcon(Icon, size, className);
}

export function renderPersonalExpenseIcon(key: string, size = 20, className = ""): ReactNode {
  const Icon = PERSONAL_EXPENSE_LUCIDE[key as PersonalExpenseKey] ?? Ellipsis;
  return renderIcon(Icon, size, className);
}

export function renderShopIncomeIcon(key: string, size = 20, className = ""): ReactNode {
  const Icon = SHOP_INCOME_LUCIDE[key as IncomeCategoryKey] ?? Store;
  return renderIcon(Icon, size, className);
}

export function renderShopExpenseIcon(key: string, size = 20, className = ""): ReactNode {
  const Icon = SHOP_EXPENSE_LUCIDE[key as ExpenseCategoryKey] ?? Ellipsis;
  return renderIcon(Icon, size, className);
}

export function renderCategoryIcon(
  ledger: "personal" | "shop",
  kind: "income" | "expense",
  key: string,
  size = 20,
  className = "",
): ReactNode {
  if (ledger === "personal") {
    return kind === "income"
      ? renderPersonalIncomeIcon(key, size, className)
      : renderPersonalExpenseIcon(key, size, className);
  }
  return kind === "income"
    ? renderShopIncomeIcon(key, size, className)
    : renderShopExpenseIcon(key, size, className);
}

export const PERSONAL_INCOME_GRID_OPTIONS = PERSONAL_INCOME_KEYS.map((key) => ({
  value: key,
  label: PERSONAL_INCOME_LABELS[key],
  icon: renderPersonalIncomeIcon(key, 22),
}));

export const PERSONAL_EXPENSE_GRID_OPTIONS = PERSONAL_EXPENSE_KEYS.map((key) => ({
  value: key,
  label: PERSONAL_EXPENSE_LABELS[key],
  icon: renderPersonalExpenseIcon(key, 22),
}));

export const SHOP_INCOME_GRID_OPTIONS = INCOME_CATEGORIES.map((c) => ({
  value: c.key,
  label: c.label,
  icon: renderShopIncomeIcon(c.key, 22),
}));

export const SHOP_EXPENSE_GRID_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({
  value: c.key,
  label: c.label,
  icon: renderShopExpenseIcon(c.key, 22),
  badge: EXPENSE_COST_TYPE_LABELS[c.type],
}));

export const LEGACY_SHOP_INCOME_GRID_OPTIONS = INCOME_CATEGORY_OPTIONS.map((c) => ({
  value: c.value,
  label: c.label,
  icon: renderShopIncomeIcon(c.value === "other" ? "other_income" : c.value, 22),
}));

export const LEGACY_SHOP_EXPENSE_GRID_OPTIONS = EXPENSE_CATEGORY_OPTIONS.map((c) => ({
  value: c.value,
  label: c.label,
  icon: renderShopExpenseIcon(
    c.value === "supplies"
      ? "materials"
      : c.value === "salary"
        ? "wage"
        : c.value === "other"
          ? "expense_misc"
          : c.value,
    22,
  ),
}));
