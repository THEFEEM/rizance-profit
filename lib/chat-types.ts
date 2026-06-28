export type ChatCardData = {
  kind: "income" | "expense";
  amount: string;
  category: string;
  categoryLabel: string;
  paymentMethod: "cash" | "transfer";
  note: string | null;
  entryDate: string;
  confidence: "low" | "medium" | "high";
};

export type ReceiptLineItem = {
  id: string;
  note: string;
  amount: string;
  category: string;
  categoryLabel: string;
  confidence: "low" | "medium" | "high";
  selected: boolean;
};

export type ReceiptItemChanges = {
  category?: string;
  note?: string;
  amount?: string;
};

export type ChatReceiptCardData = {
  cardType: "receipt_split";
  kind: "expense";
  merchantName: string | null;
  entryDate: string;
  paymentMethod: "cash" | "transfer";
  totalAmount: string;
  itemsSum: string;
  status: "pending" | "confirmed" | "cancelled";
  items: ReceiptLineItem[];
  entryIds?: string[];
  confidence: "low" | "medium" | "high";
};

export type ChatCardPayload = ChatCardData | ChatReceiptCardData;

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string | null;
  imageThumb: string | null;
  entryId: string | null;
  entryKind: "income" | "expense" | null;
  cardData: ChatCardPayload | null;
  createdAt: string;
  isLoading?: boolean;
};

export const RECEIPT_ITEM_CATEGORY_KEYS = [
  "materials",
  "equipment",
  "beverages",
  "packaging",
  "utilities",
  "other",
] as const;

export type ReceiptItemCategoryKey = (typeof RECEIPT_ITEM_CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  materials: "วัตถุดิบ",
  equipment: "อุปกรณ์",
  beverages: "เครื่องดื่ม",
  packaging: "บรรจุภัณฑ์",
  utilities: "สาธารณูปโภค",
  other: "อื่นๆ",
  food: "อาหาร",
  salary: "เงินเดือน",
  marketing: "การตลาด",
  rent: "ค่าเช่า",
  transport: "ขนส่ง",
};

export function isReceiptSplitCard(
  card: ChatCardPayload | null,
): card is ChatReceiptCardData {
  return card != null && "cardType" in card && card.cardType === "receipt_split";
}
