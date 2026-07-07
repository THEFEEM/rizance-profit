/**
 * Shop transfer posting adapter unit tests (no DB).
 *
 * Usage: npx tsx scripts/test-shop-transfer-posting-adapter.ts
 */
import { validateJournalLines } from "../lib/journal-queries";
import { toCents } from "../lib/money";
import { buildTransferJournalLines } from "../lib/shop-transfer-posting-adapter";

let failed = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function sumSide(
  lines: ReturnType<typeof buildTransferJournalLines>,
  side: "debit" | "credit",
): number {
  return lines.reduce((acc, line) => acc + toCents(line[side]), 0);
}

console.log("=== shop-transfer-posting-adapter (mock) ===\n");

{
  const lines = buildTransferJournalLines("cash_to_transfer", "500.00");
  assert("cash_to_transfer: 2 lines", lines.length === 2);
  assert("cash_to_transfer: Dr 1010", lines[0]?.accountCode === "1010" && lines[0]?.debit === "500.00");
  assert("cash_to_transfer: Cr 1000", lines[1]?.accountCode === "1000" && lines[1]?.credit === "500.00");
  assert("cash_to_transfer: balanced", sumSide(lines, "debit") === sumSide(lines, "credit"));
  validateJournalLines(lines);
  console.log("PASS cash_to_transfer: validateJournalLines ok");
}

{
  const lines = buildTransferJournalLines("transfer_to_cash", "250.50");
  assert("transfer_to_cash: 2 lines", lines.length === 2);
  assert("transfer_to_cash: Dr 1000", lines[0]?.accountCode === "1000" && lines[0]?.debit === "250.50");
  assert("transfer_to_cash: Cr 1010", lines[1]?.accountCode === "1010" && lines[1]?.credit === "250.50");
  assert("transfer_to_cash: balanced", sumSide(lines, "debit") === sumSide(lines, "credit"));
  validateJournalLines(lines);
  console.log("PASS transfer_to_cash: validateJournalLines ok");
}

console.log(`\n--- ${failed === 0 ? "all passed" : `${failed} failed`} ---`);
process.exit(failed ? 1 : 0);
