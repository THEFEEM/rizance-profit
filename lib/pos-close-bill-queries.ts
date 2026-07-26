import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { today } from "@/lib/date";
import { centsToDecimalString, sumDecimals, toCents } from "@/lib/money";
import { isPosPlanAllowed } from "@/lib/pos-config";
import { resolveActivePlan } from "@/lib/subscription-plan";
import { lockShopUser } from "@/lib/shop-profit-withdrawal-queries";
import { postPosBillJournal } from "@/lib/pos-posting-adapter";
import { resolveCartModifiers, type SelectedModifier } from "@/lib/pos-modifier-queries";
import { deductIngredientsForBill } from "@/lib/pos-ingredient-queries";
import type {
  ClosePosBillInput,
  ClosePosBillResult,
  PosBill,
  PosBillItem,
  PosPaymentMethod,
} from "@/types/pos";

/**
 * POS bills use cash|promptpay; shop income_entries only has cash|transfer
 * (on-hand buckets). PromptPay QR settles to the transfer bucket.
 */
export const POS_TO_INCOME_PAYMENT_METHOD: Record<PosPaymentMethod, "cash" | "transfer"> = {
  cash: "cash",
  promptpay: "transfer",
  thai_chuay_thai: "transfer",
};

export class PosPaymentMismatchError extends Error {
  constructor() {
    super("pos payments do not sum to bill total");
    this.name = "PosPaymentMismatchError";
  }
}

type UserSubRow = {
  subscription_plan: string;
  subscription_expires_at: Date | string | null;
};

type ProductRow = {
  id: string;
  name: string;
  sell_price: string;
  cost_price: string;
  stock_qty: string;
  track_stock: boolean;
};

type BillRow = {
  id: string;
  user_id: string;
  bill_no: string;
  status: string;
  total_amount: string;
  payment_method: string;
  entry_date: string;
  income_entry_id: string | null;
  created_at: Date | string;
};

type BillItemRow = {
  id: string;
  bill_id: string;
  product_id: string | null;
  product_name: string;
  unit_sell_price: string;
  unit_cost_price: string;
  quantity: string;
  line_total: string;
  line_cost: string;
  sort_order: number;
  note: string | null;
};

export class PosPlanRequiredError extends Error {
  constructor() {
    super("pos plan required");
    this.name = "PosPlanRequiredError";
  }
}

export class PosProductNotFoundError extends Error {
  constructor(public productIds: string[]) {
    super("pos product not found");
    this.name = "PosProductNotFoundError";
  }
}

