#!/usr/bin/env node
/**
 * Seed the full NINENON BURGER menu into POS:
 * categories + products (base price = no-cheese config) + modifier groups
 * (ชีส/ไข่ดาว/ซอส) + product↔group links + product images.
 *
 * Idempotent — upserts by name; safe to re-run.
 *
 *   node scripts/seed-ninenon-menu.mjs <user-email>
 *
 * Env: DATABASE_URL (required)
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (optional — for images)
 *      SUPABASE_POS_MENU_BUCKET (default pos-menu)
 *
 * Images: put files in scripts/ninenon-images/<slug>.(webp|jpg|jpeg|png)
 * slugs: smash-s, smash-m, smash-l, beef-burger, dubble-beef,
 *        chicky-cheese, crispy-chick, happy-burger
 * Missing images are skipped silently (add later and re-run).
 */
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";

const __root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(path.join(__root, file), "utf8");
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
    // skip
  }
}

const email = process.argv[2];
if (!email) {
  console.error("usage: node scripts/seed-ninenon-menu.mjs <user-email>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const IMAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ninenon-images");
const BUCKET = process.env.SUPABASE_POS_MENU_BUCKET?.trim() || "pos-menu";
const SUPABASE_URL = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const CATEGORIES = [
  { name: "Smash Burger", sortOrder: 0, color: "#ef9f27" },
  { name: "เบอร์เกอร์เนื้อแผ่น", sortOrder: 1, color: "#f87171" },
  { name: "เบอร์เกอร์ไก่", sortOrder: 2, color: "#4ade9e" },
  { name: "เมนูพิเศษ", sortOrder: 3, color: "#b69ce8" },
];

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
  },
  {
    name: "ไข่ดาว",
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 1,
    modifiers: [{ name: "เพิ่มไข่ดาว", priceDelta: "10.00", sortOrder: 0 }],
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
  },
];

// base price = ราคาไม่มีชีส (ชีส/ไข่เป็น modifier ให้ราคาตรงโปสเตอร์ทุกคอมโบ)
const PRODUCTS = [
  { slug: "smash-s", name: "Smash Homemade S (เนื้อ 40g)", price: "59.00", category: "Smash Burger", groups: ["ชีส", "ไข่ดาว"], sortOrder: 0 },
  { slug: "smash-m", name: "Smash Homemade M (เนื้อ 60g)", price: "69.00", category: "Smash Burger", groups: ["ชีส", "ไข่ดาว"], sortOrder: 1 },
  { slug: "smash-l", name: "Smash Homemade L (เนื้อ 80g)", price: "89.00", category: "Smash Burger", groups: ["ชีส", "ไข่ดาว"], sortOrder: 2 },
  { slug: "beef-burger", name: "Beef Burger", price: "49.00", category: "เบอร์เกอร์เนื้อแผ่น", groups: ["ชีส", "ไข่ดาว"], sortOrder: 3 },
  { slug: "dubble-beef", name: "Dubble Beef", price: "59.00", category: "เบอร์เกอร์เนื้อแผ่น", groups: ["ชีส", "ไข่ดาว"], sortOrder: 4 },
  { slug: "chicky-cheese", name: "Chicky Cheese (ไก่ 50g)", price: "59.00", category: "เบอร์เกอร์ไก่", groups: ["ชีส", "ไข่ดาว"], sortOrder: 5 },
  { slug: "crispy-chick", name: "Crispy Chick", price: "79.00", category: "เบอร์เกอร์ไก่", groups: ["ซอส"], sortOrder: 6 },
  { slug: "happy-burger", name: "Happy Burger (17:00-21:00)", price: "99.00", category: "เมนูพิเศษ", groups: [], sortOrder: 7 },
];

function findImage(slug) {
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    const p = path.join(IMAGE_DIR, `${slug}.${ext}`);
    if (fs.existsSync(p)) return { path: p, ext: ext === "jpeg" ? "jpg" : ext };
  }
  return null;
}

