/**
 * Shop capital posting adapter unit tests (no DB).
 *
 * Usage: npx tsx scripts/test-shop-capital-posting-adapter.ts
 */
import { validateJournalLines } from "../lib/journal-queries";
import { toCents } from "../lib/money";
import { buildCapitalJournalLines } from "../lib/shop-capital-posting-adapter";

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
  lines: ReturnType<typeof buildCapitalJournalLines>,
  side: "debit" | "credit",
): number {
  return lines.reduce((acc, line) => acc + toCents(line[side]), 0);
}

function runCase(
  label: string,
  direction: "contribution" | "withdrawal",
  paymentMethod: "cash" | "transfer",
  amount: string,
  expectDr: { account: string; amount: string },
  expectCr: { account: string; amount: string },
): void {
  const lines = buildCapitalJournalLines(direction, paymentMethod, amount);
  assert(`${label}: 2 lines`, lines.length === 2);
  assert(
    `${label}: Dr ${expectDr.account}`,
    lines.some((l) => l.accountCode === expectDr.account && l.debit === expectDr.amount),
  );
  assert(
    `${label}: Cr ${expectCr.account}`,
    lines.some((l) => l.accountCode === expectCr.account && l.credit === expectCr.amount),
  );
  assert(`${label}: balanced`, sumSide(lines, "debit") === sumSide(lines, "credit"));
  validateJournalLines(lines);
  console.log(`PASS ${label}: validateJournalLines ok`);
}

console.log("=== shop-capital-posting-adapter (mock) ===\n");

runCase("contribution cash", "contribution", "cash", "1000.00", { account: "1000", amount: "1000.00" }, { account: "3000", amount: "1000.00" });
runCase("contribution transfer", "contribution", "transfer", "500.00", { account: "1010", amount: "500.00" }, { account: "3000", amount: "500.00" });
runCase("withdrawal cash", "withdrawal", "cash", "200.00", { account: "3000", amount: "200.00" }, { account: "1000", amount: "200.00" });
runCase("withdrawal transfer", "withdrawal", "transfer", "100.00", { account: "3000", amount: "100.00" }, { account: "1010", amount: "100.00" });

console.log(`\n--- ${failed === 0 ? "all passed" : `${failed} failed`} ---`);
process.exit(failed ? 1 : 0);
