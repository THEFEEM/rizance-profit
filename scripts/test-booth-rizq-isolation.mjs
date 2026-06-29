// Verify booth Rizq chat isolation per booth_id.
// Usage: node scripts/test-booth-rizq-isolation.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // optional
  }
}

async function getBoothChatMessages(client, userId, boothId) {
  const { rows } = await client.query(
    `SELECT content FROM booth_chat_messages
     WHERE booth_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [boothId, userId],
  );
  return rows.map((r) => r.content);
}

let exitCode = 0;
function pass(label) {
  console.log(`✓ ${label}`);
}
function fail(label, detail) {
  console.error(`✗ ${label}${detail ? `: ${detail}` : ""}`);
  exitCode = 1;
}

console.log("=== BOOTH RIZQ ISOLATION TEST ===\n");

const cs = process.env.DATABASE_URL;
if (!cs) {
  fail("DATABASE_URL set", false);
  process.exit(1);
}

const client = new pg.Client(pgClientOptions(cs));
try {
  await client.connect();

  const tbl = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'booth_chat_messages'`,
  );
  if (tbl.rows.length === 0) {
    fail("booth_chat_messages table exists", false);
    process.exit(1);
  }
  pass("booth_chat_messages table exists");

  const multi = await client.query(
    `SELECT user_id, array_agg(id ORDER BY created_at) AS booth_ids, count(*)::int AS n
     FROM booths
     GROUP BY user_id
     HAVING count(*) >= 2
     ORDER BY count(*) DESC
     LIMIT 1`,
  );

  let userId;
  let boothA;
  let boothB;
  let cleanupUser = false;

  if (multi.rows.length > 0) {
    userId = multi.rows[0].user_id;
    boothA = multi.rows[0].booth_ids[0];
    boothB = multi.rows[0].booth_ids[1];
    pass(`using existing user with 2 booths (${boothA.slice(0, 8)}… / ${boothB.slice(0, 8)}…)`);
  } else {
    const email = `booth-rizq-iso-${Date.now()}@rizance.test`;
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, shop_name)
       VALUES ($1, 'x', 'Iso Test') RETURNING id`,
      [email],
    );
    userId = userRes.rows[0].id;
    cleanupUser = true;

    const mkBooth = async (name) => {
      const { rows } = await client.query(
        `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
         VALUES ($1, $2, 0, CURRENT_DATE, CURRENT_DATE)
         RETURNING id`,
        [userId, name],
      );
      return rows[0].id;
    };
    boothA = await mkBooth("Booth A Test");
    boothB = await mkBooth("Booth B Test");
    pass("created temp user + 2 booths");
  }

  await client.query(
    `DELETE FROM booth_chat_messages WHERE user_id = $1 AND booth_id IN ($2, $3)`,
    [userId, boothA, boothB],
  );

  await client.query(
    `INSERT INTO booth_chat_messages (booth_id, user_id, role, content)
     VALUES ($1, $2, 'user', 'ขายได้ 100'), ($3, $2, 'assistant', 'ok A')`,
    [boothA, userId, boothA],
  );
  await client.query(
    `INSERT INTO booth_chat_messages (booth_id, user_id, role, content)
     VALUES ($1, $2, 'user', 'ขายได้ 200'), ($3, $2, 'assistant', 'ok B')`,
    [boothB, userId, boothB],
  );

  const msgsA = await getBoothChatMessages(client, userId, boothA);
  const msgsB = await getBoothChatMessages(client, userId, boothB);

  pass("booth A messages", msgsA.includes("ขายได้ 100"));
  pass("booth A excludes B", !msgsA.includes("ขายได้ 200"));
  pass("booth B messages", msgsB.includes("ขายได้ 200"));
  pass("booth B excludes A", !msgsB.includes("ขายได้ 100"));

  await client.query(
    `DELETE FROM booth_chat_messages WHERE user_id = $1 AND booth_id IN ($2, $3)`,
    [userId, boothA, boothB],
  );

  if (cleanupUser) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
} catch (err) {
  fail("unexpected error", err instanceof Error ? err.message : String(err));
} finally {
  await client.end();
}

if (exitCode) {
  console.log("\nIsolation test failed.");
  process.exit(1);
}
console.log("\nAll booth isolation checks passed.");
