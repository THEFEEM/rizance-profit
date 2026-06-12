/**
 * Pure booth profit-split math — keep in sync with lib/booth-split.ts
 */

export function toCents(value) {
  const s = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid money value: ${value}`);
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [whole, frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = Number(whole) * 100 + Number(fracPadded);
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function sumDecimals(...values) {
  const total = values.reduce((acc, v) => acc + toCents(v), 0);
  return centsToDecimalString(total);
}

export function computeProfit(income, expense) {
  return centsToDecimalString(toCents(income) - toCents(expense));
}

export function inclusiveEventDays(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function floorWholeBaht(amount) {
  const cents = toCents(amount);
  const baht = Math.floor(cents / 100);
  return centsToDecimalString(baht * 100);
}

export function computeMemberEquity(members) {
  return sumDecimals(
    0,
    ...members.filter((m) => m.role === "investor").map((m) => m.investmentAmount),
  );
}

export function computeEmployeeCost(members, eventDays) {
  let totalCents = 0;
  for (const m of members) {
    if (m.role !== "employee" || !m.wageAmount || !m.wageType) continue;
    const mult = m.wageType === "event" ? 1 : eventDays;
    totalCents += toCents(m.wageAmount) * mult;
  }
  return centsToDecimalString(totalCents);
}

function exactShareByRatio(amount, numerator, denominator) {
  if (denominator === 0) return "0.00";
  const shareCents = Math.trunc((toCents(amount) * numerator) / denominator);
  return centsToDecimalString(shareCents);
}

function percentSumHundredths(investors) {
  return investors.reduce((sum, m) => {
    if (m.splitPercent === null || m.splitPercent === undefined) return sum;
    return sum + toCents(m.splitPercent);
  }, 0);
}

export function computeAdvanceRepayments(grossProfit, advances) {
  const grossCents = toCents(grossProfit);
  if (grossCents <= 0 || advances.length === 0) return [];

  const sorted = [...advances].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  let remaining = grossCents;
  const paid = new Map();

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

function investorWeights(method, investors) {
  if (investors.length === 0) {
    return { weights: [], warning: "ไม่มีนักลงทุน — ไม่สามารถแบ่งกำไรได้" };
  }

  if (method === "equal") {
    return {
      weights: investors.map((m) => ({ member: m, numerator: 1, denominator: investors.length })),
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

export function computeSplitProfit(input) {
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

  const investorShares = weights.map(({ member, numerator, denominator }) => {
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

  const employeeShares = employees.map((m) => {
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
