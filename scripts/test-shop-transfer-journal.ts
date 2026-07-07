/**
 * RBP-006 integration: createTransfer + journal + trial balance.
 *
 * Usage: npx tsx scripts/test-shop-transfer-journal.ts
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgPoolOptions } from "../lib/pg-config";

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
  if (cond) console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const client = new pg.Client(pgPoolOptions(process.env.DATABASE_URL!));
let userId: string | null = null;

async function main(): Promise<void> {
  const { createTransfer } = await import("../lib/queries");

  try {
    await client.connect();
    const email = `xfer-journal-${Date.now()}@rizance.test`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, shop_name)
       VALUES ($1, 'xfer-test', 'Xfer Shop') RETURNING id`,
      [email],
    );
    userId = rows[0]!.id;

    console.log("=== RBP-006 transfer journal integration ===\n");

    const deposit = await createTransfer(userId, {
      amount: 500,
      direction: "cash_to_transfer",
      entryDate: "2026-07-07",
      note: "test deposit",
    });
    assert("cash_to_transfer created", deposit.direction === "cash_to_transfer", deposit.id);

    const withdraw = await createTransfer(userId, {
      amount: 200,
      direction: "transfer_to_cash",
      entryDate: "2026-07-07",
    });
    assert("transfer_to_cash created", withdraw.direction === "transfer_to_cash", withdraw.id);

    const journals = await client.query<{ id: string; source_event_type: string }>(
      `SELECT id, source_event_type FROM journal_entries
       WHERE user_id = $1 AND source_module = 'shop_transfer'
       ORDER BY created_at`,
      [userId],
    );
    assert("2 journal entries", journals.rows.length === 2, String(journals.rows.length));

    const lines = await client.query<{ account_code: string; debit: string; credit: string }>(
      `SELECT jl.account_code, jl.debit::text, jl.credit::text
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1 AND je.source_module = 'shop_transfer'
       ORDER BY je.created_at, jl.account_code`,
      [userId],
    );
    assert(
      "deposit Dr 1010 / Cr 1000",
      lines.rows.some((r) => r.account_code === "1010" && r.debit === "500.00") &&
        lines.rows.some((r) => r.account_code === "1000" && r.credit === "500.00"),
    );
    assert(
      "withdraw Dr 1000 / Cr 1010",
      lines.rows.some((r) => r.account_code === "1000" && r.debit === "200.00") &&
        lines.rows.some((r) => r.account_code === "1010" && r.credit === "200.00"),
    );

    const trialBalance = await client.query<{ account_code: string; balance: string }>(
      `SELECT jl.account_code, SUM(jl.debit) - SUM(jl.credit) AS balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1
       GROUP BY jl.account_code
       ORDER BY jl.account_code`,
      [userId],
    );

    console.log("\n--- trial balance (test user) ---");
    let trialSum = 0;
    for (const row of trialBalance.rows) {
      console.log(`  ${row.account_code}: ${row.balance}`);
      trialSum += Number(row.balance);
    }
    console.log(`  SUM(all balances): ${trialSum}`);
    assert("trial balance sums to 0", Math.abs(trialSum) < 0.001, String(trialSum));

    const cashBal = trialBalance.rows.find((r) => r.account_code === "1000")?.balance;
    const bankBal = trialBalance.rows.find((r) => r.account_code === "1010")?.balance;
    assert("1000 net -300", Number(cashBal) === -300, String(cashBal));
    assert("1010 net +300", Number(bankBal) === 300, String(bankBal));

    // Rollback: journal duplicate after transfer INSERT must not leave money_transfers row.
    // createTransfer() assigns transfer id server-side; we mirror its BEGIN/INSERT/postJournal
    // sequence with an explicit id so we can pre-seed idx_journal_source_unique collision.
    console.log("\n--- rollback on journal duplicate ---");
    const poisonXferId = randomUUID();
    await client.query(
      `INSERT INTO journal_entries (user_id, entry_date, description, source_module, source_event_id, source_event_type)
       VALUES ($1, '2026-07-07'::date, 'poison pill', 'shop_transfer', $2, 'money_transfer_created')`,
      [userId, poisonXferId],
    );

    const { rows: countBefore } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM money_transfers WHERE user_id = $1`,
      [userId],
    );
    const xferCountBefore = Number(countBefore[0]!.n);

    const { pool } = await import("../lib/db");
    const { postTransferJournal } = await import("../lib/shop-transfer-posting-adapter");
    const { JournalDuplicatePostingError } = await import("../lib/journal-queries");

    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");
      await txClient.query(
        `INSERT INTO money_transfers (id, user_id, amount, direction, entry_date)
         VALUES ($1, $2, $3, $4, $5::date)`,
        [poisonXferId, userId, "99.99", "cash_to_transfer", "2026-07-07"],
      );
      await postTransferJournal(txClient, {
        id: poisonXferId,
        userId,
        amount: "99.99",
        direction: "cash_to_transfer",
        entryDate: "2026-07-07",
      });
      await txClient.query("COMMIT");
      assert("journal duplicate throws (no commit)", false);
    } catch (err) {
      await txClient.query("ROLLBACK");
      assert(
        "journal duplicate throws JournalDuplicatePostingError",
        err instanceof JournalDuplicatePostingError,
        err instanceof Error ? err.name : String(err),
      );
    } finally {
      txClient.release();
    }

    const { rows: countAfter } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM money_transfers WHERE user_id = $1`,
      [userId],
    );
    assert(
      "rollback: money_transfers count unchanged",
      Number(countAfter[0]!.n) === xferCountBefore,
      `${xferCountBefore} → ${countAfter[0]!.n}`,
    );
    const { rowCount: poisonXferRows } = await client.query(
      `SELECT 1 FROM money_transfers WHERE id = $1`,
      [poisonXferId],
    );
    assert("rollback: poison transfer row absent", (poisonXferRows ?? 0) === 0);
  } finally {
    if (userId) {
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("\n(test user cleaned up — CASCADE)");
    }
    await client.end();
  }

  console.log(`\n--- ${failed === 0 ? "all passed" : `${failed} failed`} ---`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
