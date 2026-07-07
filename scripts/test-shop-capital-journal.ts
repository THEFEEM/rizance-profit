/**
 * RBP-007 integration: createCapitalTx + journal + trial balance.
 *
 * Usage: npx tsx scripts/test-shop-capital-journal.ts
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

async function createCapitalTxWithPaymentMethod(
  userId: string,
  input: {
    memberId: string;
    amount: number;
    direction: "contribution" | "withdrawal";
    paymentMethod: "cash" | "transfer";
    entryDate: string;
  },
): Promise<void> {
  const { pool } = await import("../lib/db");
  const { memberEquityFromLedger, syncMemberInvestmentAmount } = await import(
    "../lib/shop-capital-queries"
  );
  const { postCapitalJournal } = await import("../lib/shop-capital-posting-adapter");
  const { toCents } = await import("../lib/money");

  const amount = input.amount.toFixed(2);
  const txClient = await pool.connect();
  try {
    await txClient.query("BEGIN");

    if (input.direction === "withdrawal") {
      const current = await memberEquityFromLedger(userId, input.memberId, txClient);
      if (toCents(amount) > toCents(current)) {
        throw new Error(`withdrawal exceeds equity: ${current}`);
      }
    }

    const { rows } = await txClient.query<{
      id: string;
      amount: string;
      direction: string;
      entry_date: string;
    }>(
      `INSERT INTO capital_transactions (user_id, member_id, amount, direction, payment_method, entry_date)
       VALUES ($1, $2, $3, $4, $5, $6::date)
       RETURNING id, amount, direction, entry_date::text AS entry_date`,
      [userId, input.memberId, amount, input.direction, input.paymentMethod, input.entryDate],
    );
    const row = rows[0]!;

    await syncMemberInvestmentAmount(txClient, userId, input.memberId);

    const memberRes = await txClient.query<{ name: string }>(
      `SELECT name FROM shop_members WHERE id = $2 AND user_id = $1`,
      [userId, input.memberId],
    );
    const memberName = memberRes.rows[0]?.name;

    await postCapitalJournal(txClient, {
      id: row.id,
      userId,
      amount: row.amount,
      direction: row.direction as "contribution" | "withdrawal",
      paymentMethod: input.paymentMethod,
      entryDate: row.entry_date,
      memberName,
    });

    await txClient.query("COMMIT");
  } catch (err) {
    await txClient.query("ROLLBACK");
    throw err;
  } finally {
    txClient.release();
  }
}

async function main(): Promise<void> {
  const { createCapitalTx } = await import("../lib/shop-capital-queries");

  try {
    await client.connect();
    const email = `capital-journal-${Date.now()}@rizance.test`;
    const { rows: userRows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, shop_name)
       VALUES ($1, 'capital-test', 'Capital Shop') RETURNING id`,
      [email],
    );
    userId = userRows[0]!.id;

    const { rows: memberRows } = await client.query<{ id: string }>(
      `INSERT INTO shop_members (user_id, name, role, investment_amount)
       VALUES ($1, 'Test Partner', 'investor', 0) RETURNING id`,
      [userId],
    );
    const memberId = memberRows[0]!.id;

    console.log("=== RBP-007 capital journal integration ===\n");

    const contribCash = await createCapitalTx(userId, {
      memberId,
      amount: 1000,
      direction: "contribution",
      entryDate: "2026-07-08",
    });
    assert("contribution cash created", contribCash.transaction.direction === "contribution");

    await createCapitalTxWithPaymentMethod(userId, {
      memberId,
      amount: 500,
      direction: "contribution",
      paymentMethod: "transfer",
      entryDate: "2026-07-08",
    });
    assert("contribution transfer created", true);

    const withdrawCash = await createCapitalTx(userId, {
      memberId,
      amount: 200,
      direction: "withdrawal",
      entryDate: "2026-07-08",
    });
    assert("withdrawal cash created", withdrawCash.transaction.direction === "withdrawal");

    await createCapitalTxWithPaymentMethod(userId, {
      memberId,
      amount: 100,
      direction: "withdrawal",
      paymentMethod: "transfer",
      entryDate: "2026-07-08",
    });
    assert("withdrawal transfer created", true);

    const journals = await client.query<{ id: string }>(
      `SELECT id FROM journal_entries
       WHERE user_id = $1 AND source_module = 'shop_capital'
       ORDER BY created_at`,
      [userId],
    );
    assert("4 journal entries", journals.rows.length === 4, String(journals.rows.length));

    const lines = await client.query<{ account_code: string; debit: string; credit: string }>(
      `SELECT jl.account_code, jl.debit::text, jl.credit::text
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1 AND je.source_module = 'shop_capital'
       ORDER BY je.created_at, jl.account_code`,
      [userId],
    );
    assert(
      "contribution cash Dr 1000 / Cr 3000",
      lines.rows.some((r) => r.account_code === "1000" && r.debit === "1000.00") &&
        lines.rows.some((r) => r.account_code === "3000" && r.credit === "1000.00"),
    );
    assert(
      "contribution transfer Dr 1010 / Cr 3000",
      lines.rows.some((r) => r.account_code === "1010" && r.debit === "500.00") &&
        lines.rows.some((r) => r.account_code === "3000" && r.credit === "500.00"),
    );
    assert(
      "withdrawal cash Dr 3000 / Cr 1000",
      lines.rows.some((r) => r.account_code === "3000" && r.debit === "200.00") &&
        lines.rows.some((r) => r.account_code === "1000" && r.credit === "200.00"),
    );
    assert(
      "withdrawal transfer Dr 3000 / Cr 1010",
      lines.rows.some((r) => r.account_code === "3000" && r.debit === "100.00") &&
        lines.rows.some((r) => r.account_code === "1010" && r.credit === "100.00"),
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
    const equityBal = trialBalance.rows.find((r) => r.account_code === "3000")?.balance;
    assert("1000 net +800", Number(cashBal) === 800, String(cashBal));
    assert("1010 net +400", Number(bankBal) === 400, String(bankBal));
    assert("3000 net -1200", Number(equityBal) === -1200, String(equityBal));

    console.log("\n--- rollback on journal duplicate ---");
    const poisonTxId = randomUUID();
    await client.query(
      `INSERT INTO journal_entries (user_id, entry_date, description, source_module, source_event_id, source_event_type)
       VALUES ($1, '2026-07-08'::date, 'poison pill', 'shop_capital', $2, 'capital_transaction_created')`,
      [userId, poisonTxId],
    );

    const { rows: countBefore } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM capital_transactions WHERE user_id = $1`,
      [userId],
    );
    const txCountBefore = Number(countBefore[0]!.n);

    const { pool } = await import("../lib/db");
    const { postCapitalJournal } = await import("../lib/shop-capital-posting-adapter");
    const { syncMemberInvestmentAmount } = await import("../lib/shop-capital-queries");
    const { JournalDuplicatePostingError } = await import("../lib/journal-queries");

    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");
      await txClient.query(
        `INSERT INTO capital_transactions (id, user_id, member_id, amount, direction, entry_date)
         VALUES ($1, $2, $3, $4, 'contribution', $5::date)`,
        [poisonTxId, userId, memberId, "99.99", "2026-07-08"],
      );
      await syncMemberInvestmentAmount(txClient, userId, memberId);
      await postCapitalJournal(txClient, {
        id: poisonTxId,
        userId,
        amount: "99.99",
        direction: "contribution",
        paymentMethod: "cash",
        entryDate: "2026-07-08",
        memberName: "Test Partner",
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
      `SELECT COUNT(*)::text AS n FROM capital_transactions WHERE user_id = $1`,
      [userId],
    );
    assert(
      "rollback: capital_transactions count unchanged",
      Number(countAfter[0]!.n) === txCountBefore,
      `${txCountBefore} → ${countAfter[0]!.n}`,
    );
    const { rowCount: poisonTxRows } = await client.query(
      `SELECT 1 FROM capital_transactions WHERE id = $1`,
      [poisonTxId],
    );
    assert("rollback: poison capital tx row absent", (poisonTxRows ?? 0) === 0);
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
