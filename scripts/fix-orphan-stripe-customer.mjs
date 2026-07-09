import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const res = await client.query(
  `UPDATE users SET stripe_customer_id = NULL
   WHERE stripe_customer_id = 'cus_UnGNjoqpSF3b79'
   RETURNING id, email, stripe_customer_id`,
);
console.log("UPDATED:", JSON.stringify(res.rows, null, 2));
await client.end();
