import { centsToDecimalString, computeProfit, sumDecimals, toCents } from "@/lib/money";
import type { MemberRole, ProfitSplitMethod, WageType } from "@/types/booth";

export type SplitMemberInput = {
  id: string;
  name: string;
  role: MemberRole;
  investmentAmount: string;
  splitPercent: string | null;
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
  splitPercent: string | null;
  exactShare: string;
  flooredShare: string;
  advanceRepayment: string;
  wageCost: string;
  eventDays: number | null;
};

export type SplitProfitResult = {
  method: ProfitSplitMethod;
  poolBudget: string;
  memberEquity: string;
  totalBudget: string;
  totalIncome: string;
  totalExpense: string;
  employeeCost: string;
  eventDays: number;
  advanceRepayments: AdvanceRepayment[];
  grossProfit: string;
  netProfit: string;
  memberShares: MemberShare[];
  /** Display-only reserve from flooring whole baht — not added to pool_budget. */
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

export function computeMemberEquity(members: SplitMemberInput[]): string {
  return sumDecimals(
    0,
    ...members.filter((m) => m.role === "investor").map((m) => m.investmentAmount),
  );
}

export function computeEmployeeCost(members: SplitMemberInput[], eventDays: number): string {
  let totalCents = 0;
  for (const m of members) {
    if (m.role !== "employee" || !m.wageAmount || !m.wageType) continue;
    const mult = m.wageType === "event" ? 1 : eventDays;
    totalCents += toCents(m.wageAmount) * mult;
  }
  return centsToDecimalString(totalCents);
}

function exactShareByRatio(amount: string, numerator: number, denominator: number): string {
  if (denominator === 0) return "0.00";
  const shareCents = Math.trunc((toCents(amount) * numerator) / denominator);
  return centsToDecimalString(shareCents);
}

function percentSumHundredths(investors: SplitMemberInput[]): number {
  return investors.reduce((sum, m) => {
    if (m.splitPercent === null || m.splitPercent === undefined) return sum;
    return sum + toCents(m.splitPercent);
  }, 0);
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

type InvestorWeight = { member: SplitMemberInput; numerator: number; denominator: number };

function investorWeights(
  method: ProfitSplitMethod,
  investors: SplitMemberInput[],
): { weights: InvestorWeight[]; warning?: string } {
  if (investors.length === 0) {
    return { weights: [], warning: "ไม่มีนักลงทุน — ไม่สามารถแบ่งกำไรได้" };
  }

  if (method === "equal") {
    return {
      weights: investors.map((m) => ({
        member: m,
        numerator: 1,
        denominator: investors.length,
      })),
    };
  }

  if (method === "by_equity") {
    const equityCents = investors.reduce((s, m) => s + toCents(m.investmentAmount), 0);
    if (equityCents <= 0) {
      return {
        weights: [],
        warning: "สัดส่วนลงทุนรวมเป็นศูนย์ — ไม่สามารถแบ่งตาม equity ได้",
      };
    }
    return {
      weights: investors.map((m) => ({
        member: m,
        numerator: toCents(m.investmentAmount),
        denominator: equityCents,
      })),
    };
  }

  const pctTotal = percentSumHundredths(investors);
  if (pctTotal !== 10_000) {
    return {
      weights: [],
      warning: `สัดส่วนกำหนดเองต้องรวม 100.00% (ได้ ${(pctTotal / 100).toFixed(2)}%)`,
    };
  }

  return {
    weights: investors.map((m) => ({
      member: m,
      numerator: toCents(m.splitPercent ?? "0"),
      denominator: 10_000,
    })),
  };
}

/** Pure profit-split math — derived on read, never stored. */
export function computeSplitProfit(input: SplitProfitInput): SplitProfitResult {
  const eventDays = inclusiveEventDays(input.startDate, input.endDate);
  const memberEquity = computeMemberEquity(input.members);
  const totalBudget = sumDecimals(input.poolBudget, memberEquity);
  const employeeCost = computeEmployeeCost(input.members, eventDays);
  const grossProfit = computeProfit(
    computeProfit(input.totalIncome, input.totalExpense),
    employeeCost,
  );

  const advanceRepayments = computeAdvanceRepayments(grossProfit, input.advances);
  const repayTotal = sumDecimals(0, ...advanceRepayments.map((r) => r.amount));
  const netProfit = computeProfit(grossProfit, repayTotal);
  const isLoss = toCents(netProfit) < 0;

  const investors = input.members.filter((m) => m.role === "investor");
  const employees = input.members.filter((m) => m.role === "employee");
  const repaymentByMember = new Map(advanceRepayments.map((r) => [r.memberId, r.amount]));

  const { weights, warning } = investorWeights(input.profitSplitMethod, investors);

  const investorShares: MemberShare[] = weights.map(({ member, numerator, denominator }) => {
    const exact = exactShareByRatio(netProfit, numerator, denominator);
    return {
      memberId: member.id,
      name: member.name,
      role: member.role,
      investmentAmount: member.investmentAmount,
      splitPercent: member.splitPercent,
      exactShare: exact,
      flooredShare: floorWholeBaht(exact),
      advanceRepayment: repaymentByMember.get(member.id) ?? "0.00",
      wageCost: "0.00",
      eventDays: null,
    };
  });

  const employeeShares: MemberShare[] = employees.map((m) => {
    const mult = m.wageType === "event" ? 1 : eventDays;
    const wage =
      m.wageAmount && m.wageType
        ? centsToDecimalString(toCents(m.wageAmount) * mult)
        : "0.00";
    return {
      memberId: m.id,
      name: m.name,
      role: m.role,
      investmentAmount: "0.00",
      splitPercent: null,
      exactShare: "0.00",
      flooredShare: "0.00",
      advanceRepayment: repaymentByMember.get(m.id) ?? "0.00",
      wageCost: wage,
      eventDays: m.wageType === "daily" ? eventDays : null,
    };
  });

  const memberShares = [...investorShares, ...employeeShares];
  const flooredTotal = sumDecimals(0, ...investorShares.map((s) => s.flooredShare));
  const remainder = computeProfit(netProfit, flooredTotal);

  return {
    method: input.profitSplitMethod,
    poolBudget: input.poolBudget,
    memberEquity,
    totalBudget,
    totalIncome: input.totalIncome,
    totalExpense: input.totalExpense,
    employeeCost,
    eventDays,
    advanceRepayments,
    grossProfit,
    netProfit,
    memberShares,
    remainder,
    isLoss,
    warning,
  };
}
