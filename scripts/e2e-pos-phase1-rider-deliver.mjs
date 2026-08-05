/**
 * Phase 1 checklist 20–21 — rider "ส่งถึงแล้ว" ผูกบิล + กันบิลกำพร้า
 *
 *   20. deliver → bill_id NOT NULL + status=completed + delivered_at set
 *   21. deliver บนออเดอร์ที่มีบิลแล้ว → 409 order_link_failed + ไม่เกิดบิลใหม่
 *
 * Usage: ALLOW_PROD_DB=1 node scripts/e2e-pos-phase1-rider-deliver.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT = process.env.PROFIT_URL || "http://localhost:3000";
const EMAIL = "ninenon2026@gmail.com";

const results = [];
const pass = (n, d = "") => {
  results.push({ n, ok: true, d });
  console.log(`PASS ${n}${d ? `: ${d}` : ""}`);
};
const fail = (n, d) => {
  results.push({ n, ok: false, d });
  console.log(`FAIL ${n}: ${d}`);
};

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
        )
          val = val.slice(1, -1);
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch {
      /* */
    }
  }
}

async function sessionCookie(userId) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return `rizance_session=${token}`;
}

async function patchOrder(cookie, orderId, body) {
  const res = await fetch(`${PROFIT}/api/pos/orders/${orderId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function riderAct(riderToken, orderId, action) {
  const res = await fetch(
    `${PROFIT}/api/public/rider/${riderToken}/orders/${orderId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function countPaidBills(db, userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id=$1 AND status='paid'`,
    [userId],
  );
  return r.rows[0].n;
}

async function createDeliveryOrder(db, userId, product, menuToken) {
  const res = await fetch(`${PROFIT}/api/public/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: menuToken,
      items: [{ productId: product.id, qty: 1 }],
      customerName: "phase1-rider",
      customerPhone: "0810000020",
      orderType: "delivery",
      deliveryAddress: "99 ทดสอบเฟส1 คนส่ง ส่งถึงแล้ว",
      paymentIntent: "at_shop",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 201 || !json?.data?.accessToken) {
    throw new Error(`create order failed: ${res.status} ${JSON.stringify(json)}`);
  }
  // public API ไม่คืน id — หาจาก access_token
  const { rows } = await db.query(
    `SELECT id, order_no, total_amount::text AS total_amount
     FROM pos_orders WHERE access_token = $1`,
    [json.data.accessToken],
  );
  if (!rows[0]) throw new Error("order created but not found by access_token");
  return {
    id: rows[0].id,
    orderNo: rows[0].order_no,
    totalAmount: rows[0].total_amount,
    via: "api",
  };
}

async function advanceToReady(cookie, orderId) {
  for (const status of ["accepted", "cooking", "ready"]) {
    const r = await patchOrder(cookie, orderId, { status });
    if (r.status !== 200) {
      // pending→accepted may need to start from current
      if (status === "accepted") {
        const again = await patchOrder(cookie, orderId, { status: "accepted" });
        if (again.status !== 200 && again.json?.error !== "invalid_transition") {
          return again;
        }
        continue;
      }
      return r;
    }
  }
  return { status: 200 };
}

async function main() {
  loadEnv();
  const db = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
  await db.connect();

  const created = [];
  const billsToVoid = [];

  try {
    const { rows: users } = await db.query(`SELECT id FROM users WHERE email=$1`, [
      EMAIL,
    ]);
    const userId = users[0].id;
    const cookie = await sessionCookie(userId);

    const { rows: riders } = await db.query(
      `SELECT id, name, access_token FROM pos_riders
       WHERE user_id=$1 AND is_active=true ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );
    if (!riders[0]) throw new Error("no active rider — create one in POS first");
    const rider = riders[0];
    pass("setup_rider", `${rider.name} …${rider.access_token.slice(-6)}`);

    const { rows: settings } = await db.query(
      `SELECT public_menu_token, delivery_enabled, delivery_fee::text, delivery_min_order::text
       FROM pos_shop_settings WHERE user_id=$1`,
      [userId],
    );
    if (!settings[0]?.delivery_enabled) {
      await fetch(`${PROFIT}/api/pos/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ deliveryEnabled: true, deliveryMinOrder: 0 }),
      });
    }
    const menuToken = settings[0].public_menu_token;

    const { rows: products } = await db.query(
      `SELECT id, name, sell_price::float8 AS sell_price
       FROM pos_products WHERE user_id=$1 AND is_active
       ORDER BY sort_order NULLS LAST, name LIMIT 1`,
      [userId],
    );
    const product = products[0];

    // ── ข้อ 20 ──
    {
      const order = await createDeliveryOrder(db, userId, product, menuToken);
      created.push(order.id);
      pass("20_order_created", `${order.orderNo} via=${order.via}`);

      const adv = await advanceToReady(cookie, order.id);
      if (adv.status !== 200) {
        fail("20_advance_ready", JSON.stringify(adv));
      } else {
        pass("20_advance_ready");
      }

      const claim = await riderAct(rider.access_token, order.id, "claim");
      if (claim.status !== 200) {
        fail("20_claim", JSON.stringify(claim));
      } else {
        pass("20_claim");
      }

      const before = await countPaidBills(db, userId);
      const deliver = await riderAct(rider.access_token, order.id, "deliver");
      if (deliver.status !== 200) {
        fail("20_deliver_http", JSON.stringify(deliver));
      } else {
        pass("20_deliver_http", JSON.stringify(deliver.json?.data));
      }

      const { rows } = await db.query(
        `SELECT bill_id, status, delivered_at FROM pos_orders WHERE id=$1`,
        [order.id],
      );
      const row = rows[0];
      if (row?.bill_id) {
        billsToVoid.push(row.bill_id);
        pass("20_bill_id_linked", row.bill_id);
      } else {
        fail("20_bill_id_linked", "bill_id is NULL");
      }
      if (row?.status === "completed") pass("20_status_completed");
      else fail("20_status_completed", `status=${row?.status}`);
      if (row?.delivered_at) pass("20_delivered_at", String(row.delivered_at));
      else fail("20_delivered_at", "delivered_at is NULL");

      const after = await countPaidBills(db, userId);
      if (after === before + 1) pass("20_bill_created", `${before}→${after}`);
      else fail("20_bill_created", `${before}→${after}`);
    }

    // ── ข้อ 21: ออเดอร์ที่มีบิลแล้ว → deliver ซ้ำต้อง 409 + ไม่เกิดบิลใหม่ ──
    {
      const order = await createDeliveryOrder(db, userId, product, menuToken);
      created.push(order.id);
      await advanceToReady(cookie, order.id);
      const claim = await riderAct(rider.access_token, order.id, "claim");
      if (claim.status !== 200) {
        fail("21_setup_claim", JSON.stringify(claim));
      }

      // ปิดบิลก่อน (จำลองร้านเก็บเงินไปแล้ว แต่สถานะยัง ready / คนส่งยังถืองาน)
      const { rows: items } = await db.query(
        `SELECT product_id, quantity::float8 AS qty, line_total::float8 AS line_total
         FROM pos_order_items WHERE order_id=$1 AND product_id IS NOT NULL`,
        [order.id],
      );
      const { rows: ord } = await db.query(
        `SELECT total_amount::float8 AS total, delivery_fee::float8 AS fee
         FROM pos_orders WHERE id=$1`,
        [order.id],
      );
      const total = Math.round(Number(ord[0].total) * 100) / 100;
      const fee = Number(ord[0].fee) || 0;

      const close = await fetch(`${PROFIT}/api/pos/bills`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          items: items.map((i) => ({
            productId: i.product_id,
            qty: i.qty,
          })),
          surcharges: fee > 0 ? [{ label: "ค่าส่งเดลิเวอรี่", amount: fee }] : undefined,
          payments: [{ method: "cash", amount: total }],
          linkOrderId: order.id,
        }),
      });
      const closeJson = await close.json().catch(() => ({}));
      if (close.status !== 201) {
        fail("21_setup_prebill", `${close.status} ${JSON.stringify(closeJson)}`);
      } else {
        billsToVoid.push(closeJson.data.bill.id);
        pass("21_setup_prebill", closeJson.data.bill.billNo);
      }

      // ยืนยันยัง ready + มี bill
      const pre = await db.query(
        `SELECT status, bill_id FROM pos_orders WHERE id=$1`,
        [order.id],
      );
      if (pre.rows[0]?.status !== "ready" || !pre.rows[0]?.bill_id) {
        fail("21_setup_state", JSON.stringify(pre.rows[0]));
      } else {
        pass("21_setup_state", "ready + bill_id set");
      }

      const beforePaid = await countPaidBills(db, userId);
      const beforeAll = (
        await db.query(`SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id=$1`, [
          userId,
        ])
      ).rows[0].n;
      const t0 = new Date(Date.now() - 1000);

      const deliver = await riderAct(rider.access_token, order.id, "deliver");

      const afterPaid = await countPaidBills(db, userId);
      const afterAll = (
        await db.query(`SELECT COUNT(*)::int AS n FROM pos_bills WHERE user_id=$1`, [
          userId,
        ])
      ).rows[0].n;
      const newBills = await db.query(
        `SELECT id, bill_no FROM pos_bills
         WHERE user_id=$1 AND created_at >= $2 AND id <> $3
         ORDER BY created_at DESC`,
        [userId, t0, closeJson?.data?.bill?.id ?? "00000000-0000-0000-0000-000000000000"],
      );

      if (deliver.status === 409 && deliver.json?.error === "order_link_failed") {
        pass("21_http_409", "order_link_failed");
      } else {
        fail("21_http_409", `status=${deliver.status} body=${JSON.stringify(deliver.json)}`);
      }

      if (
        afterPaid === beforePaid &&
        afterAll === beforeAll &&
        newBills.rowCount === 0
      ) {
        pass(
          "21_no_new_bill",
          `ROLLBACK · paid=${afterPaid} all=${afterAll} new=${newBills.rowCount}`,
        );
      } else {
        fail(
          "21_no_new_bill",
          `paid ${beforePaid}→${afterPaid} all ${beforeAll}→${afterAll} new=${JSON.stringify(newBills.rows)}`,
        );
      }

      // ออเดอร์ยังไม่ถูก completed โดย deliver ที่ล้ม
      const post = await db.query(
        `SELECT status, bill_id, delivered_at FROM pos_orders WHERE id=$1`,
        [order.id],
      );
      if (post.rows[0]?.status === "ready" && post.rows[0]?.delivered_at == null) {
        pass("21_order_unchanged", "still ready · delivered_at NULL");
      } else {
        fail("21_order_unchanged", JSON.stringify(post.rows[0]));
      }
    }

    // cleanup: void test bills + delete test orders
    for (const billId of billsToVoid.filter(Boolean)) {
      await fetch(`${PROFIT}/api/pos/bills/${billId}/void`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ reason: "phase1 rider-deliver e2e cleanup" }),
      }).catch(() => {});
    }
    if (created.length) {
      await db.query(
        `DELETE FROM pos_orders
         WHERE id = ANY($1::uuid[])
           AND (customer_name = 'phase1-rider' OR order_no LIKE 'ZZ-R20-%')`,
        [created],
      );
    }
  } finally {
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n── summary ──");
  console.log(`pass ${results.filter((r) => r.ok).length} / fail ${failed.length}`);
  for (const f of failed) console.log(`  × ${f.n}: ${f.d}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
