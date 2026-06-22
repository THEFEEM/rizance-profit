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
    ...members
      .filter((m) => m.role === "investor" || m.role === "manager")
      .map((m) => m.investmentAmount),
  );
}

export function computeWageCost(members, eventDays) {
  let totalCents = 0;
  for (const m of members) {
    if (m.role !== "employee" && m.role !== "manager") continue;
    if (!m.wageAmount || !m.wageType) continue;
    const mult = m.wageType === "event" ? 1 : eventDays;
    totalCents += toCents(m.wageAmount) * mult;
  }
  return centsToDecimalString(totalCents);
}

export const computeEmployeeCost = computeWageCost;

function exactShareByRatio(amount, numerator, denominator) {
  if (denominator === 0) return "0.00";
  const shareCents = Math.trunc((toCents(amount) * numerator) / denominator);
  return centsToDecimalString(shareCents);
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
    const prev = paid.get(adv.creditorKey);
    paid.set(adv.creditorKey, {
      memberId: adv.memberId,
      name: adv.creditorName,
      cents: (prev?.cents ?? 0) + pay,
      isExternal: adv.isExternal,
    });
    remaining -= pay;
  }

  return [...paid.entries()].map(([creditorKey, { memberId, name, cents, isExternal }]) => ({
    creditorKey,
    memberId,
    name,
    amount: centsToDecimalString(cents),
    role: isExternal ? "external" : "member",
  }));
}

function shareParticipants(poolBudget, poolGetsShare, members) {
  const shareMembers = members.filter(
    (m) =>
      (m.role === "investor" || m.role === "manager") && toCents(m.investmentAmount) > 0,
  );
  const poolCents = poolGetsShare && toCents(poolBudget) > 0 ? toCents(poolBudget) : 0;
  return { members: shareMembers, poolCents };
}

function shareWeights(method, poolBudget, poolGetsShare, members) {
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

  const equityTotal =
    participants.reduce((s, m) => s + toCents(m.investmentAmount), 0) + poolCents;
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

function resolveCapitalSplit(repayCapitalFirst, netProfit, totalCapital) {
  if (!repayCapitalFirst || toCents(totalCapital) <= 0) {
    return {
      profitToSplit: netProfit,
      capitalRepaid: "0.00",
      capitalFullyRepaid: true,
      splittableProfit: netProfit,
    };
  }

  const netCents = toCents(netProfit);
  const capitalCents = toCents(totalCapital);

  if (netCents <= 0) {
    return {
      profitToSplit: "0.00",
      capitalRepaid: "0.00",
      capitalFullyRepaid: false,
      splittableProfit: "0.00",
    };
  }

  if (netCents < capitalCents) {
    return {
      profitToSplit: "0.00",
      capitalRepaid: netProfit,
      capitalFullyRepaid: false,
      splittableProfit: "0.00",
    };
  }

  const splittableProfit = computeProfit(netProfit, totalCapital);
  return {
    profitToSplit: splittableProfit,
    capitalRepaid: totalCapital,
    capitalFullyRepaid: true,
    splittableProfit,
  };
}

export function computeSplitProfit(input) {
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

  const repayCapitalFirst = input.repayCapitalFirst ?? false;
  const totalCapital = memberEquity;
  const capitalSplit = resolveCapitalSplit(repayCapitalFirst, netProfit, totalCapital);
  const profitToSplit = capitalSplit.profitToSplit;

  const repaymentByMember = new Map(
    advanceRepayments
      .filter((r) => r.role === "member" && r.memberId)
      .map((r) => [r.memberId, r.amount]),
  );

  const { memberWeights, poolWeight, warning } = shareWeights(
    input.profitSplitMethod,
    input.poolBudget,
    input.poolGetsShare ?? false,
    input.members,
  );

  const memberShares = memberWeights.map(({ member, numerator, denominator }) => {
    const exact = exactShareByRatio(profitToSplit, numerator, denominator);
    const wage =
      (member.role === "manager" || member.role === "employee") &&
      member.wageAmount &&
      member.wageType
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
    poolExact = exactShareByRatio(profitToSplit, poolWeight.numerator, poolWeight.denominator);
    poolFloored = floorWholeBaht(poolExact);
  }

  const flooredMemberTotal = sumDecimals(0, ...memberShares.map((s) => s.flooredShare));
  const flooredWithPool = sumDecimals(flooredMemberTotal, poolFloored);
  const remainder = computeProfit(profitToSplit, flooredWithPool);

  return {
    method: input.profitSplitMethod,
    poolBudget: input.poolBudget,
    poolGetsShare: input.poolGetsShare ?? false,
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
    ...(repayCapitalFirst
      ? {
          repayCapitalFirst: true,
          totalCapital,
          capitalRepaid: capitalSplit.capitalRepaid,
          capitalFullyRepaid: capitalSplit.capitalFullyRepaid,
          splittableProfit: capitalSplit.splittableProfit,
        }
      : {}),
  };
}
