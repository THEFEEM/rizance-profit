/** Shop partnership member — stored in shop_members (one shop per user). */

export const SHOP_MEMBER_ROLES = ["investor", "manager"] as const;
export type ShopMemberRole = (typeof SHOP_MEMBER_ROLES)[number];

export const SHOP_MEMBER_ROLE_LABELS: Record<ShopMemberRole, string> = {
  investor: "นักลงทุน",
  manager: "ผู้จัดการ",
};

export type ShopMember = {
  id: string;
  userId: string;
  name: string;
  role: ShopMemberRole;
  investmentAmount: string;
  createdAt: string;
};

export const CAPITAL_DIRECTIONS = ["contribution", "withdrawal"] as const;
export type CapitalDirection = (typeof CAPITAL_DIRECTIONS)[number];

export const CAPITAL_DIRECTION_LABELS: Record<CapitalDirection, string> = {
  contribution: "เพิ่มทุน",
  withdrawal: "ถอนทุน",
};

export type CapitalTransaction = {
  id: string;
  userId: string;
  memberId: string;
  amount: string;
  direction: CapitalDirection;
  note: string | null;
  entryDate: string;
  createdAt: string;
};
