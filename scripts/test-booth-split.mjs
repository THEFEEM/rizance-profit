// Booth profit-split unit tests — keep in sync with lib/booth-split.ts
import { computeSplitProfit, computeAdvanceRepayments, floorWholeBaht } from "./booth-split-core.mjs";

let failed = 0;

function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

function investor(id, name, investmentAmount, splitPercent = null) {
  return {
    id,
    name,
    role: "investor",
    investmentAmount,
    splitPercent,
    wageAmount: null,
    wageType: null,
  };
}

const threeInvestors = [
  investor("a", "A", "2000.00"),
  investor("b", "B", "2000.00"),
  investor("c", "C", "2000.00"),
];

console.log("=== BOOTH SPLIT UNIT TESTS ===\n");

// Canonical: pool 0, 3×2000 equity, income 12000, expense 7500 → net 4500 → 1500 each
const canonical = computeSplitProfit({
  poolBudget: "0.00",
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
assert("canonical totalBudget 6000", canonical.totalBudget === "6000.00");
assert("canonical 3 investor shares", canonical.memberShares.filter((s) => s.role === "investor").length === 3);
const invFloors = canonical.memberShares.filter((s) => s.role === "investor").map((s) => s.flooredShare);
assert("canonical 1500 each", invFloors.every((s) => s === "1500.00"), invFloors.join(", "));
assert("canonical remainder 0", canonical.remainder === "0.00");
assert("canonical no warning", !canonical.warning);

// Remainder from flooring: net 4501 → 1500×3 + remainder 1
const remainderCase = computeSplitProfit({
  poolBudget: "0.00",
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
assert("remainder to pool 1", remainderCase.remainder === "1.00");

// by_equity zero equity → warning, no investor shares
const zeroEquity = computeSplitProfit({
  poolBudget: "5000.00",
  profitSplitMethod: "by_equity",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "1000.00",
  totalExpense: "0.00",
  advances: [],
  members: [investor("x", "X", "0.00")],
});
assert("zero equity warning", !!zeroEquity.warning);
assert("zero equity no investor shares", zeroEquity.memberShares.filter((s) => s.role === "investor").length === 0);

// custom_percent sum ≠ 100
const badPct = computeSplitProfit({
  poolBudget: "0.00",
  profitSplitMethod: "custom_percent",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "1000.00",
  totalExpense: "0.00",
  advances: [],
  members: [
    investor("a", "A", "1000.00", "40.00"),
    investor("b", "B", "1000.00", "40.00"),
  ],
});
assert("custom_percent invalid warning", !!badPct.warning);

// Loss: negative net, floor toward −∞
const loss = computeSplitProfit({
  poolBudget: "0.00",
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
  profitSplitMethod: "equal",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  totalIncome: "10000.00",
  totalExpense: "6000.00", // includes 500 advance
  advances: [{ memberId: "a", memberName: "A", amount: "500.00", entryDate: "2026-06-01" }],
  members: [investor("a", "A", "2000.00"), investor("b", "B", "2000.00")],
});
assert("advance grossProfit 4000", advanceSplit.grossProfit === "4000.00");
assert("advance repayment 500 to A", advanceSplit.advanceRepayments[0]?.amount === "500.00");
assert("advance netProfit 3500", advanceSplit.netProfit === "3500.00");
const aShare = advanceSplit.memberShares.find((s) => s.memberId === "a");
assert("advance A repayment line", aShare?.advanceRepayment === "500.00");

// Employee daily wage × event days (3 days)
const employeeCase = computeSplitProfit({
  poolBudget: "0.00",
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
      splitPercent: null,
      wageAmount: "300.00",
      wageType: "daily",
    },
  ],
});
assert("employee eventDays 3", employeeCase.eventDays === 3);
assert("employeeCost 900", employeeCase.employeeCost === "900.00");
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
