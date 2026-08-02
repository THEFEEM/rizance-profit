import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { businessDate, businessDateAt } from "@/lib/date";
import { isPosPlanAllowed } from "@/lib/pos-config";
import { lockShopUser } from "@/lib/shop-profit-withdrawal-queries";
import { voidPosBillJournal } from "@/lib/pos-posting-adapter";
import { restoreIngredientsForVoidedBill } from "@/lib/pos-ingredient-queries";
import { resolveActivePlan } from "@/lib/subscription-plan";
import { PosPlanRequiredError } from "@/lib/pos-close-bill-queries";
import type {
  PosBillDetail,
  PosBillItem,
  PosBillListItem,
  PosPaymentMethod,
  VoidPosBillResult,
} from "@/types/pos";

type UserSubRow = {
  subscription_plan: string;
  subscription_expires_at: Date | string | null;
};

type BillLockRow = {
  id: string;
  user_id: string;
  bill_no: string;
  status: string;
  total_amount: string;
  payment_method: string;
  entry_date: string;
  income_entry_id: string | null;
  created_at: Date | string;
  voided_at: Date | string | null;
  void_reason: string | null;
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

type BillItemWithStockRow = BillItemRow & {
  track_stock: boolean | null;
};

type BillListRow = {
  id: string;
  bill_no: string;
  status: string;
  total_amount: string;
  payment_method: string;
  created_at: Date | string;
  voided_at: Date | string | null;
  item_count: number;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
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

function mapBillDetail(r: BillLockRow, items: PosBillItem[]): PosBillDetail {
  return {
    id: r.id,
    userId: r.user_id,
    billNo: r.bill_no,
    status: r.status as PosBillDetail["status"],
    totalAmount: r.total_amount,
    paymentMethod: r.payment_method as PosBillDetail["paymentMethod"],
    entryDate: r.entry_date,
    incomeEntryId: r.income_entry_id,
    createdAt: toIso(r.created_at)!,
    voidedAt: toIso(r.voided_at),
    voidReason: r.void_reason,
    items,
  };
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

export class PosBillNotFoundError extends Error {
  constructor() {
    super("pos bill not found");
    this.name = "PosBillNotFoundError";
  }
}

export class PosBillNotVoidableError extends Error {
  constructor() {
    super("pos bill not voidable");
    this.name = "PosBillNotVoidableError";
  }
}

export class PosVoidWindowExpiredError extends Error {
  constructor() {
    super("pos void window expired");
    this.name = "PosVoidWindowExpiredError";
  }
}

const BILL_RETURN = `id, user_id, bill_no, status, total_amount::text, payment_method,
  entry_date::text, income_entry_id, created_at, voided_at, void_reason`;

const ITEM_RETURN = `id, bill_id, product_id, product_name,
  unit_sell_price::text, unit_cost_price::text, quantity::text,
  line_total::text, line_cost::text, sort_order, note`;

export async function listPosBillsByDate(
  userId: string,
  entryDate: string,
): Promise<PosBillListItem[]> {
  const { rows } = await pool.query<BillListRow>(
    `SELECT b.id, b.bill_no, b.status, b.total_amount::text, b.payment_method,
            b.created_at, b.voided_at,
            (SELECT COUNT(*)::int FROM pos_bill_items bi WHERE bi.bill_id = b.id) AS item_count
     FROM pos_bills b
     WHERE b.user_id = $1 AND b.entry_date = $2::date
     ORDER BY b.created_at DESC`,
    [userId, entryDate],
  );

  return rows.map((r) => ({
    id: r.id,
    billNo: r.bill_no,
    status: r.status as PosBillListItem["status"],
    total: r.total_amount,
    paymentMethod: r.payment_method as PosBillListItem["paymentMethod"],
    paidAt: toIso(r.created_at)!,
    voidedAt: toIso(r.voided_at),
    itemCount: r.item_count,
  }));
}

export async function getPosBillDetail(
  userId: string,
  billId: string,
): Promise<PosBillDetail | null> {
  const { rows: billRows } = await pool.query<BillLockRow>(
    `SELECT ${BILL_RETURN}
     FROM pos_bills
     WHERE id = $1 AND user_id = $2`,
    [billId, userId],
  );
  if (!billRows[0]) return null;

  const [{ rows: itemRows }, { rows: modifierRows }, { rows: paymentRows }] = await Promise.all([
    pool.query<BillItemRow>(
      `SELECT ${ITEM_RETURN}
       FROM pos_bill_items
       WHERE bill_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [billId],
    ),
    pool.query<{ bill_item_id: string; modifier_name: string; price_delta: string }>(
      `SELECT bim.bill_item_id, bim.modifier_name, bim.price_delta::text AS price_delta
       FROM pos_bill_item_modifiers bim
       JOIN pos_bill_items bi ON bi.id = bim.bill_item_id
       WHERE bi.bill_id = $1
       ORDER BY bim.sort_order ASC`,
      [billId],
    ),
    pool.query<{
      id: string;
      bill_id: string;
      method: string;
      amount: string;
      income_entry_id: string | null;
      sort_order: number;
    }>(
      `SELECT id, bill_id, method, amount::text, income_entry_id, sort_order
       FROM pos_bill_payments
       WHERE bill_id = $1
       ORDER BY sort_order ASC`,
      [billId],
    ),
  ]);

  const modifiersByItem = new Map<string, { modifierName: string; priceDelta: string }[]>();
  for (const r of modifierRows) {
    const arr = modifiersByItem.get(r.bill_item_id) ?? [];
    arr.push({ modifierName: r.modifier_name, priceDelta: r.price_delta });
    modifiersByItem.set(r.bill_item_id, arr);
  }

  const items = itemRows.map((r) => {
    const item = mapBillItem(r);
    const mods = modifiersByItem.get(r.id);
    return mods?.length ? { ...item, modifiers: mods } : item;
  });

  const detail = mapBillDetail(billRows[0], items);
  if (paymentRows.length > 0) {
    detail.payments = paymentRows.map((r) => ({
      id: r.id,
      billId: r.bill_id,
      method: r.method as PosPaymentMethod,
      amount: r.amount,
      incomeEntryId: r.income_entry_id,
      sortOrder: r.sort_order,
    }));
  }
  return detail;
}

/**
 * Void a paid POS bill: restore stock, soft-void linked income, mark bill voided.
 */
export async function voidPosBill(
  userId: string,
  billId: string,
  reason: string,
): Promise<VoidPosBillResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await lockShopUser(client, userId);
    await assertPosSubscription(client, userId);

    const { rows: billRows } = await client.query<BillLockRow>(
      `SELECT ${BILL_RETURN}
       FROM pos_bills
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [billId, userId],
    );
    const bill = billRows[0];
    if (!bill) {
      throw new PosBillNotFoundError();
    }
    if (bill.status !== "paid") {
      throw new PosBillNotVoidableError();
    }

    // หน้าต่างยกเลิก = "วันขายเดียวกัน" ไม่ใช่วันปฏิทินเดียวกัน
    // เดิม: บิลที่ปิด 00:30 จะยกเลิกได้แค่ถึงเที่ยงคืนถัดไป ทั้งที่กะยังไม่จบ
    // ตอนนี้: ร้านที่ตั้ง cutoff 03:00 ยกเลิกบิลของกะเดียวกันได้จนกะปิดจริง
    const cutoff = await getDayCutoffHour(userId, client);
    const paidInstant =
      bill.created_at instanceof Date ? bill.created_at : new Date(bill.created_at);
    if (businessDateAt(paidInstant, cutoff) !== businessDate(cutoff)) {
      throw new PosVoidWindowExpiredError();
    }

    const { rows: itemRows } = await client.query<BillItemWithStockRow>(
      `SELECT bi.id, bi.bill_id, bi.product_id, bi.product_name,
              bi.unit_sell_price::text, bi.unit_cost_price::text, bi.quantity::text,
              bi.line_total::text, bi.line_cost::text, bi.sort_order, bi.note,
              p.track_stock
       FROM pos_bill_items bi
       LEFT JOIN pos_products p ON p.id = bi.product_id AND p.user_id = $2
       WHERE bi.bill_id = $1
       ORDER BY bi.sort_order ASC, bi.id ASC`,
      [billId, userId],
    );

    for (const item of itemRows) {
      if (!item.product_id || item.track_stock !== true) continue;

      const qty = parseFloat(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      await client.query(
        `INSERT INTO pos_stock_movements
           (user_id, product_id, bill_id, movement_type, qty_change)
         VALUES ($1, $2, $3, 'void_return', $4)`,
        [userId, item.product_id, billId, qty],
      );

      await client.query(
        `UPDATE pos_products
         SET stock_qty = stock_qty + $3, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [item.product_id, userId, qty],
      );
    }

    // คืนวัตถุดิบตามที่ตัดไปจริง (อ่านจาก movement 'sale' ของบิลนี้)
    await restoreIngredientsForVoidedBill(client, userId, billId);

    // Soft-void every linked income entry — split bills may have booked into
    // both cash and transfer buckets (pos_bill_payments.income_entry_id).
    const { rows: paymentEntryRows } = await client.query<{ income_entry_id: string }>(
      `SELECT DISTINCT income_entry_id
       FROM pos_bill_payments
       WHERE bill_id = $1 AND income_entry_id IS NOT NULL`,
      [billId],
    );
    const incomeEntryIds = new Set<string>(paymentEntryRows.map((r) => r.income_entry_id));
    if (bill.income_entry_id) incomeEntryIds.add(bill.income_entry_id);

    for (const incomeEntryId of incomeEntryIds) {
      const { rowCount } = await client.query(
        `UPDATE income_entries
         SET voided_at = now(), void_reason = $3
         WHERE id = $1 AND user_id = $2 AND voided_at IS NULL`,
        [incomeEntryId, userId, reason],
      );
      if ((rowCount ?? 0) === 0) {
        throw new PosBillNotVoidableError();
      }
    }

    await voidPosBillJournal(client, { id: bill.id, billNo: bill.bill_no });

    await client.query(
      `UPDATE pos_bills
       SET status = 'voided', voided_at = now(), void_reason = $3
       WHERE id = $1 AND user_id = $2`,
      [billId, userId, reason],
    );

    await client.query("COMMIT");

    return { billId, status: "voided" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
