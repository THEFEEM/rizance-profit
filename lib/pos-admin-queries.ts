import { pool } from "@/lib/db";

/**
 * Test-data wipe — pre-launch only.
 * Removes ALL POS transaction data for one shop in a single transaction:
 * journal (source_module='pos'), pos-linked income entries, stock movements,
 * QR orders, bills (+items/modifiers/payments via cascade), daily counters.
 * Master data survives: products, categories, modifiers, settings.
 *
 * Hard guard: refuses when pos_shop_settings.live_at IS NOT NULL.
 */

export class ShopIsLiveError extends Error {
  constructor() {
    super("shop already live — wipe refused");
    this.name = "ShopIsLiveError";
  }
}

export type WipeResult = {
  bills: number;
  orders: number;
  incomeEntries: number;
  journalEntries: number;
  stockMovements: number;
};

export async function wipePosTestData(userId: string): Promise<WipeResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Guard inside the transaction (row-locked) — not just a UI hide.
    const { rows: settings } = await client.query<{ live_at: Date | null }>(
      `SELECT live_at FROM pos_shop_settings WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (settings[0]?.live_at) {
      throw new ShopIsLiveError();
    }

    // 1) journal ทั้งหมดที่มาจาก POS ของร้านนี้ (ขาปิดบิล + ขา void)
    const { rowCount: journalLines } = await client.query(
      `DELETE FROM journal_lines
       WHERE entry_id IN (
         SELECT id FROM journal_entries
         WHERE user_id = $1 AND source_module = 'pos')`,
      [userId],
    );
    void journalLines;
    const { rowCount: journalEntries } = await client.query(
      `DELETE FROM journal_entries WHERE user_id = $1 AND source_module = 'pos'`,
      [userId],
    );

    // 2) income entries ที่บิล/payments อ้างถึง (ลบก่อนบิล — FK เป็น SET NULL)
    const { rowCount: incomeEntries } = await client.query(
      `DELETE FROM income_entries
       WHERE id IN (
         SELECT b.income_entry_id FROM pos_bills b
         WHERE b.user_id = $1 AND b.income_entry_id IS NOT NULL
         UNION
         SELECT p.income_entry_id FROM pos_bill_payments p
         JOIN pos_bills b ON b.id = p.bill_id
         WHERE b.user_id = $1 AND p.income_entry_id IS NOT NULL)`,
      [userId],
    );

    // 3) stock movements ทั้งหมดของร้าน (ช่วงเทสล้วน)
    const { rowCount: stockMovements } = await client.query(
      `DELETE FROM pos_stock_movements WHERE user_id = $1`,
      [userId],
    );

    // 4) ออเดอร์ QR ทั้งหมด (items/modifiers ลบตาม cascade)
    const { rowCount: orders } = await client.query(
      `DELETE FROM pos_orders WHERE user_id = $1`,
      [userId],
    );

    // 5) บิลทั้งหมด (items/item_modifiers/payments ลบตาม cascade)
    const { rowCount: bills } = await client.query(
      `DELETE FROM pos_bills WHERE user_id = $1`,
      [userId],
    );

    // 6) รีเซ็ตเลขรันทุกวัน
    await client.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM pos_order_counters WHERE user_id = $1`, [userId]);

    await client.query("COMMIT");

    return {
      bills: bills ?? 0,
      orders: orders ?? 0,
      incomeEntries: incomeEntries ?? 0,
      journalEntries: journalEntries ?? 0,
      stockMovements: stockMovements ?? 0,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
