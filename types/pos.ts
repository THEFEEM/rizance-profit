export const POS_PAYMENT_METHODS = ["cash", "promptpay"] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

export type PosBillStatus = "paid" | "voided";

export type PosBill = {
  id: string;
  userId: string;
  billNo: string;
  status: PosBillStatus;
  totalAmount: string;
  paymentMethod: PosPaymentMethod;
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
  paymentMethod: PosPaymentMethod;
  paidAt: string;
  voidedAt: string | null;
  itemCount: number;
};

export type PosBillDetail = PosBill & {
  voidedAt: string | null;
  voidReason: string | null;
  items: PosBillItem[];
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
  modifiers?: PosBillItemModifier[];
};

export type ClosePosBillInput = {
  items: { productId: string; qty: number; modifierIds?: string[] }[];
  paymentMethod: PosPaymentMethod;
  entryDate?: string;
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
  negativeStockProductIds: string[];
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
