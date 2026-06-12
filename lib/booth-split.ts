import { centsToDecimalString, computeProfit, sumDecimals, toCents } from "@/lib/money";
import type { MemberRole, ProfitSplitMethod, WageType } from "@/types/booth";

export type SplitMemberInput = {
  id: string;
  name: string;
  role: MemberRole;
  investmentAmount: string;
  wageAmount: string | null;
  wageType: WageType | null;
};

export type AdvanceInput = {
  memberId: string;
  memberName: string;
  amount: string;
  entryDate: string;
};

export type SplitProfitInput = {
  poolBudget: string;
  poolGetsShare: boolean;
  profitSplitMethod: ProfitSplitMethod;
  startDate: string;
  endDate: string;
  totalIncome: string;
  totalExpense: string;
  advances: AdvanceInput[];
  members: SplitMemberInput[];
};

export type AdvanceRepayment = {
  memberId: string;
  name: string;
  amount: string;
};

export type MemberShare = {
  memberId: string;
  name: string;
  role: MemberRole;
  investmentAmount: string;
  exactShare: string;
  flooredShare: string;
  advanceRepayment: string;
  wageCost: string;
  eventDays: number | null;
};

export type PoolShare = {
  /** Exact ratio share before flooring (0 when pool not in split). */
  exactShare: string;
  /** Floored whole-baht profit share (0 when pool_gets_share=false). */
  flooredShare: string;
};

export type SplitProfitResult = {
  method: ProfitSplitMethod;
  poolBudget: string;
  poolGetsShare: boolean;
  memberEquity: string;
  totalBudget: string;
  totalIncome: string;
  totalExpense: string;
  wageCost: string;
  eventDays: number;
  advanceRepayments: AdvanceRepayment[];
  grossProfit: string;
  netProfit: string;
  memberShares: MemberShare[];
  poolShare: PoolShare;
  /** Display-only flooring leftover — always เศษเข้ากองกลาง (never mutates pool_budget). */
  remainder: string;
  isLoss: boolean;
  warning?: string;
};

