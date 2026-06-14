// Unit checks for lib/expense-categories.ts fixed/variable lookup.
// Usage: npm run test:expense-categories
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_KEYS,
  getExpenseType,
  isFixed,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
} from "./expense-categories-core.mjs";

let failed = 0;

function assert(label, ok) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

console.log("=== EXPENSE CATEGORY LOOKUP TEST ===\n");

console.log("1) Fixed categories");
for (const key of ["rent", "wage", "equipment"]) {
  assert(`${key} is fixed`, isFixed(key) === true);
  assert(`${key} getExpenseType`, getExpenseType(key) === "fixed");
}
console.log("");

console.log("2) Variable categories");
for (const key of ["materials", "utilities", "shipping", "marketing", "expense_misc"]) {
  assert(`${key} is not fixed`, isFixed(key) === false);
  assert(`${key} getExpenseType`, getExpenseType(key) === "variable");
}
console.log("");

console.log("3) Thai labels on every key");
for (const c of INCOME_CATEGORIES) {
  assert(`income ${c.key} label`, typeof c.label === "string" && c.label.length > 0);
}
for (const c of EXPENSE_CATEGORIES) {
  assert(`expense ${c.key} label`, typeof c.label === "string" && c.label.length > 0);
}
console.log("");

console.log("4) Key list completeness");
assert("income keys count 6", INCOME_CATEGORY_KEYS.length === 6);
assert("expense keys count 8", EXPENSE_CATEGORY_KEYS.length === 8);
console.log("");

console.log("5) Legacy form → canonical normalization");
assert("income other → other_income", normalizeIncomeCategory("other") === "other_income");
assert("expense supplies → materials", normalizeExpenseCategory("supplies") === "materials");
assert("expense salary → wage", normalizeExpenseCategory("salary") === "wage");
assert("expense other → expense_misc", normalizeExpenseCategory("other") === "expense_misc");
console.log("");

if (failed === 0) console.log("All assertions passed.");
else {
  console.error(`${failed} assertion(s) FAILED.`);
  process.exitCode = 1;
}
