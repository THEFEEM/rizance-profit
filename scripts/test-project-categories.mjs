// Unit checks for lib/project-categories.ts.
// Usage: npm run test:project-categories
import {
  PROJECT_EXPENSE_CATEGORIES,
  PROJECT_EXPENSE_KEYS,
  PROJECT_FUNDING_KEYS,
  PROJECT_FUNDING_SOURCES,
  projectExpenseLabel,
  projectFundingLabel,
} from "./project-categories-core.mjs";

let failed = 0;

function assert(label, ok) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

console.log("=== PROJECT CATEGORY LOOKUP TEST ===\n");

console.log("1) Funding source keys");
assert("funding keys count 7", PROJECT_FUNDING_KEYS.length === 7);
for (const c of PROJECT_FUNDING_SOURCES) {
  assert(`funding ${c.key} label`, typeof c.label === "string" && c.label.length > 0);
  assert(`funding label lookup ${c.key}`, projectFundingLabel(c.key) === c.label);
}
console.log("");

console.log("2) Expense category keys");
assert("expense keys count 8", PROJECT_EXPENSE_KEYS.length === 8);
for (const c of PROJECT_EXPENSE_CATEGORIES) {
  assert(`expense ${c.key} label`, typeof c.label === "string" && c.label.length > 0);
  assert(`expense label lookup ${c.key}`, projectExpenseLabel(c.key) === c.label);
}
console.log("");

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("All assertions passed.");
