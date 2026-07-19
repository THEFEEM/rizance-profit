#!/usr/bin/env node
/**
 * Seed NINENON BURGER modifier groups + link to products by name.
 * Idempotent (ON CONFLICT DO NOTHING). Run AFTER migration 0050.
 *
 *   node scripts/seed-ninenon-modifiers.mjs <user-email>
 *
 * Groups:
 *   ชีส   (radio 0-1):  ชีส 1 แผ่น +10, ชีส 2 แผ่น +20   → linked to all burgers
 *   ไข่ดาว (checkbox):  ไข่ดาว +10                        → linked to all burgers
 *   ซอส   (radio REQUIRED 1-1): Spicy +0, Classic +0     → linked to Crispy Chick
 *
 * Product name matching (case-insensitive, substring):
 *   burgers: smash, beef burger, dubble, chicky
 *   sauce:   crispy chick
 */
import pg from "pg";

const email = process.argv[2];
if (!email) {
  console.error("usage: node scripts/seed-ninenon-modifiers.mjs <user-email>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const GROUPS = [
  {
    name: "ชีส",
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 0,
    modifiers: [
      { name: "ชีส 1 แผ่น", priceDelta: "10.00", sortOrder: 0 },
      { name: "ชีส 2 แผ่น", priceDelta: "20.00", sortOrder: 1 },
    ],
    productMatch: ["smash", "beef burger", "dubble", "chicky", "burger"],
  },
  {
    name: "ไข่ดาว",
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 1,
    modifiers: [{ name: "เพิ่มไข่ดาว", priceDelta: "10.00", sortOrder: 0 }],
    productMatch: ["smash", "beef burger", "dubble", "chicky", "burger"],
  },
  {
    name: "ซอส",
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 2,
    modifiers: [
      { name: "Spicy Sauce", priceDelta: "0.00", sortOrder: 0 },
      { name: "Classic Sauce", priceDelta: "0.00", sortOrder: 1 },
    ],
    productMatch: ["crispy chick"],
  },
];

const client = await pool.connect();
try {
  const { rows: users } = await client.query(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  if (!users[0]) throw new Error(`user not found: ${email}`);
  const userId = users[0].id;

  const { rows: products } = await client.query(
    "SELECT id, name FROM pos_products WHERE user_id = $1",
    [userId],
  );
  console.log(`user ${email} — ${products.length} products`);

  await client.query("BEGIN");

  for (const g of GROUPS) {
    const { rows: groupRows } = await client.query(
      `INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [userId, g.name, g.minSelect, g.maxSelect, g.sortOrder],
    );
    const groupId = groupRows[0].id;

    for (const m of g.modifiers) {
      await client.query(
        `INSERT INTO pos_modifiers (group_id, name, price_delta, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, name) DO NOTHING`,
        [groupId, m.name, m.priceDelta, m.sortOrder],
      );
    }

    const matched = products.filter((p) =>
      g.productMatch.some((frag) => p.name.toLowerCase().includes(frag)),
    );
    for (const p of matched) {
      await client.query(
        `INSERT INTO pos_product_modifier_groups (product_id, group_id, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [p.id, groupId, g.sortOrder],
      );
    }
    console.log(`group "${g.name}" → linked ${matched.length} products: ${matched.map((p) => p.name).join(", ") || "(none)"}`);
  }

  await client.query("COMMIT");
  console.log("done");
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
