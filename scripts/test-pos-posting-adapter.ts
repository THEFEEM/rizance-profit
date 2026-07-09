/**
 * POS posting adapter unit tests (no DB).
 *
 * Usage: npx tsx scripts/test-pos-posting-adapter.ts
 */
import { validateJournalLines } from "../lib/journal-queries";
import { toCents } from "../lib/money";
import { buildPosBillPaidLines } from "../lib/pos-posting-adapter";
import type { PosPostingBillInput, PosPostingItemInput } from "../lib/pos-posting-adapter";

let failed = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function sumSide(lines: ReturnType<typeof buildPosBillPaidLines>, side: "debit" | "credit"): number {
  return lines.reduce((acc, line) => acc + toCents(line[side]), 0);
}

function baseBill(overrides: Partial<PosPostingBillInput> = {}): PosPostingBillInput {
  return {
    id: "bill-1",
    userId: "user-1",
    billNo: "POS-001",
    totalAmount: "150.00",
    paymentMethod: "cash",
    createdAt: "2026-07-06T10:00:00.000Z",
    ...overrides,
  };
}

console.log("=== pos-posting-adapter (mock) ===\n");

// 1. Normal bill — all items cost_price > 0 → 4 lines, balanced
{
  const items: PosPostingItemInput[] = [
    { unitCostPrice: "30.00", quantity: "2" },
    { unitCostPrice: "20.00", quantity: "1" },
  ];
  const lines = buildPosBillPaidLines(baseBill({ totalAmount: "150.00" }), items);
  assert("normal bill: 4 lines", lines.length === 4);
  assert("normal bill: cash account 1000", lines[0]?.accountCode === "1000");
  assert("normal bill: COGS 80", lines[2]?.debit === "80.00");
  assert("normal bill: inventory credit 80", lines[3]?.credit === "80.00");
  assert("normal bill: debits = credits", sumSide(lines, "debit") === sumSide(lines, "credit"));
  validateJournalLines(lines);
  console.log("PASS normal bill: validateJournalLines ok");
}

// 2. All cost_price = 0 → 2 lines only
{
  const items: PosPostingItemInput[] = [
    { unitCostPrice: "0", quantity: "2" },
    { unitCostPrice: "0.00", quantity: "1" },
  ];
  const lines = buildPosBillPaidLines(baseBill({ totalAmount: "100.00" }), items);
  assert("zero cost: 2 lines", lines.length === 2);
  assert("zero cost: revenue only", lines[1]?.accountCode === "4000");
  assert("zero cost: balanced", sumSide(lines, "debit") === sumSide(lines, "credit"));
  validateJournalLines(lines);
  console.log("PASS zero cost: validateJournalLines ok");
}

// 3. Mixed cart — COGS only items with cost > 0
{
  const items: PosPostingItemInput[] = [
    { unitCostPrice: "25.00", quantity: "2" },
    { unitCostPrice: "0", quantity: "3" },
    { unitCostPrice: "10.00", quantity: "1" },
  ];
  const lines = buildPosBillPaidLines(baseBill({ totalAmount: "200.00" }), items);
  assert("mixed cart: 4 lines", lines.length === 4);
  assert("mixed cart: COGS 60 (50+10 only)", lines[2]?.debit === "60.00");
  assert("mixed cart: balanced", sumSide(lines, "debit") === sumSide(lines, "credit"));
  validateJournalLines(lines);
  console.log("PASS mixed cart: validateJournalLines ok");
}

// 4. promptpay → 1010
{
  const lines = buildPosBillPaidLines(
    baseBill({ paymentMethod: "promptpay", totalAmount: "50.00" }),
    [{ unitCostPrice: "0", quantity: "1" }],
  );
  assert("promptpay: account 1010", lines[0]?.accountCode === "1010");
}

// 5. cash → 1000
{
  const lines = buildPosBillPaidLines(
    baseBill({ paymentMethod: "cash", totalAmount: "50.00" }),
    [{ unitCostPrice: "0", quantity: "1" }],
  );
  assert("cash: account 1000", lines[0]?.accountCode === "1000");
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}`);
process.exit(failed > 0 ? 1 : 0);
