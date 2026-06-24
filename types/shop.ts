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

export type ProfitWithdrawal = {
  id: string;
  userId: string;
  memberId: string;
  amount: string;
  paymentMethod: "cash" | "transfer";
  note: string | null;
  entryDate: string;
  createdAt: string;
};

export type MemberProfitWithdrawable = {
  memberId: string;
  name: string;
  role: ShopMemberRole;
  investmentAmount: string;
  accumulatedShare: string;
  withdrawn: string;
  available: string;
};

export type CreditorRepayment = {
  id: string;
  userId: string;
  payerKind: "member" | "external";
  payerName: string;
  amount: string;
  paymentMethod: "cash" | "transfer";
  note: string | null;
  entryDate: string;
  createdAt: string;
};

/** Shop creditor with advance vs repayment breakdown (1B display). */
export type CreditorWithRepayment = {
  name: string;
  payerKind: "member" | "external";
  owed: string;
  repaid: string;
  remaining: string;
  count: number;
};