/** Inclusive calendar days for booth event (Bangkok dates as YYYY-MM-DD). */
export function inclusiveEventDays(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** Floor money to whole baht (toward −∞). */
export function floorWholeBaht(amount: string): string {
  const cents = toCents(amount);
  const baht = Math.floor(cents / 100);
  return centsToDecimalString(baht * 100);
}

/** SUM(investment_amount) for investors + managers — derived capital from members. */
export function computeMemberEquity(members: SplitMemberInput[]): string {
  return sumDecimals(
    0,
    ...members
      .filter((m) => m.role === "investor" || m.role === "manager")
      .map((m) => m.investmentAmount),
  );
}

/** Wages for employees and managers (deducted from gross before profit split). */
export function computeWageCost(members: SplitMemberInput[], eventDays: number): string {
  let totalCents = 0;
  for (const m of members) {
    if (m.role !== "employee" && m.role !== "manager") continue;
    if (!m.wageAmount || !m.wageType) continue;
    const mult = m.wageType === "event" ? 1 : eventDays;
    totalCents += toCents(m.wageAmount) * mult;
  }
  return centsToDecimalString(totalCents);
}

/** @deprecated Use computeWageCost — kept for callers during transition. */
export const computeEmployeeCost = computeWageCost;

function exactShareByRatio(amount: string, numerator: number, denominator: number): string {
  if (denominator === 0) return "0.00";
  const shareCents = Math.trunc((toCents(amount) * numerator) / denominator);
  return centsToDecimalString(shareCents);
}

/** FIFO advance repayment from gross profit before investor split. */
export function computeAdvanceRepayments(
  grossProfit: string,
  advances: AdvanceInput[],
): AdvanceRepayment[] {
  const grossCents = toCents(grossProfit);
  if (grossCents <= 0 || advances.length === 0) return [];

  const sorted = [...advances].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  let remaining = grossCents;
  const paid = new Map<string, { name: string; cents: number }>();

  for (const adv of sorted) {
    if (remaining <= 0) break;
    const advCents = toCents(adv.amount);
    const pay = Math.min(remaining, advCents);
    if (pay <= 0) continue;
    const prev = paid.get(adv.memberId);
    paid.set(adv.memberId, {
      name: adv.memberName,
      cents: (prev?.cents ?? 0) + pay,
    });
    remaining -= pay;
  }

  return [...paid.entries()].map(([memberId, { name, cents }]) => ({
    memberId,
    name,
    amount: centsToDecimalString(cents),
  }));
}

type ShareWeight = { member: SplitMemberInput; numerator: number; denominator: number };
type PoolWeight = { numerator: number; denominator: number };

/** Investors + managers with equity > 0; pool if pool_gets_share and pool_budget > 0. */
function shareParticipants(
  poolBudget: string,
  poolGetsShare: boolean,
  members: SplitMemberInput[],
): { members: SplitMemberInput[]; poolCents: number } {
  const shareMembers = members.filter(
    (m) =>
      (m.role === "investor" || m.role === "manager") && toCents(m.investmentAmount) > 0,
  );
  const poolCents =
    poolGetsShare && toCents(poolBudget) > 0 ? toCents(poolBudget) : 0;
  return { members: shareMembers, poolCents };
}

function shareWeights(
  method: ProfitSplitMethod,
  poolBudget: string,
  poolGetsShare: boolean,
  members: SplitMemberInput[],
): { memberWeights: ShareWeight[]; poolWeight: PoolWeight | null; warning?: string } {
  const { members: participants, poolCents } = shareParticipants(
    poolBudget,
    poolGetsShare,
    members,
  );
  const headCount = participants.length + (poolCents > 0 ? 1 : 0);

  if (headCount === 0) {
    return {
      memberWeights: [],
      poolWeight: null,
      warning: "ไม่มีผู้รับส่วนแบ่งกำไร — ตรวจสอบ equity หรือ pool_gets_share",
    };
  }

  if (method === "equal") {
    return {
      memberWeights: participants.map((m) => ({
        member: m,
        numerator: 1,
        denominator: headCount,
      })),
      poolWeight: poolCents > 0 ? { numerator: 1, denominator: headCount } : null,
    };
  }

  // by_equity
  const equityTotal = participants.reduce((s, m) => s + toCents(m.investmentAmount), 0) + poolCents;
  if (equityTotal <= 0) {
    return {
      memberWeights: [],
      poolWeight: null,
      warning: "สัดส่วนลงทุนรวมเป็นศูนย์ — ไม่สามารถแบ่งตาม equity ได้",
    };
  }

  return {
    memberWeights: participants.map((m) => ({
      member: m,
      numerator: toCents(m.investmentAmount),
      denominator: equityTotal,
    })),
    poolWeight: poolCents > 0 ? { numerator: poolCents, denominator: equityTotal } : null,
  };
}

/** Pure profit-split math — derived on read, never stored. */
export function computeSplitProfit(input: SplitProfitInput): SplitProfitResult {
  const eventDays = inclusiveEventDays(input.startDate, input.endDate);
  const memberEquity = computeMemberEquity(input.members);
  const totalBudget = sumDecimals(input.poolBudget, memberEquity);
  const wageCost = computeWageCost(input.members, eventDays);
  const grossProfit = computeProfit(
    computeProfit(input.totalIncome, input.totalExpense),
    wageCost,
  );

  const advanceRepayments = computeAdvanceRepayments(grossProfit, input.advances);
  const repayTotal = sumDecimals(0, ...advanceRepayments.map((r) => r.amount));
  const netProfit = computeProfit(grossProfit, repayTotal);
  const isLoss = toCents(netProfit) < 0;

  const repaymentByMember = new Map(advanceRepayments.map((r) => [r.memberId, r.amount]));

  const { memberWeights, poolWeight, warning } = shareWeights(
    input.profitSplitMethod,
    input.poolBudget,
    input.poolGetsShare,
    input.members,
  );

  const memberShares: MemberShare[] = memberWeights.map(({ member, numerator, denominator }) => {
    const exact = exactShareByRatio(netProfit, numerator, denominator);
    const wage =
      member.role === "manager" && member.wageAmount && member.wageType
        ? centsToDecimalString(
            toCents(member.wageAmount) * (member.wageType === "event" ? 1 : eventDays),
          )
        : member.role === "employee" && member.wageAmount && member.wageType
          ? centsToDecimalString(
              toCents(member.wageAmount) * (member.wageType === "event" ? 1 : eventDays),
            )
          : "0.00";
    return {
      memberId: member.id,
      name: member.name,
      role: member.role,
      investmentAmount: member.investmentAmount,
      exactShare: exact,
      flooredShare: floorWholeBaht(exact),
      advanceRepayment: repaymentByMember.get(member.id) ?? "0.00",
      wageCost: wage,
      eventDays:
        (member.role === "employee" || member.role === "manager") &&
        member.wageType === "daily"
          ? eventDays
          : null,
    };
  });

  // Employees with wage only (no profit share)
  for (const m of input.members.filter((x) => x.role === "employee")) {
    if (memberShares.some((s) => s.memberId === m.id)) continue;
    const wage =
      m.wageAmount && m.wageType
        ? centsToDecimalString(
            toCents(m.wageAmount) * (m.wageType === "event" ? 1 : eventDays),
          )
        : "0.00";
    memberShares.push({
      memberId: m.id,
      name: m.name,
      role: m.role,
      investmentAmount: "0.00",
      exactShare: "0.00",
      flooredShare: "0.00",
      advanceRepayment: repaymentByMember.get(m.id) ?? "0.00",
      wageCost: wage,
      eventDays: m.wageType === "daily" ? eventDays : null,
    });
  }

  // Managers with 0 equity — wage only, no profit share row duplication
  for (const m of input.members.filter(
    (x) => x.role === "manager" && toCents(x.investmentAmount) <= 0,
  )) {
    if (memberShares.some((s) => s.memberId === m.id)) continue;
    const wage =
      m.wageAmount && m.wageType
        ? centsToDecimalString(
            toCents(m.wageAmount) * (m.wageType === "event" ? 1 : eventDays),
          )
        : "0.00";
    memberShares.push({
      memberId: m.id,
      name: m.name,
      role: m.role,
      investmentAmount: "0.00",
      exactShare: "0.00",
      flooredShare: "0.00",
      advanceRepayment: repaymentByMember.get(m.id) ?? "0.00",
      wageCost: wage,
      eventDays: m.wageType === "daily" ? eventDays : null,
    });
  }

  let poolExact = "0.00";
  let poolFloored = "0.00";
  if (poolWeight) {
    poolExact = exactShareByRatio(netProfit, poolWeight.numerator, poolWeight.denominator);
    poolFloored = floorWholeBaht(poolExact);
  }

  const flooredMemberTotal = sumDecimals(0, ...memberShares.map((s) => s.flooredShare));
  const flooredWithPool = sumDecimals(flooredMemberTotal, poolFloored);
  const remainder = computeProfit(netProfit, flooredWithPool);

  return {
    method: input.profitSplitMethod,
    poolBudget: input.poolBudget,
    poolGetsShare: input.poolGetsShare,
    memberEquity,
    totalBudget,
    totalIncome: input.totalIncome,
    totalExpense: input.totalExpense,
    wageCost,
    eventDays,
    advanceRepayments,
    grossProfit,
    netProfit,
    memberShares,
    poolShare: {
      exactShare: poolExact,
      flooredShare: poolFloored,
    },
    remainder,
    isLoss,
    warning,
  };
}
