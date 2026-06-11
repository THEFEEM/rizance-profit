export const PURCHASE_UNITS = ["ml", "g", "kg", "l", "piece", "shot", "pump"] as const;
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

export const OVERHEAD_CATEGORIES = [
  "rent",
  "electricity",
  "water",
  "internet",
  "wages",
  "other",
] as const;
export type OverheadCategory = (typeof OVERHEAD_CATEGORIES)[number];

/** Thai labels matching the Excel template. */
export const PRICING_LABELS = {
  module: "ต้นทุนและราคา",
  ingredients: "ต้นทุนวัตถุดิบ",
  recipes: "สูตรเครื่องดื่ม",
  overheads: "ค่าใช้จ่ายร้าน",
  calculate: "คำนวณราคาขาย",
  ingredientName: "วัตถุดิบ",
  purchaseSize: "ขนาดที่ซื้อ",
  purchasePrice: "ราคาที่ซื้อ",
  costPerUnit: "ต้นทุนต่อหน่วย",
  menu: "เมนู",
  quantityUsed: "ปริมาณที่ใช้",
  lineCost: "ต้นทุน",
  overheadItem: "รายการ",
  monthlyOverhead: "ค่าใช้จ่ายต่อเดือน (บาท)",
  ingredientCost: "ต้นทุนวัตถุดิบ",
  overheadPerCup: "ค่าใช้จ่ายร้านต่อแก้ว",
  totalCost: "ต้นทุนรวม",
  desiredProfit: "กำไรที่ต้องการ",
  sellingPrice: "ราคาขาย",
  cupsPerMonth: "จำนวนแก้วต่อเดือน (ประมาณ)",
  defaultProfit: "กำไรต่อแก้ว (ค่าเริ่มต้น)",
  breakEven: "จุดคุ้มทุน",
  breakEvenSingleMenu: "ถ้าขายเมนูนี้อย่างเดียว",
  contributionPerCup: "กำไรต่อแก้ว (หลังหักต้นทุนวัตถุดิบ)",
  breakEvenCups: "แก้ว/เดือนที่ต้องขาย",
  targetCups: "เป้าที่ตั้งไว้",
  aboveBreakEven: "เกินจุดคุ้มทุน",
  belowBreakEven: "ต่ำกว่าจุดคุ้มทุน",
  atBreakEven: "เท่าจุดคุ้มทุน",
  needsFixedCosts: "ยังไม่ได้กรอกต้นทุนคงที่",
} as const;

export const OVERHEAD_CATEGORY_LABELS: Record<OverheadCategory, string> = {
  rent: "ค่าเช่า",
  electricity: "ค่าไฟ",
  water: "ค่าน้ำ",
  internet: "อินเทอร์เน็ต",
  wages: "ค่าแรง",
  other: "ค่าใช้จ่ายอื่นๆ",
};

export type Ingredient = {
  id: string;
  name: string;
  purchaseQuantity: string;
  purchaseUnit: PurchaseUnit;
  purchasePrice: string;
  costPerUnit: string;
  createdAt: string;
  updatedAt: string;
};

export type MenuItem = {
  id: string;
  name: string;
  desiredProfit: string | null;
  isActive: boolean;
  ingredientCostPerCup: string;
  createdAt: string;
  updatedAt: string;
};

export type RecipeLine = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  purchaseUnit: PurchaseUnit;
  quantity: string;
  costPerUnit: string;
  lineCost: string;
};

export type Overhead = {
  id: string;
  category: OverheadCategory;
  label: string | null;
  monthlyAmount: string;
  createdAt: string;
  updatedAt: string;
};

export type PricingSettings = {
  estimatedCupsPerMonth: number;
  defaultProfitPerCup: string | null;
  updatedAt: string;
};

export type BreakEvenComparison = "above" | "below" | "at" | null;

export type BreakEvenRow = {
  menuItemId: string;
  menuName: string;
  contributionPerCup: string;
  breakEvenCups: number | null;
  noBreakEven: boolean;
  warning: string | null;
  comparison: BreakEvenComparison;
};

export type PricingSummaryRow = {
  menuItemId: string;
  menuName: string;
  ingredientCostPerCup: string;
  overheadPerCup: string | null;
  totalCostPerCup: string;
  profitPerCup: string;
  sellingPriceExact: string;
  sellingPriceDisplay: string;
  breakEven: BreakEvenRow;
};

export type PricingSummary = {
  settings: PricingSettings;
  monthlyOverheadTotal: string;
  overheadPerCup: string | null;
  /** True when cups/month is unset or zero — overhead per cup cannot be computed. */
  needsCupsPerMonth: boolean;
  /** True when monthly fixed costs sum to zero — break-even cannot be computed. */
  breakEvenNeedsSetup: boolean;
  rows: PricingSummaryRow[];
};
