export const POS_PAYMENT_METHODS = ["cash", "promptpay", "thai_chuay_thai"] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

/** Bill-level method: single method, or 'split' when paid via multiple methods. */
export type PosBillPaymentMethod = PosPaymentMethod | "split";

export type PosBillPayment = {
  id: string;
  billId: string;
  method: PosPaymentMethod;
  amount: string;
  incomeEntryId: string | null;
  sortOrder: number;
};

export type PosBillStatus = "paid" | "voided";

export type PosBill = {
  id: string;
  userId: string;
  billNo: string;
  status: PosBillStatus;
  totalAmount: string;
  paymentMethod: PosBillPaymentMethod;
  entryDate: string;
  incomeEntryId: string | null;
  createdAt: string;
  voidedAt?: string | null;
  voidReason?: string | null;
};

export type PosBillListItem = {
  id: string;
  billNo: string;
  status: PosBillStatus;
  total: string;
  paymentMethod: PosBillPaymentMethod;
  paidAt: string;
  voidedAt: string | null;
  itemCount: number;
};

export type PosBillDetail = PosBill & {
  voidedAt: string | null;
  voidReason: string | null;
  items: PosBillItem[];
  payments?: PosBillPayment[];
};

export type VoidPosBillResult = {
  billId: string;
  status: "voided";
};

export type PosBillItemModifier = {
  modifierName: string;
  priceDelta: string;
};

export type PosBillItem = {
  id: string;
  billId: string;
  productId: string | null;
  productName: string;
  unitSellPrice: string;
  unitCostPrice: string;
  quantity: string;
  lineTotal: string;
  lineCost: string;
  sortOrder: number;
  /** โน้ตต่อรายการ เช่น "ไม่ใส่ผัก" (snapshot ตอนขาย) */
  note: string | null;
  modifiers?: PosBillItemModifier[];
};

export type ClosePosBillInput = {
  items: { productId: string; qty: number; modifierIds?: string[]; note?: string }[];
  /**
   * คอมโบ (0071) — ราคาและรายการสินค้าอ่านจาก DB ฝั่งเซิร์ฟเวอร์
   * client ส่งมาแค่ "คอมโบใบไหน กี่ชุด" กำหนดราคาเองไม่ได้
   */
  combos?: { comboId: string; qty: number }[];
  /** ค่าบริการเพิ่ม เช่น ค่าส่ง — กลายเป็นบรรทัดในบิล (ไม่มี product_id) */
  surcharges?: { label: string; amount: number }[];
  /** Legacy single-method checkout (full amount). Ignored when `payments` present. */
  paymentMethod?: PosPaymentMethod;
  /** Split payment: 1..3 entries, Σ amount must equal the bill total exactly. */
  payments?: { method: PosPaymentMethod; amount: number }[];
  entryDate?: string;
  /**
   * ผูกบิลนี้เข้าออเดอร์ใน transaction เดียวกัน (กันบิลกำพร้า)
   * ผูกไม่ได้ = ทั้งบิล rollback
   */
  linkOrderId?: string;
  /**
   * เบอร์สมาชิกที่จะให้แต้มจากบิลนี้ (ไม่บังคับ)
   * ⚠️ แต้มไม่ใช่เงิน — ไม่แตะ total_amount / income_entries / journal
   */
  memberPhone?: string;
  /** ชื่อลูกค้า — เก็บตอนสมัครครั้งแรก ให้บัตรทักชื่อได้ */
  memberName?: string;
  /**
   * Campaign (0074) — client ส่งได้แค่ id หรือ coupon code
   * ⚠️ ห้ามรับจำนวนเงินส่วนลดจาก client เด็ดขาด — server คำนวณใหม่ทั้งหมด
   */
  campaignId?: string;
  couponCode?: string;
};

export type PosModifier = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: string;
  isActive: boolean;
  sortOrder: number;
};

export type PosModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  modifiers: PosModifier[];
};

export type ClosePosBillResult = {
  bill: PosBill;
  items: PosBillItem[];
  payments: PosBillPayment[];
  negativeStockProductIds: string[];
  /** แต้มที่ให้จากบิลนี้ (0 = ร้านปิดใช้แต้ม / ไม่มีสมาชิก / ยอดไม่ถึง 1 แต้ม) */
  pointsEarned?: number;
  memberPoints?: number;  /** ส่วนลดแคมเปญที่ apply ไป (0074) — undefined เมื่อไม่ได้ใช้ */
  campaign?: { name: string; discountAmount: string; subtotalBefore: string };
};

export type PosCategory = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

export type PosProductPublic = {
  id: string;
  name: string;
  sellPrice: string;
  trackStock: boolean;
  stockQty: string;
  categoryId: string | null;
  unit: string | null;
  imageUrl: string | null;
  /** Modifier groups attached to this product (ordered). */
  modifierGroupIds?: string[];
  isActive?: boolean;
  /** Only present when GET ?includeCost=1 (products management). Never on sell catalog. */
  costPrice?: string;
};

export type PosProduct = PosProductPublic & {
  costPrice: string;
  isActive: boolean;
  sortOrder: number;
};

export type PosCatalog = {
  categories: PosCategory[];
  products: PosProductPublic[];
  modifierGroups: PosModifierGroup[];
};
