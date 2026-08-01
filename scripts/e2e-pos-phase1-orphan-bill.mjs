/**
 * Phase 1 checklist — รู B (บิลกำพร้า) ข้อ 9–11 + รู A ข้อ 7 + payment_timing smoke
 *
 * Usage (dev DB only unless ALLOW_PROD_DB=1):
 *   node scripts/e2e-pos-phase1-orphan-bill.mjs
 *
 * Requires: profit API on :3000 (or PROFIT_URL), JWT_SECRET, DATABASE_URL
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT = process.env.PROFIT_URL || "http://localhost:3000";
const NINENON_EMAIL = "ninenon2026@gmail.com";

const results = [];
function pass(n, d = "") {
  results.push({ n, ok: true, d });
  console.log(`PASS ${n}${d ? `: ${d}` : ""}`);
}
function fail(n, d) {
  results.push({ n, ok: false, d });
  console.log(`FAIL ${n}: ${d}`);
}

function loadEnv() {
  for (const f of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
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
      /* skip */
    }
  }
}

async function makeCookie(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(secret));
  return `rizance_session=${token}`;
}

async function countBills(db, userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id = $1 AND status = 'paid'`,
    [userId],
  );
  return r.rows[0].n;
}

async function latestBillIds(db, userId, since) {
  const r = await db.query(
    `SELECT id, bill_no, created_at
     FROM pos_bills
     WHERE user_id = $1 AND created_at >= $2
     ORDER BY created_at DESC`,
    [userId, since],
  );
  return r.rows;
}

async function createWalkInOrder(db, userId, product) {
  // Mirror createPosOrder walk-in path (channel=pos)
  // ⚠️ ไม่แตะ pos_order_counters — เคยทำให้เลขออเดอร์จริงชนกัน (29 ก.ค. 69)
  const { rows: cfg } = await db.query(
    `SELECT COALESCE(default_payment_timing, 'after') AS t
     FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  const timing = cfg[0]?.t === "before" ? "before" : "after";
  const orderNo = `ZZ-P1-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;

  const total = product.sell_price;
  const { rows: ord } = await db.query(
    `INSERT INTO pos_orders
       (user_id, order_no, status, channel, customer_name, total_amount, payment_timing)
     VALUES ($1, $2, 'accepted', 'pos', 'phase1-e2e', $3, $4)
     RETURNING id, order_no, status, bill_id, payment_timing`,
    [userId, orderNo, total, timing],
  );
  await db.query(
    `INSERT INTO pos_order_items
       (order_id, product_id, product_name, unit_sell_price, quantity, line_total, sort_order)
     VALUES ($1, $2, $3, $4, 1, $4, 0)`,
    [ord[0].id, product.id, product.name, total],
  );
  return ord[0];
}

async function postBill(cookie, body) {
  const res = await fetch(`${PROFIT}/api/pos/bills`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function patchOrder(cookie, orderId, body) {
  const res = await fetch(`${PROFIT}/api/pos/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL missing");

  // Probe API
  try {
    const health = await fetch(`${PROFIT}/api/auth/me`, { headers: { cookie: "x=1" } });
    if (!health.ok && health.status !== 401) {
      console.warn(`warn: profit at ${PROFIT} returned ${health.status}`);
    }
  } catch (e) {
    fail("api_reachable", `profit not reachable at ${PROFIT}: ${e.message}`);
    printSummary();
    process.exit(1);
  }

  const db = new pg.Client(pgClientOptions(dbUrl));
  await db.connect();

  try {
    // migration 0065
    const col = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name='pos_orders' AND column_name='payment_timing'`,
    );
    if (col.rowCount) pass("migration_0065", "payment_timing column present");
    else fail("migration_0065", "payment_timing column missing — run 0065");

    const { rows: users } = await db.query(
      `SELECT id FROM users WHERE email = $1`,
      [NINENON_EMAIL],
    );
    if (!users[0]) throw new Error(`user ${NINENON_EMAIL} not found`);
    const userId = users[0].id;
    const cookie = await makeCookie(userId);

    const { rows: products } = await db.query(
      `SELECT id, name, sell_price::float8 AS sell_price
       FROM pos_products
       WHERE user_id = $1 AND is_active = true
       ORDER BY sort_order NULLS LAST, name
       LIMIT 1`,
      [userId],
    );
    if (!products[0]) throw new Error("no active product");
    const product = products[0];
    const amount = Math.round(Number(product.sell_price) * 100) / 100;

    const createdIds = [];
    const billIdsToVoid = [];

    // ── ข้อ 9: เก็บเงินจากออเดอร์ → bill_id ต้องไม่ NULL ──
    {
      const order = await createWalkInOrder(db, userId, product);
      createdIds.push(order.id);
      const before = await countBills(db, userId);
      const t0 = new Date();

      const { status, json } = await postBill(cookie, {
        items: [{ productId: product.id, qty: 1 }],
        payments: [{ method: "cash", amount }],
        linkOrderId: order.id,
      });

      if (status !== 201) {
        fail("9_close_with_link", `expected 201 got ${status} ${JSON.stringify(json)}`);
      } else {
        const billId = json?.data?.bill?.id;
        billIdsToVoid.push(billId);
        const { rows } = await db.query(
          `SELECT bill_id FROM pos_orders WHERE id = $1`,
          [order.id],
        );
        if (rows[0]?.bill_id === billId) {
          pass("9_bill_id_linked", `order ${order.order_no} → bill ${json.data.bill.billNo}`);
        } else {
          fail(
            "9_bill_id_linked",
            `order.bill_id=${rows[0]?.bill_id} expected ${billId}`,
          );
        }
        const after = await countBills(db, userId);
        if (after === before + 1) pass("9_bill_created", `paid bills ${before}→${after}`);
        else fail("9_bill_created", `paid bills ${before}→${after}`);
      }
      void t0;
    }

    // ── ข้อ 10: linkOrderId ของออเดอร์ที่ยกเลิก → 409 + ไม่เกิดบิล ──
    {
      const order = await createWalkInOrder(db, userId, product);
      createdIds.push(order.id);
      await db.query(
        `UPDATE pos_orders SET status = 'cancelled', cancel_reason = 'phase1-test', updated_at = now()
         WHERE id = $1`,
        [order.id],
      );

      const beforeBills = await countBills(db, userId);
      const beforeAll = (
        await db.query(`SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id = $1`, [
          userId,
        ])
      ).rows[0].n;
      const t0 = new Date(Date.now() - 1000);

      const { status, json } = await postBill(cookie, {
        items: [{ productId: product.id, qty: 1 }],
        payments: [{ method: "cash", amount }],
        linkOrderId: order.id,
      });

      const afterBills = await countBills(db, userId);
      const afterAll = (
        await db.query(`SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id = $1`, [
          userId,
        ])
      ).rows[0].n;
      const newOnes = await latestBillIds(db, userId, t0);

      if (status === 409 && json?.error === "order_link_failed") {
        pass("10_http_409", "order_link_failed");
      } else {
        fail("10_http_409", `status=${status} body=${JSON.stringify(json)}`);
      }

      // CRITICAL: no bill at all — not just error response
      if (afterBills === beforeBills && afterAll === beforeAll && newOnes.length === 0) {
        pass(
          "10_no_bill_created",
          `ROLLBACK confirmed · paid=${afterBills} all=${afterAll} newSince=${newOnes.length}`,
        );
      } else {
        fail(
          "10_no_bill_created",
          `ORPHAN RISK · paid ${beforeBills}→${afterBills} all ${beforeAll}→${afterAll} new=${JSON.stringify(newOnes)}`,
        );
      }

      // also confirm order still has no bill_id
      const { rows } = await db.query(`SELECT bill_id, status FROM pos_orders WHERE id = $1`, [
        order.id,
      ]);
      if (rows[0]?.bill_id == null && rows[0]?.status === "cancelled") {
        pass("10_order_untouched", "cancelled + bill_id NULL");
      } else {
        fail("10_order_untouched", JSON.stringify(rows[0]));
      }
    }

    // ── ข้อ 11: linkOrderId ที่มีบิลอยู่แล้ว → 409 + ไม่เกิดบิลใหม่ ──
    {
      const order = await createWalkInOrder(db, userId, product);
      createdIds.push(order.id);

      const first = await postBill(cookie, {
        items: [{ productId: product.id, qty: 1 }],
        payments: [{ method: "cash", amount }],
        linkOrderId: order.id,
      });
      if (first.status !== 201) {
        fail("11_setup_first_bill", `got ${first.status}`);
      } else {
        billIdsToVoid.push(first.json.data.bill.id);
        const beforeBills = await countBills(db, userId);
        const beforeAll = (
          await db.query(`SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id = $1`, [
            userId,
          ])
        ).rows[0].n;
        const t0 = new Date(Date.now() - 1000);

        const second = await postBill(cookie, {
          items: [{ productId: product.id, qty: 1 }],
          payments: [{ method: "cash", amount }],
          linkOrderId: order.id,
        });

        const afterBills = await countBills(db, userId);
        const afterAll = (
          await db.query(`SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id = $1`, [
            userId,
          ])
        ).rows[0].n;
        // new bills after t0 excluding the first one we just created
        const newOnes = (await latestBillIds(db, userId, t0)).filter(
          (b) => b.id !== first.json.data.bill.id,
        );

        if (second.status === 409 && second.json?.error === "order_link_failed") {
          pass("11_http_409", "order_link_failed on already-linked order");
        } else {
          fail("11_http_409", `status=${second.status} body=${JSON.stringify(second.json)}`);
        }

        if (afterBills === beforeBills && afterAll === beforeAll && newOnes.length === 0) {
          pass(
            "11_no_new_bill",
            `ROLLBACK confirmed · paid=${afterBills} all=${afterAll}`,
          );
        } else {
          fail(
            "11_no_new_bill",
            `paid ${beforeBills}→${afterBills} all ${beforeAll}→${afterAll} new=${JSON.stringify(newOnes)}`,
          );
        }
      }
    }

    // ── ข้อ 7: ยกเลิกออเดอร์ที่จ่ายแล้ว → 409 order_has_bill ──
    {
      const order = await createWalkInOrder(db, userId, product);
      createdIds.push(order.id);
      const closed = await postBill(cookie, {
        items: [{ productId: product.id, qty: 1 }],
        payments: [{ method: "cash", amount }],
        linkOrderId: order.id,
      });
      if (closed.status !== 201) {
        fail("7_setup", `close failed ${closed.status}`);
      } else {
        billIdsToVoid.push(closed.json.data.bill.id);
        const { status, json } = await patchOrder(cookie, order.id, {
          status: "cancelled",
          cancelReason: "phase1-test-hole-a",
        });
        if (status === 409 && json?.error === "order_has_bill") {
          pass("7_order_has_bill", `billId=${json.billId}`);
        } else {
          fail("7_order_has_bill", `status=${status} body=${JSON.stringify(json)}`);
        }
        const { rows } = await db.query(`SELECT status FROM pos_orders WHERE id = $1`, [
          order.id,
        ]);
        if (rows[0]?.status !== "cancelled") {
          pass("7_order_not_cancelled", `still ${rows[0]?.status}`);
        } else {
          fail("7_order_not_cancelled", "order was cancelled despite bill");
        }
      }
    }

    // ── ข้อ 12 smoke: last linked bill balancing ──
    {
      const { rows } = await db.query(
        `SELECT b.id, b.bill_no, b.total_amount::text AS total,
                COALESCE(SUM(bi.line_total), 0)::text AS items_sum
         FROM pos_bills b
         LEFT JOIN pos_bill_items bi ON bi.bill_id = b.id
         WHERE b.user_id = $1 AND b.status = 'paid'
           AND b.id = ANY($2::uuid[])
         GROUP BY b.id`,
        [userId, billIdsToVoid.filter(Boolean)],
      );
      let ok = true;
      for (const r of rows) {
        if (r.total !== r.items_sum) {
          ok = false;
          fail("12_bill_items_sum", `${r.bill_no}: total=${r.total} items=${r.items_sum}`);
        }
      }
      if (ok && rows.length) pass("12_bill_items_sum", `${rows.length} bills balanced`);
    }

    // cleanup: void test bills + cancel leftover test orders
    for (const billId of billIdsToVoid.filter(Boolean)) {
      await fetch(`${PROFIT}/api/pos/bills/${billId}/void`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ reason: "phase1 orphan-bill e2e cleanup" }),
      }).catch(() => {});
    }
    if (createdIds.length) {
      await db.query(
        `UPDATE pos_orders SET status = 'cancelled', cancel_reason = 'phase1-e2e-cleanup', updated_at = now()
         WHERE id = ANY($1::uuid[]) AND status NOT IN ('cancelled','completed') AND bill_id IS NULL`,
        [createdIds],
      );
    }
  } finally {
    await db.end();
  }

  printSummary();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log("\n── summary ──");
  console.log(`pass ${results.filter((r) => r.ok).length} / fail ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  × ${f.n}: ${f.d}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
