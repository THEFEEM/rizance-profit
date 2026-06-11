// Break-even calculator unit tests — keep in sync with lib/break-even.ts
import {
  breakEvenNeedsSetup,
  computeBreakEvenCups,
  computeBreakEvenItem,
  computeContributionPerCup,
} from "./pricing-math-core.mjs";

let failed = 0;

function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

console.log("=== BREAK-EVEN UNIT TESTS ===\n");

// Canonical: fixed 15,000, contribution 10 → 1,500 cups
assert(
  "canonical 15000 / 10 = 1500",
  computeBreakEvenCups("15000.00", "10.00") === 1500,
);

// Ceil: fixed 15,000, contribution 7 → 2,143 (not 2142.86)
assert(
  "ceil 15000 / 7 = 2143",
  computeBreakEvenCups("15000.00", "7.00") === 2143,
);

// Contribution = selling − ingredient (not desired profit field)
assert(
  "contribution = selling − ingredient",
  computeContributionPerCup("50.00", "35.00") === "15.00",
);

// profit/cup ≤ 0 → guarded, no division
assert("zero contribution → null cups", computeBreakEvenCups("15000.00", "0.00") === null);
assert(
  "negative contribution → null cups",
  computeBreakEvenCups("15000.00", "-2.00") === null,
);

const zeroProfit = computeBreakEvenItem("15000.00", "40.00", "40.00", 1000, false);
assert("zero profit → noBreakEven flag", zeroProfit.noBreakEven === true);
assert("zero profit → warning set", zeroProfit.warning !== null);
assert("zero profit → no breakEvenCups", zeroProfit.breakEvenCups === null);

const negProfit = computeBreakEvenItem("15000.00", "50.00", "45.00", 1000, false);
assert("negative profit → noBreakEven flag", negProfit.noBreakEven === true);
assert("negative profit → no division", negProfit.breakEvenCups === null);

// no overheads → needsSetup
assert("needsSetup when fixed costs zero", breakEvenNeedsSetup("0.00") === true);
assert("needsSetup when fixed costs empty-ish", breakEvenNeedsSetup("0") === true);

const noOverheads = computeBreakEvenItem("0.00", "10.00", "50.00", 1000, true);
assert("needsSetup → no breakEvenCups", noOverheads.breakEvenCups === null);
assert("needsSetup → not noBreakEven", noOverheads.noBreakEven === false);

// Target comparison
const above = computeBreakEvenItem("15000.00", "10.00", "20.00", 2000, false);
assert("above break-even comparison", above.comparison === "above", above.comparison);

const below = computeBreakEvenItem("15000.00", "10.00", "20.00", 500, false);
assert("below break-even comparison", below.comparison === "below", below.comparison);

const at = computeBreakEvenItem("15000.00", "10.00", "20.00", 1500, false);
assert("at break-even comparison", at.comparison === "at", at.comparison);

console.log("");
if (failed === 0) {
  console.log("All assertions passed.");
} else {
  console.error(`${failed} assertion(s) FAILED.`);
  process.exitCode = 1;
}