async function uploadImage(userId, productId, img) {
  const contentType =
    img.ext === "webp" ? "image/webp" : img.ext === "png" ? "image/png" : "image/jpeg";
  const objectPath = `${userId}/${productId}-${Date.now()}.${img.ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
      "Cache-Control": "public, max-age=31536000",
    },
    body: fs.readFileSync(img.path),
  });
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

const pool = new pg.Pool(pgClientOptions(process.env.DATABASE_URL));
const client = await pool.connect();
try {
  const { rows: users } = await client.query(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  if (!users[0]) throw new Error(`user not found: ${email}`);
  const userId = users[0].id;
  console.log(`seeding NINENON menu for ${email}`);

  await client.query("BEGIN");

  // 1. Categories
  const categoryIds = {};
  for (const c of CATEGORIES) {
    const { rows } = await client.query(
      `INSERT INTO pos_categories (user_id, name, sort_order, color)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, name)
         DO UPDATE SET sort_order = EXCLUDED.sort_order, color = EXCLUDED.color, updated_at = now()
       RETURNING id`,
      [userId, c.name, c.sortOrder, c.color],
    );
    categoryIds[c.name] = rows[0].id;
  }
  console.log(`categories: ${Object.keys(categoryIds).length}`);

  // 2. Modifier groups + options
  const groupIds = {};
  for (const g of GROUPS) {
    const { rows } = await client.query(
      `INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name)
         DO UPDATE SET min_select = EXCLUDED.min_select, max_select = EXCLUDED.max_select,
                       is_active = true, updated_at = now()
       RETURNING id`,
      [userId, g.name, g.minSelect, g.maxSelect, g.sortOrder],
    );
    groupIds[g.name] = rows[0].id;
    for (const m of g.modifiers) {
      await client.query(
        `INSERT INTO pos_modifiers (group_id, name, price_delta, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, name)
           DO UPDATE SET price_delta = EXCLUDED.price_delta, is_active = true, updated_at = now()`,
        [groupIds[g.name], m.name, m.priceDelta, m.sortOrder],
      );
    }
  }
  console.log(`modifier groups: ${Object.keys(groupIds).length}`);

  // 3. Products (upsert by name — no unique constraint, so select-then-insert)
  for (const p of PRODUCTS) {
    const { rows: existing } = await client.query(
      `SELECT id FROM pos_products WHERE user_id = $1 AND name = $2`,
      [userId, p.name],
    );
    let productId;
    if (existing[0]) {
      productId = existing[0].id;
      await client.query(
        `UPDATE pos_products
         SET sell_price = $3, category_id = $4, sort_order = $5, is_active = true,
             track_stock = false, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [productId, userId, p.price, categoryIds[p.category], p.sortOrder],
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO pos_products
           (user_id, name, sell_price, cost_price, stock_qty, track_stock, category_id, sort_order)
         VALUES ($1, $2, $3, 0, 0, false, $4, $5)
         RETURNING id`,
        [userId, p.name, p.price, categoryIds[p.category], p.sortOrder],
      );
      productId = rows[0].id;
    }

    // 4. Link modifier groups (replace set)
    await client.query(`DELETE FROM pos_product_modifier_groups WHERE product_id = $1`, [
      productId,
    ]);
    for (let i = 0; i < p.groups.length; i++) {
      await client.query(
        `INSERT INTO pos_product_modifier_groups (product_id, group_id, sort_order)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [productId, groupIds[p.groups[i]], i],
      );
    }

    // 5. Image (optional)
    const img = findImage(p.slug);
    if (img && SUPABASE_URL && SUPABASE_KEY) {
      const url = await uploadImage(userId, productId, img);
      await client.query(
        `UPDATE pos_products SET image_url = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [productId, userId, url],
      );
      console.log(`  ${p.name} ✓ (+image)`);
    } else {
      console.log(`  ${p.name} ✓${img ? " (no supabase env — image skipped)" : " (no image file)"}`);
    }
  }

  await client.query("COMMIT");
  console.log("done — เปิดหน้าขายแล้วเช็คราคา: Smash L + ชีส 2 แผ่น ต้องได้ 109");
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
