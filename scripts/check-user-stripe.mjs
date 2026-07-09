import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const u = await client.query(
  `SELECT id, email, subscription_plan, subscription_expires_at, stripe_customer_id, stripe_subscription_id
   FROM users WHERE email = 'lutfee7890@gmail.com'`,
);
console.log("USER:", JSON.stringify(u.rows[0], null, 2));
if (u.rows[0]) {
  const pay = await client.query(
    `SELECT id, plan, amount, expires_at, status, stripe_session_id, created_at
     FROM stripe_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [u.rows[0].id],
  );
  console.log("PAYMENTS:", JSON.stringify(pay.rows, null, 2));
  const now = new Date();
  const exp = u.rows[0].subscription_expires_at ? new Date(u.rows[0].subscription_expires_at) : null;
  const active = exp && exp > now && u.rows[0].subscription_plan !== "free";
  console.log("ACTIVE_SUB:", active, "plan:", u.rows[0].subscription_plan, "expires:", exp?.toISOString());
}
await client.end();
