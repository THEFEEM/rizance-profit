/**
 * Journal queries unit + DB tests (DB tests always ROLLBACK).
 *
 * Usage: npx tsx scripts/test-journal-queries.ts
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgPoolOptions } from "../lib/pg-config";
import {
  JournalDuplicatePostingError,
  JournalValidationError,
  postJournalEntry,
  reverseJournalEntry,
  validateJournalLines,
} from "../lib/journal-queries";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(join(ROOT, file), "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch {
      // optional
    }
  }
}

loadEnv();

let failed = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertThrows(label: string, fn: () => void, ErrorClass?: new (...args: never[]) => Error): void {
  try {
    fn();
    console.log(`FAIL ${label} — expected throw`);
    failed++;
  } catch (err) {
    if (ErrorClass && !(err instanceof ErrorClass)) {
      console.log(`FAIL ${label} — wrong error: ${(err as Error).name}`);
      failed++;
      return;
    }
    console.log(`PASS ${label}`);
  }
}

async function assertThrowsAsync(
  label: string,
  fn: () => Promise<unknown>,
  ErrorClass?: new (...args: never[]) => Error,
): Promise<void> {
  try {
    await fn();
    console.log(`FAIL ${label} — expected throw`);
    failed++;
  } catch (err) {
    if (ErrorClass && !(err instanceof ErrorClass)) {
      console.log(`FAIL ${label} — wrong error: ${(err as Error).name}`);
      failed++;
      return;
    }
    console.log(`PASS ${label}`);
  }
}

async function main(): Promise<void> {
  console.log("=== journal-queries validation (no DB) ===\n");

  assertThrows(
    "validate: unbalanced debits/credits",
    () =>
      validateJournalLines([
        { accountCode: "1000", debit: "100.00", credit: "0" },
        { accountCode: "4000", debit: "0", credit: "50.00" },
      ]),
    JournalValidationError,
  );

  assertThrows(
    "validate: line with debit and credit both > 0",
    () =>
      validateJournalLines([
        { accountCode: "1000", debit: "50.00", credit: "50.00" },
        { accountCode: "4000", debit: "0", credit: "50.00" },
      ]),
    JournalValidationError,
  );

  assertThrows(
    "validate: fewer than 2 lines",
    () => validateJournalLines([{ accountCode: "1000", debit: "100.00", credit: "0" }]),
    JournalValidationError,
  );

  validateJournalLines([
    { accountCode: "1000", debit: "100.00", credit: "0" },
    { accountCode: "4000", debit: "0", credit: "100.00" },
  ]);
  console.log("PASS validate: balanced 2-line entry");

  console.log("\n=== journal-queries mock client (no DB insert on validation fail) ===\n");

  const mockClient = {
    query: async () => {
      throw new Error("mock client should not be called");
    },
  } as unknown as pg.PoolClient;

  await assertThrowsAsync(
    "postJournalEntry: unbalanced throws before insert",
    () =>
      postJournalEntry(mockClient, {
        userId: randomUUID(),
        entryDate: "2026-07-06",
        description: "test",
        sourceModule: "test",
        sourceEventId: randomUUID(),
        sourceEventType: "test_event",
        lines: [
          { accountCode: "1000", debit: "100.00", credit: "0" },
          { accountCode: "4000", debit: "0", credit: "50.00" },
        ],
      }),
    JournalValidationError,
  );

  await assertThrowsAsync(
    "postJournalEntry: invalid line throws before insert",
    () =>
      postJournalEntry(mockClient, {
        userId: randomUUID(),
        entryDate: "2026-07-06",
        description: "test",
        sourceModule: "test",
        sourceEventId: randomUUID(),
        sourceEventType: "test_event",
        lines: [
          { accountCode: "1000", debit: "10.00", credit: "10.00" },
          { accountCode: "4000", debit: "0", credit: "10.00" },
        ],
      }),
    JournalValidationError,
  );

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("\nSKIP DB tests — DATABASE_URL not set");
    return;
  }

  console.log("\n=== journal-queries DB (ROLLBACK) ===\n");

  const pool = new pg.Pool(pgPoolOptions(connectionString));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: users } = await client.query<{ id: string }>(
      `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`,
    );
    const userId = users[0]?.id;
    if (!userId) {
      throw new Error("no users in database for journal test");
    }

    const sourceEventId = randomUUID();

    const entry = await postJournalEntry(client, {
      userId,
      entryDate: "2026-07-06",
      description: "POS test sale",
      sourceModule: "pos",
      sourceEventId,
      sourceEventType: "pos_bill_paid",
      lines: [
        { accountCode: "1000", debit: "150.00", credit: "0" },
        { accountCode: "4000", debit: "0", credit: "150.00" },
        { accountCode: "5000", debit: "50.00", credit: "0" },
        { accountCode: "1200", debit: "0", credit: "50.00" },
      ],
    });

    assert("postJournalEntry: returns id", Boolean(entry.id));
    assert("postJournalEntry: source fields", entry.sourceEventType === "pos_bill_paid");

    const { rows: lineRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_lines WHERE entry_id = $1`,
      [entry.id],
    );
    assert("postJournalEntry: inserts all lines", lineRows[0]?.n === "4");

    await client.query("SAVEPOINT before_duplicate");
    try {
      await postJournalEntry(client, {
        userId,
        entryDate: "2026-07-06",
        description: "duplicate",
        sourceModule: "pos",
        sourceEventId,
        sourceEventType: "pos_bill_paid",
        lines: [
          { accountCode: "1000", debit: "10.00", credit: "0" },
          { accountCode: "4000", debit: "0", credit: "10.00" },
        ],
      });
      assert("postJournalEntry: duplicate source throws JournalDuplicatePostingError", false);
    } catch (err) {
      if (err instanceof JournalDuplicatePostingError) {
        await client.query("ROLLBACK TO SAVEPOINT before_duplicate");
        console.log("PASS postJournalEntry: duplicate source throws JournalDuplicatePostingError");
      } else {
        await client.query("ROLLBACK TO SAVEPOINT before_duplicate");
        console.log(`FAIL postJournalEntry: duplicate source — wrong error: ${(err as Error).name}`);
        failed++;
      }
    }

    const reversal = await reverseJournalEntry(client, entry.id, {
      description: "Void POS bill",
    });

    assert("reverseJournalEntry: new entry id", reversal.id !== entry.id);
    assert(
      "reverseJournalEntry: reversal source_event_type",
      reversal.sourceEventType === "pos_bill_paid_reversal",
    );

    const { rows: reversedRows } = await client.query<{ reversed_by_entry_id: string | null }>(
      `SELECT reversed_by_entry_id FROM journal_entries WHERE id = $1`,
      [entry.id],
    );
    assert(
      "reverseJournalEntry: original points to reversal",
      reversedRows[0]?.reversed_by_entry_id === reversal.id,
    );

    const { rows: originalLines } = await client.query<{ debit: string; credit: string }>(
      `SELECT debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
      [entry.id],
    );
    const { rows: reversalLines } = await client.query<{ debit: string; credit: string }>(
      `SELECT debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
      [reversal.id],
    );

    const swappedOk =
      originalLines.length === reversalLines.length &&
      originalLines.every((orig, i) => {
        const rev = reversalLines[i];
        return orig.debit === rev.credit && orig.credit === rev.debit;
      });
    assert("reverseJournalEntry: lines swapped debit/credit", swappedOk);

    await client.query("ROLLBACK");
    console.log("\nDB transaction rolled back (no persistent test data)");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DB test error:", err);
    failed++;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then(() => {
    console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
