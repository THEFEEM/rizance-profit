// Booth profit-split unit tests — keep in sync with lib/booth-split.ts
import { computeSplitProfit, computeAdvanceRepayments, floorWholeBaht } from "./booth-split-core.mjs";

let failed = 0;

function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

function investor(id, name, investmentAmount) {
  return {
    id,
    name,
    role: "investor",
    investmentAmount,
    wageAmount: null,
    wageType: null,
  };
}

function manager(id, name, investmentAmount, wageAmount, wageType = "daily") {
  return {
    id,
    name,
    role: "manager",
    investmentAmount,
    wageAmount,
    wageType,
  };
}

const threeInvestors = [
  investor("a", "A", "2000.00"),
  investor("b", "B", "2000.00"),
  investor("c", "C", "2000.00"),
];

/** Shared scenario: pool 10k, A 2k, B manager 2k + wage 300×3, income 12k, expense 7.5k */
const revisionMembers = [
  investor("a", "A", "2000.00"),
  manager("b", "B", "2000.00", "300.00", "daily"),
];

const revisionBase = {
  poolBudget: "10000.00",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  totalIncome: "12000.00",
  totalExpense: "7500.00",
  advances: [],
  members: revisionMembers,
};

console.log("=== BOOTH SPLIT UNIT TESTS (v2 revision) ===\n");

// --- Canonical (legacy): 3 investors equal, no pool share ---
const canonical = computeSplitProfit({
  poolBudget: "0.00",
  poolGetsShare: false,
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  totalIncome: "12000.00",
  totalExpense: "7500.00",
  advances: [],
  members: threeInvestors,
});

assert("canonical grossProfit 4500", canonical.grossProfit === "4500.00");
assert("canonical netProfit 4500", canonical.netProfit === "4500.00");
assert("canonical memberEquity 6000", canonical.memberEquity === "6000.00");
assert("canonical 3 investor shares", canonical.memberShares.filter((s) => s.role === "investor").length === 3);
const invFloors = canonical.memberShares.filter((s) => s.role === "investor").map((s) => s.flooredShare);
assert("canonical 1500 each", invFloors.every((s) => s === "1500.00"), invFloors.join(", "));
assert("canonical remainder 0", canonical.remainder === "0.00");
assert("canonical no warning", !canonical.warning);

// --- (a) by_equity, pool_gets_share=true ---
const caseA = computeSplitProfit({
  ...revisionBase,
  poolGetsShare: true,
  profitSplitMethod: "by_equity",
});

assert("(a) wageCost 900", caseA.wageCost === "900.00");
assert("(a) grossProfit 3600", caseA.grossProfit === "3600.00");
assert("(a) netProfit 3600", caseA.netProfit === "3600.00");
assert("(a) memberEquity 4000", caseA.memberEquity === "4000.00");
assert("(a) pool exact 2571.42", caseA.poolShare.exactShare === "2571.42");
assert("(a) A exact 514.28", caseA.memberShares.find((s) => s.memberId === "a")?.exactShare === "514.28");
assert("(a) B exact 514.28", caseA.memberShares.find((s) => s.memberId === "b")?.exactShare === "514.28");
assert("(a) pool floored 2571", caseA.poolShare.flooredShare === "2571.00");
assert("(a) A floored 514", caseA.memberShares.find((s) => s.memberId === "a")?.flooredShare === "514.00");
assert("(a) B floored 514", caseA.memberShares.find((s) => s.memberId === "b")?.flooredShare === "514.00");
assert("(a) B wage 900", caseA.memberShares.find((s) => s.memberId === "b")?.wageCost === "900.00");
assert("(a) remainder 1 (เศษเข้ากองกลาง)", caseA.remainder === "1.00");
assert("(a) pool floored profit share only 2571", caseA.poolShare.flooredShare === "2571.00");

// --- (b) by_equity, pool_gets_share=false ---
const caseB = computeSplitProfit({
  ...revisionBase,
  poolGetsShare: false,
  profitSplitMethod: "by_equity",
});

assert("(b) grossProfit 3600", caseB.grossProfit === "3600.00");
assert("(b) pool exact 0", caseB.poolShare.exactShare === "0.00");
assert("(b) A floored 1800", caseB.memberShares.find((s) => s.memberId === "a")?.flooredShare === "1800.00");
assert("(b) B floored 1800", caseB.memberShares.find((s) => s.memberId === "b")?.flooredShare === "1800.00");
assert("(b) remainder 0", caseB.remainder === "0.00");

// --- (c) equal, pool_gets_share=true, 3 heads ---
const caseC = computeSplitProfit({
  ...revisionBase,
  poolGetsShare: true,
  profitSplitMethod: "equal",
});

assert("(c) grossProfit 3600", caseC.grossProfit === "3600.00");
assert("(c) pool floored 1200", caseC.poolShare.flooredShare === "1200.00");
assert("(c) A floored 1200", caseC.memberShares.find((s) => s.memberId === "a")?.flooredShare === "1200.00");
assert("(c) B floored 1200", caseC.memberShares.find((s) => s.memberId === "b")?.flooredShare === "1200.00");
assert("(c) remainder 0", caseC.remainder === "0.00");