export class PosEmptyCartError extends Error {
  constructor() {
    super("pos cart empty");
    this.name = "PosEmptyCartError";
  }
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapBill(r: BillRow): PosBill {
  return {
    id: r.id,
    userId: r.user_id,
    billNo: r.bill_no,
    status: r.status as PosBill["status"],
    totalAmount: r.total_amount,
    paymentMethod: r.payment_method as PosBill["paymentMethod"],
    entryDate: r.entry_date,
    incomeEntryId: r.income_entry_id,
    createdAt: toIso(r.created_at),
  };
}

function mapBillItem(r: BillItemRow): PosBillItem {
  return {
    id: r.id,
    billId: r.bill_id,
    productId: r.product_id,
    productName: r.product_name,
    unitSellPrice: r.unit_sell_price,
    unitCostPrice: r.unit_cost_price,
    quantity: r.quantity,
    lineTotal: r.line_total,
    lineCost: r.line_cost,
    sortOrder: r.sort_order,
    note: r.note,
  };
}

function formatBillNo(counterDate: string, seq: number): string {
  const ymd = counterDate.replace(/-/g, "");
  return `${ymd}-${String(seq).padStart(3, "0")}`;
}

function lineMoney(unitPrice: string, qty: number): string {
  const unitCents = toCents(unitPrice);
  const qtyScaled = Math.round(qty * 1000);
  const lineCents = Math.round((unitCents * qtyScaled) / 1000);
  return centsToDecimalString(lineCents);
}

async function assertPosSubscription(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<UserSubRow>(
    `SELECT subscription_plan, subscription_expires_at FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error("User not found");
  const plan = resolveActivePlan(row.subscription_plan, row.subscription_expires_at);
  if (!isPosPlanAllowed(plan)) {
    throw new PosPlanRequiredError();
  }
}

async function nextBillNo(
  client: PoolClient,
  userId: string,
  counterDate: string,
): Promise<string> {
  await client.query(
    `INSERT INTO pos_bill_counters (user_id, counter_date, last_seq)
     VALUES ($1, $2::date, 0)
     ON CONFLICT (user_id, counter_date) DO NOTHING`,
    [userId, counterDate],
  );

  const { rows: locked } = await client.query<{ last_seq: number }>(
    `SELECT last_seq FROM pos_bill_counters
     WHERE user_id = $1 AND counter_date = $2::date
     FOR UPDATE`,
    [userId, counterDate],
  );
  if (!locked[0]) throw new Error("pos bill counter missing");

  const { rows: updated } = await client.query<{ last_seq: number }>(
    `UPDATE pos_bill_counters
     SET last_seq = last_seq + 1
     WHERE user_id = $1 AND counter_date = $2::date
     RETURNING last_seq`,
    [userId, counterDate],
  );

  return formatBillNo(counterDate, updated[0].last_seq);
}

async function lockCartProducts(
  client: PoolClient,
  userId: string,
  productIds: string[],
): Promise<Map<string, ProductRow>> {
  const { rows } = await client.query<ProductRow>(
    `SELECT id, name, sell_price::text, cost_price::text, stock_qty::text, track_stock
     FROM pos_products
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_active = true
     ORDER BY id
     FOR UPDATE`,
    [userId, productIds],
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new PosProductNotFoundError(missing);
  }
  return byId;
}

/**
 * Atomic POS checkout: bill + items + stock + shop income_entries.
 * Rolls back entirely on any failure — client may retry with the same cart.
 */
export async function closePosBill(
  userId: string,
  input: ClosePosBillInput,
): Promise<ClosePosBillResult> {
  if (input.items.length === 0) {
    throw new PosEmptyCartError();
  }

  const entryDate = input.entryDate ?? today();
  const client = await pool.connect();
  const negativeStockProductIds: string[] = [];

  try {
    await client.query("BEGIN");

    await lockShopUser(client, userId);
    await assertPosSubscription(client, userId);

    const billNo = await nextBillNo(client, userId, entryDate);

    const productIds = input.items.map((i) => i.productId);
    const products = await lockCartProducts(client, userId, productIds);

    // Modifiers: validate ownership/rules, price resolved server-side only.
    const modifiersByLine = await resolveCartModifiers(client, userId, input.items);

    const computedLines = input.items.map((line, sortOrder) => {
      const product = products.get(line.productId)!;
      const selectedModifiers: SelectedModifier[] = modifiersByLine.get(sortOrder) ?? [];
      // Effective unit price = base + Σ delta (cents-safe). Stored in
      // unit_sell_price so SUM(line_total) = total_amount = journal — the
      // posting adapter stays untouched.
      const unitPriceCents =
        toCents(product.sell_price) +
        selectedModifiers.reduce((sum, m) => sum + toCents(m.priceDelta), 0);
      const unitSellPrice = centsToDecimalString(unitPriceCents);
      const lineTotal = lineMoney(unitSellPrice, line.qty);
      const lineCost = lineMoney(product.cost_price, line.qty);
      return { line, product, unitSellPrice, lineTotal, lineCost, sortOrder, selectedModifiers };
    });

    // ค่าบริการเพิ่ม (เช่น ค่าส่งเดลิเวอรี่) — เก็บเป็นบรรทัดในบิลที่ไม่มี product_id
    // เพื่อให้ SUM(bill_items.line_total) = total_amount = journal เสมอ
    const surchargeLines = (input.surcharges ?? [])
      .map((sc, i) => ({
        label: sc.label,
        lineTotal: centsToDecimalString(toCents(sc.amount)),
        sortOrder: computedLines.length + i,
      }))
      .filter((sc) => toCents(sc.lineTotal) > 0);

    const totalAmount = sumDecimals(
      ...computedLines.map((l) => l.lineTotal),
      ...surchargeLines.map((sc) => sc.lineTotal),
    );

    // Normalize payments: explicit split list, or legacy single method = full total.
    // Server re-validates the sum — client amounts are never trusted blindly.
    const payments: { method: PosPaymentMethod; amount: string }[] = input.payments?.length
      ? input.payments.map((p) => ({
          method: p.method,
          amount: centsToDecimalString(toCents(p.amount)),
        }))
      : [{ method: input.paymentMethod ?? "cash", amount: totalAmount }];

    const paymentsSumCents = payments.reduce((sum, p) => sum + toCents(p.amount), 0);
    if (paymentsSumCents !== toCents(totalAmount)) {
      throw new PosPaymentMismatchError();
    }

    const billMethod = payments.length === 1 ? payments[0].method : "split";

    const { rows: billRows } = await client.query<BillRow>(
      `INSERT INTO pos_bills
         (user_id, bill_no, status, total_amount, payment_method, entry_date)
       VALUES ($1, $2, 'paid', $3, $4, $5::date)
       RETURNING id, user_id, bill_no, status, total_amount::text, payment_method,
         entry_date::text, income_entry_id, created_at`,
      [userId, billNo, totalAmount, billMethod, entryDate],
    );
    const bill = billRows[0];

    const insertedItems: PosBillItem[] = [];

    for (const { line, product, unitSellPrice, lineTotal, lineCost, sortOrder, selectedModifiers } of computedLines) {
      const { rows: itemRows } = await client.query<BillItemRow>(
        `INSERT INTO pos_bill_items
           (bill_id, product_id, product_name, unit_sell_price, unit_cost_price,
            quantity, line_total, line_cost, sort_order, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, bill_id, product_id, product_name,
           unit_sell_price::text, unit_cost_price::text, quantity::text,
           line_total::text, line_cost::text, sort_order, note`,
        [
          bill.id,
          product.id,
          product.name,
          unitSellPrice,
          product.cost_price,
          line.qty,
          lineTotal,
          lineCost,
          sortOrder,
          line.note?.trim() || null,
        ],
      );
      const insertedItem = mapBillItem(itemRows[0]);

      // Snapshot selected modifiers (name + delta as-of sale) onto the line.
      for (let i = 0; i < selectedModifiers.length; i++) {
        const m = selectedModifiers[i];
        await client.query(
          `INSERT INTO pos_bill_item_modifiers
             (bill_item_id, modifier_id, modifier_name, price_delta, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [insertedItem.id, m.id, m.name, m.priceDelta, i],
        );
      }
      if (selectedModifiers.length > 0) {
        insertedItem.modifiers = selectedModifiers.map((m) => ({
          modifierName: m.name,
          priceDelta: m.priceDelta,
        }));
      }
      insertedItems.push(insertedItem);

      if (product.track_stock) {
        const qtyChange = -line.qty;

        await client.query(
          `INSERT INTO pos_stock_movements
             (user_id, product_id, bill_id, movement_type, qty_change)
           VALUES ($1, $2, $3, 'sale', $4)`,
          [userId, product.id, bill.id, qtyChange],
        );

        const { rows: stockRows } = await client.query<{ stock_qty: string }>(
          `UPDATE pos_products
           SET stock_qty = stock_qty + $3, updated_at = now()
           WHERE id = $1 AND user_id = $2
           RETURNING stock_qty::text`,
          [product.id, userId, qtyChange],
        );

        const newQty = stockRows[0]?.stock_qty;
        if (newQty != null && toCents(newQty) < 0) {
          negativeStockProductIds.push(product.id);
        }
      }
    }

    for (const sc of surchargeLines) {
      const { rows: scRows } = await client.query<BillItemRow>(
        `INSERT INTO pos_bill_items
           (bill_id, product_id, product_name, unit_sell_price, unit_cost_price,
            quantity, line_total, line_cost, sort_order, note)
         VALUES ($1, NULL, $2, $3, 0, 1, $3, 0, $4, NULL)
         RETURNING id, bill_id, product_id, product_name,
           unit_sell_price::text, unit_cost_price::text, quantity::text,
           line_total::text, line_cost::text, sort_order, note`,
        [bill.id, sc.label, sc.lineTotal, sc.sortOrder],
      );
      insertedItems.push(mapBillItem(scRows[0]));
    }

    // ตัดวัตถุดิบตามสูตร (สินค้า + modifier ที่เลือก) — ใน transaction เดียวกับบิล
    await deductIngredientsForBill(
      client,
      userId,
      bill.id,
      computedLines.map((l) => ({
        productId: l.product.id,
        qty: l.line.qty,
        modifierIds: l.selectedModifiers.map((m) => m.id),
      })),
    );

    // Income entries per bucket: cash → 'cash', promptpay/thai_chuay_thai → 'transfer'.
    // Split bills produce up to 2 entries so เงินสด/เงินโอน on-hand stay correct.
    let cashCents = 0;
    let transferCents = 0;
    for (const p of payments) {
      if (POS_TO_INCOME_PAYMENT_METHOD[p.method] === "cash") cashCents += toCents(p.amount);
      else transferCents += toCents(p.amount);
    }

    const incomeEntryByBucket: Partial<Record<"cash" | "transfer", string>> = {};
    for (const bucket of ["cash", "transfer"] as const) {
      const cents = bucket === "cash" ? cashCents : transferCents;
      if (cents <= 0) continue;
      const { rows: incomeRows } = await client.query<{ id: string }>(
        `INSERT INTO income_entries (user_id, amount, category, payment_method, note, entry_date)
         VALUES ($1, $2, 'storefront', $3, $4, $5::date)
         RETURNING id`,
        [userId, centsToDecimalString(cents), bucket, `POS ${billNo}`, entryDate],
      );
      incomeEntryByBucket[bucket] = incomeRows[0].id;
    }

    const primaryIncomeEntryId =
      incomeEntryByBucket.cash ?? incomeEntryByBucket.transfer ?? null;

    const insertedPayments = [];
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const bucket = POS_TO_INCOME_PAYMENT_METHOD[p.method];
      const { rows: payRows } = await client.query<{
        id: string;
        bill_id: string;
        method: PosPaymentMethod;
        amount: string;
        income_entry_id: string | null;
        sort_order: number;
      }>(
        `INSERT INTO pos_bill_payments (bill_id, method, amount, income_entry_id, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, bill_id, method, amount::text, income_entry_id, sort_order`,
        [bill.id, p.method, p.amount, incomeEntryByBucket[bucket] ?? null, i],
      );
      insertedPayments.push({
        id: payRows[0].id,
        billId: payRows[0].bill_id,
        method: payRows[0].method,
        amount: payRows[0].amount,
        incomeEntryId: payRows[0].income_entry_id,
        sortOrder: payRows[0].sort_order,
      });
    }

    const { rows: linkedBillRows } = await client.query<BillRow>(
      `UPDATE pos_bills
       SET income_entry_id = $3
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, bill_no, status, total_amount::text, payment_method,
         entry_date::text, income_entry_id, created_at`,
      [bill.id, userId, primaryIncomeEntryId],
    );

    const mappedBill = mapBill(linkedBillRows[0]);

    await postPosBillJournal(client, mappedBill, insertedItems, payments);

    await client.query("COMMIT");

    return {
      bill: mappedBill,
      items: insertedItems,
      payments: insertedPayments,
      negativeStockProductIds,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
