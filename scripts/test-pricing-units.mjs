// Unit-conversion integration test for cost/pricing math.
// Usage: npm run test:pricing-units
//
// Creates a temp user + ingredients/recipes in the real DB, asserts line costs,
// then deletes the user (CASCADE).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import { computeRecipeLineCost, sumLineCosts } from "./pricing-math-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // skip
  }
}

const CASES = [
  {
    name: "Milk 1 L @ ฿50, recipe 200 ml",
    ingredient: { name: "Milk-L", purchaseQuantity: 1, purchaseUnit: "l", purchasePrice: "50.00" },
    recipeQty: 200,
    expected: "10.00",
  },
  {
    name: "Sugar 1 kg @ ฿40, recipe 15 g",
    ingredient: { name: "Sugar-kg", purchaseQuantity: 1, purchaseUnit: "kg", purchasePrice: "40.00" },
    recipeQty: 15,
    expected: "0.60",
  },
  {
    name: "Milk 1000 ml @ ฿50, recipe 200 ml (same family)",
    ingredient: { name: "Milk-ml", purchaseQuantity: 1000, purchaseUnit: "ml", purchasePrice: "50.00" },
    recipeQty: 200,
    expected: "10.00",
  },
  {
    name: "Cup 100 piece @ ฿200, recipe 1 piece",
    ingredient: { name: "Cup", purchaseQuantity: 100, purchaseUnit: "piece", purchasePrice: "200.00" },
    recipeQty: 1,
    expected: "2.00",
  },
];

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: expected ${expected}, got ${actual}`);
  return ok;
}

async function computeMenuCostFromDb(client, userId, menuItemId) {
  const { rows } = await client.query(
    `SELECT ri.quantity, i.purchase_price, i.purchase_quantity, i.purchase_unit
     FROM recipe_items ri
     JOIN ingredients i ON i.id = ri.ingredient_id
     JOIN menu_items m ON m.id = ri.menu_item_id
     WHERE m.user_id = $1 AND ri.menu_item_id = $2`,
    [userId, menuItemId],
  );
  const lines = rows.map((r) =>
    computeRecipeLineCost(
      r.quantity,
      r.purchase_price,
      r.purchase_quantity,
      r.purchase_unit,
    ),
  );
  return sumLineCosts(...lines, "0.00");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client(pgClientOptions(connectionString));
let userId = null;
let failed = 0;

try {
  await client.connect();
  console.log("=== PRICING UNIT CONVERSION TEST ===\n");

  const email = `pricing-units-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'pricing-units-test', 'Pricing Units Test')
     RETURNING id`,
    [email],
  );
  userId = users[0].id;
  console.log(`Temp user: ${email}\n`);

  for (const [i, c] of CASES.entries()) {
    console.log(`${i + 1}) ${c.name}`);

    const direct = computeRecipeLineCost(
      c.recipeQty,
      c.ingredient.purchasePrice,
      c.ingredient.purchaseQuantity,
      c.ingredient.purchaseUnit,
    );
    if (!assertEq("pure math", direct, c.expected)) failed++;

    const { rows: ings } = await client.query(
      `INSERT INTO ingredients (user_id, name, purchase_quantity, purchase_unit, purchase_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        c.ingredient.name,
        c.ingredient.purchaseQuantity,
        c.ingredient.purchaseUnit,
        c.ingredient.purchasePrice,
      ],
    );
    const ingredientId = ings[0].id;

    const { rows: menus } = await client.query(
      `INSERT INTO menu_items (user_id, name) VALUES ($1, $2) RETURNING id`,
      [userId, `Menu-${i + 1}`],
    );
    const menuItemId = menus[0].id;

    await client.query(
      `INSERT INTO recipe_items (menu_item_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
      [menuItemId, ingredientId, c.recipeQty],
    );

    const fromDb = await computeMenuCostFromDb(client, userId, menuItemId);
    if (!assertEq("DB query path", fromDb, c.expected)) failed++;

    console.log("");
  }

  if (failed === 0) {
    console.log("All assertions passed.");
  } else {
    console.error(`${failed} assertion(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
} finally {
  if (userId) {
    // recipe_items → ingredients is RESTRICT; drop recipes before user CASCADE hits ingredients
    await client.query(`DELETE FROM menu_items WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log("(test user and data cleaned up)");
  }
  await client.end();
}