// --- (d) manager 0 equity → wage only, no share ---
const caseD = computeSplitProfit({
  poolBudget: "10000.00",
  poolGetsShare: true,
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  totalIncome: "12000.00",
  totalExpense: "7500.00",
  advances: [],
  members: [
    investor("a", "A", "2000.00"),
    manager("m0", "M0", "0.00", "300.00", "daily"),
  ],
});

assert("(d) wageCost 900", caseD.wageCost === "900.00");
assert("(d) grossProfit 3600", caseD.grossProfit === "3600.00");
const m0 = caseD.memberShares.find((s) => s.memberId === "m0");
assert("(d) M0 share 0", m0?.flooredShare === "0.00");
assert("(d) M0 wage 900", m0?.wageCost === "900.00");
assert("(d) 2 heads pool+A → 1800 each", caseD.poolShare.flooredShare === "1800.00");
assert(
  "(d) A floored 1800",
  caseD.memberShares.find((s) => s.memberId === "a")?.flooredShare === "1800.00",
);

// Remainder from flooring
const remainderCase = computeSplitProfit({
  poolBudget: "0.00",
  poolGetsShare: false,
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "12001.00",
  totalExpense: "7500.00",
  advances: [],
  members: threeInvestors,
});
assert("remainder net 4501", remainderCase.netProfit === "4501.00");
assert("remainder floored 1500 each", remainderCase.memberShares.every((s) => s.flooredShare === "1500.00" || s.role === "employee"));
assert("remainder 1", remainderCase.remainder === "1.00");
assert(
  "remainder to pool reserve when pool_gets_share=false",
  remainderCase.poolGetsShare === false &&
    remainderCase.remainder === "1.00" &&
    remainderCase.poolShare.flooredShare === "0.00",
);

// by_equity zero equity participants → warning
const zeroEquity = computeSplitProfit({
  poolBudget: "5000.00",
  poolGetsShare: false,
  profitSplitMethod: "by_equity",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "1000.00",
  totalExpense: "0.00",
  advances: [],
  members: [investor("x", "X", "0.00")],
});
assert("zero equity warning", !!zeroEquity.warning);

// Loss: negative net, floor toward −∞
const loss = computeSplitProfit({
  poolBudget: "0.00",
  poolGetsShare: false,
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "1000.00",
  totalExpense: "2500.00",
  advances: [],
  members: [investor("a", "A", "1000.00"), investor("b", "B", "1000.00")],
});
assert("loss isLoss flag", loss.isLoss === true);
assert("loss net -1500", loss.netProfit === "-1500.00");
assert("loss floored -750 each", loss.memberShares.every((s) => s.flooredShare === "-750.00"));

assert("floor toward -inf -1500.33", floorWholeBaht("-1500.33") === "-1501.00");

// Advance repayment from gross profit before split
const advanceSplit = computeSplitProfit({
  poolBudget: "0.00",
  poolGetsShare: false,
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "10000.00",
  totalExpense: "6000.00",
  advances: [{ memberId: "a", memberName: "A", amount: "500.00", entryDate: "2026-06-01" }],
  members: [investor("a", "A", "2000.00"), investor("b", "B", "2000.00")],
});
assert("advance grossProfit 4000", advanceSplit.grossProfit === "4000.00");
assert("advance repayment 500 to A", advanceSplit.advanceRepayments[0]?.amount === "500.00");
assert("advance netProfit 3500", advanceSplit.netProfit === "3500.00");
const aShare = advanceSplit.memberShares.find((s) => s.memberId === "a");
assert("advance A repayment line", aShare?.advanceRepayment === "500.00");

// Employee daily wage × event days (3 days) — unchanged employee path
const employeeCase = computeSplitProfit({
  poolBudget: "0.00",
  poolGetsShare: false,
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  totalIncome: "12000.00",
  totalExpense: "7500.00",
  advances: [],
  members: [
    ...threeInvestors,
    {
      id: "e1",
      name: "Emp",
      role: "employee",
      investmentAmount: "0.00",
      wageAmount: "300.00",
      wageType: "daily",
    },
  ],
});
assert("employee eventDays 3", employeeCase.eventDays === 3);
assert("employee wageCost 900", employeeCase.wageCost === "900.00");
assert("gross after wage 3600", employeeCase.grossProfit === "3600.00");
const emp = employeeCase.memberShares.find((s) => s.role === "employee");
assert("employee wage line 900", emp?.wageCost === "900.00");
assert("employee eventDays on share", emp?.eventDays === 3);

// FIFO advance repayment partial pool
const fifo = computeAdvanceRepayments("1000.00", [
  { memberId: "a", memberName: "A", amount: "800.00", entryDate: "2026-06-02" },
  { memberId: "b", memberName: "B", amount: "500.00", entryDate: "2026-06-01" },
]);
assert("FIFO pays B first 500", fifo.find((r) => r.memberId === "b")?.amount === "500.00");
assert("FIFO pays A remaining 500", fifo.find((r) => r.memberId === "a")?.amount === "500.00");

console.log("");
if (failed === 0) {
  console.log("All assertions passed.");
} else {
  console.error(`${failed} assertion(s) FAILED.`);
  process.exitCode = 1;
}
