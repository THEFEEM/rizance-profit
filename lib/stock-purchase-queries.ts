import { pool } from "@/lib/db";
import { businessDate } from "@/lib/date";
import { centsToDecimalString, toCents } from "@/lib/money";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import {
  INGREDIENT_RETURN,
  PosIngredientNotFoundError,
  applyReceiveLine,
  type IngredientRow,
} from "@/lib/pos-ingredient-queries";

/**
 * เอกสารการซื้อ + หน่วยบรรจุ (0085)
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) ไม่มีเครื่องยนต์รับของชุดที่สอง — เรียก applyReceiveLine() ตัวเดียวกับ
 *    โหมดไปตลาด ค่าเฉลี่ยถ่วงน้ำหนักจึงเป็นสูตรเดียวกันเป๊ะ
 * 2) หน่วยบรรจุแปลงให้เสร็จ "ก่อน" เข้าเครื่องยนต์ — ชั้นล่างเห็นแต่หน่วยสต็อก
 * 3) กันรับซ้ำด้วย unique index บน (user_id, idempotency_key) ไม่ใช่ปุ่ม disable
 * 4) วันที่ใช้ businessDate(cutoff) — ซื้อของตีสองยังนับเป็นวันทำการที่แล้ว
 * 5) เอกสารที่ received แล้ว = แก้ไม่ได้ ถ้าผิดให้ใช้การตรวจนับ
 */

// ═══ หน่วยบรรจุ ═══════════════════════════════════════════════

export type PurchaseUnitOption = {
  id: string | null;
  unitName: string;
  /** 1 หน่วยนี้ = กี่หน่วยสต็อก */
  conversionFactor: number;
  isDefault: boolean;
  /** true = หน่วยสต็อกเอง (ตัวคูณ 1) ไม่มีแถวใน DB */
  isBase: boolean;
};

export class PurchaseUnitNotFoundError extends Error {}
export class PurchaseNotFoundError extends Error {}
export class PurchaseImmutableError extends Error {}

/**
 * หน่วยที่ซื้อได้ของวัตถุดิบตัวหนึ่ง
 * หน่วยสต็อกอยู่ในลิสต์เสมอ (ตัวคูณ 1) โดยไม่ต้องมีแถวใน DB
 */
export async function listPurchaseUnits(
  userId: string,
  ingredientId: string,
): Promise<{ stockUnit: string; units: PurchaseUnitOption[] }> {
  const { rows: ing } = await pool.query<{ purchase_unit: string }>(
    `SELECT purchase_unit FROM ingredients WHERE id = $2 AND user_id = $1`,
    [userId, ingredientId],
  );
  if (!ing[0]) throw new PosIngredientNotFoundError();
  const stockUnit = ing[0].purchase_unit;

  const { rows } = await pool.query<{
    id: string; unit_name: string; conversion_factor: string; is_default: boolean;
  }>(
    `SELECT id, unit_name, conversion_factor::text AS conversion_factor, is_default
     FROM ingredient_purchase_units
     WHERE user_id = $1 AND ingredient_id = $2 AND is_active
     ORDER BY is_default DESC, conversion_factor ASC`,
    [userId, ingredientId],
  );

  const packs: PurchaseUnitOption[] = rows.map((r) => ({
    id: r.id,
    unitName: r.unit_name,
    conversionFactor: Number(r.conversion_factor),
    isDefault: r.is_default,
    isBase: false,
  }));
  const base: PurchaseUnitOption = {
    id: null,
    unitName: stockUnit,
    conversionFactor: 1,
    // ถ้ายังไม่มีหีบห่อไหนเป็น default ให้หน่วยสต็อกเป็นค่าตั้งต้น
    isDefault: !packs.some((p) => p.isDefault),
    isBase: true,
  };
  return { stockUnit, units: [...packs, base] };
}

export async function upsertPurchaseUnit(
  userId: string,
  input: {
    id?: string;
    ingredientId: string;
    unitName: string;
    conversionFactor: number;
    isDefault?: boolean;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // ปลด default เดิมก่อน ไม่งั้นชน partial unique index
    if (input.isDefault) {
      await client.query(
        `UPDATE ingredient_purchase_units SET is_default = false, updated_at = now()
         WHERE user_id = $1 AND ingredient_id = $2 AND is_default
           AND ($3::uuid IS NULL OR id <> $3)`,
        [userId, input.ingredientId, input.id ?? null],
      );
    }
    if (input.id) {
      const { rowCount } = await client.query(
        `UPDATE ingredient_purchase_units
         SET unit_name = $3, conversion_factor = $4, is_default = $5, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [input.id, userId, input.unitName.trim(), input.conversionFactor, input.isDefault ?? false],
      );
      if ((rowCount ?? 0) === 0) throw new PurchaseUnitNotFoundError();
    } else {
      await client.query(
        `INSERT INTO ingredient_purchase_units
           (user_id, ingredient_id, unit_name, conversion_factor, is_default)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ingredient_id, unit_name) DO UPDATE
           SET conversion_factor = EXCLUDED.conversion_factor,
               is_default = EXCLUDED.is_default,
               is_active = true,
               updated_at = now()`,
        [userId, input.ingredientId, input.unitName.trim(), input.conversionFactor, input.isDefault ?? false],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** ปิดใช้งาน (ไม่ลบ — เอกสารเก่าอ้างชื่อหน่วยไว้แบบ snapshot อยู่แล้ว) */
export async function deactivatePurchaseUnit(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE ingredient_purchase_units
     SET is_active = false, is_default = false, updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

// ═══ รับของเข้าคลัง ═════════════════════════════════════════════

export type PurchaseLineInput = {
  ingredientId: string;
  /** จำนวนตามหน่วยที่ซื้อ เช่น 3 (แพ็ค) */
  purchaseQuantity: number;
  /** ชื่อหน่วยที่ซื้อ — ถ้าไม่ส่งจะใช้หน่วย default ของวัตถุดิบ */
  purchaseUnitName?: string;
  /** ราคารวมของบรรทัดนี้ (ไม่ใส่ = ไม่รู้ราคา ยังรับของได้) */
  totalPrice?: number;
};

export type ReceivePurchaseInput = {
  supplierName?: string | null;
  invoiceNo?: string | null;
  note?: string | null;
  paymentMethod?: "cash" | "transfer";
  discount?: number;
  lines: PurchaseLineInput[];
  /** ของนอกลิสต์ที่ไม่ตัดสต็อก เช่น ถุงกระดาษ — ลงเป็นรายจ่ายอย่างเดียว */
  extraItems?: { label: string; amount: number }[];
  /** บังคับ — กันรับซ้ำตอนเน็ตหลุด */
  idempotencyKey: string;
  createdBy?: string | null;
};

export type PurchaseItemView = {
  id: string;
  ingredientId: string | null;
  ingredientName: string;
  purchaseQuantity: string;
  purchaseUnitName: string;
  conversionFactor: string;
  stockQuantity: string;
  stockUnit: string;
  unitPrice: string;
  totalPrice: string;
  costPerStockUnit: string;
  qtyBefore: string | null;
  qtyAfter: string | null;
};

export type PurchaseView = {
  id: string;
  documentNo: string;
  supplierName: string | null;
  invoiceNo: string | null;
  businessDate: string;
  subtotal: string;
  discount: string;
  total: string;
  status: "draft" | "received" | "cancelled";
  paymentMethod: string;
  note: string | null;
  expenseEntryId: string | null;
  itemCount: number;
  receivedAt: string | null;
  createdAt: string;
};

/** เลขเอกสาร PUR-YYYY-NNNN — ต่อเนื่องต่อร้านต่อปี */
async function nextDocumentNo(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: { n: number }[] }> },
  userId: string,
  year: number,
): Promise<string> {
  const prefix = `PUR-${year}-`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(document_no, '^.*-', ''), '')::int), 0) + 1 AS n
     FROM stock_purchases
     WHERE user_id = $1 AND document_no LIKE $2`,
    [userId, `${prefix}%`],
  );
  return `${prefix}${String(rows[0]?.n ?? 1).padStart(4, "0")}`;
}

/**
 * รับของเข้าคลัง — Purchase → Items → Conversion → Stock → Cost → Expense
 * ทั้งหมดใน transaction เดียว ล้มที่ไหน rollback หมด
 *
 * เรียกซ้ำด้วย idempotencyKey เดิม = คืนเอกสารเดิม ไม่เพิ่มสต็อก ไม่เพิ่มรายจ่าย
 */
export async function receivePurchase(
  userId: string,
  input: ReceivePurchaseInput,
): Promise<{ purchase: PurchaseView; items: PurchaseItemView[]; reused: boolean }> {
  const key = input.idempotencyKey?.trim();
  if (!key) throw new Error("idempotency_key_required");

  // retry หลัง timeout — ของถูกรับไปแล้ว คืนผลเดิม
  const existing = await findByIdempotencyKey(userId, key);
  if (existing) return { ...existing, reused: true };

  const bizDate = businessDate(await getDayCutoffHour(userId));
  const lines = input.lines.filter((l) => l.purchaseQuantity > 0);
  if (lines.length === 0) throw new Error("no_lines");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ล็อกทุกแถวที่จะแตะ เรียง id กัน deadlock (แบบเดียวกับโหมดไปตลาด)
    const ids = [...new Set(lines.map((l) => l.ingredientId))].sort();
    const { rows: locked } = await client.query<IngredientRow>(
      `SELECT ${INGREDIENT_RETURN} FROM ingredients
       WHERE user_id = $1 AND id = ANY($2::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [userId, ids],
    );
    if (locked.length !== ids.length) throw new PosIngredientNotFoundError();
    const byId = new Map(locked.map((r) => [r.id, r]));

    // หน่วยบรรจุของทุกตัวที่เกี่ยวข้อง (query เดียว)
    const { rows: unitRows } = await client.query<{
      ingredient_id: string; unit_name: string; conversion_factor: string; is_default: boolean;
    }>(
      `SELECT ingredient_id, unit_name, conversion_factor::text AS conversion_factor, is_default
       FROM ingredient_purchase_units
       WHERE user_id = $1 AND ingredient_id = ANY($2::uuid[]) AND is_active`,
      [userId, ids],
    );

    // ── แปลงหน่วย + คิดเงิน (สตางค์-safe) ──
    type Prepared = {
      row: IngredientRow;
      unitName: string;
      factor: number;
      stockQty: number;
      totalCents: number;
    };
    const prepared: Prepared[] = [];
    let subtotalCents = 0;

    for (const line of lines) {
      const row = byId.get(line.ingredientId)!;
      const mine = unitRows.filter((u) => u.ingredient_id === line.ingredientId);
      const wanted = line.purchaseUnitName?.trim();

      let unitName: string;
      let factor: number;
      if (!wanted || wanted === row.purchase_unit) {
        // ซื้อเป็นหน่วยสต็อกตรง ๆ
        unitName = row.purchase_unit;
        factor = 1;
      } else {
        const found = mine.find((u) => u.unit_name === wanted);
        if (!found) throw new PurchaseUnitNotFoundError();
        unitName = found.unit_name;
        factor = Number(found.conversion_factor);
      }
      if (!Number.isFinite(factor) || factor <= 0) throw new PurchaseUnitNotFoundError();

      const stockQty = Number((line.purchaseQuantity * factor).toFixed(4));
      const totalCents = line.totalPrice ? toCents(line.totalPrice) : 0;
      subtotalCents += totalCents;
      prepared.push({ row, unitName, factor, stockQty, totalCents });
    }
    for (const e of input.extraItems ?? []) subtotalCents += toCents(e.amount);

    const discountCents = Math.min(input.discount ? toCents(input.discount) : 0, subtotalCents);
    const totalCents = subtotalCents - discountCents;

    // ── 1) หัวเอกสาร ──
    const year = Number(bizDate.slice(0, 4));
    let purchaseId = "";
    let documentNo = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      documentNo = await nextDocumentNo(client, userId, year);
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO stock_purchases
             (user_id, document_no, supplier_name, invoice_no, business_date,
              subtotal, discount, total, status, payment_method, idempotency_key,
              note, created_by, received_at)
           VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,'received',$9,$10,$11,$12,now())
           RETURNING id`,
          [
            userId,
            documentNo,
            input.supplierName?.trim() || null,
            input.invoiceNo?.trim() || null,
            bizDate,
            centsToDecimalString(subtotalCents),
            centsToDecimalString(discountCents),
            centsToDecimalString(totalCents),
            input.paymentMethod ?? "cash",
            key,
            input.note?.trim() || null,
            input.createdBy ?? null,
          ],
        );
        purchaseId = rows[0].id;
        break;
      } catch (err) {
        const code = (err as { code?: string }).code;
        const detail = String((err as { constraint?: string }).constraint ?? "");
        // เลขเอกสารชนเพราะมีคนกดพร้อมกัน → ขอเลขใหม่
        if (code === "23505" && detail.includes("doc")) continue;
        // idempotency key ชน = อีก request หนึ่งทำสำเร็จไปแล้ว
        if (code === "23505") {
          await client.query("ROLLBACK");
          const done = await findByIdempotencyKey(userId, key);
          if (done) return { ...done, reused: true };
        }
        throw err;
      }
    }
    if (!purchaseId) throw new Error("document_no_exhausted");

    // ── 2) รายจ่าย 1 ใบต่อ 1 เอกสาร ──
    let expenseEntryId: string | null = null;
    if (totalCents > 0) {
      const label =
        input.note?.trim() ||
        `ซื้อวัตถุดิบ ${documentNo}` +
          (input.supplierName?.trim() ? ` · ${input.supplierName.trim()}` : "");
      const { rows: exp } = await client.query<{ id: string }>(
        `INSERT INTO expense_entries
           (user_id, amount, category, payment_method, note, entry_date, purchase_id)
         VALUES ($1, $2, 'materials', $3, $4, $5::date, $6)
         RETURNING id`,
        [
          userId,
          centsToDecimalString(totalCents),
          input.paymentMethod ?? "cash",
          label.slice(0, 255),
          bizDate,
          purchaseId,
        ],
      );
      expenseEntryId = exp[0].id;

      // ประตูกันโพสต์ซ้ำ — แบบเดียวกับ payroll
      const { rowCount } = await client.query(
        `UPDATE stock_purchases SET expense_entry_id = $3
         WHERE id = $1 AND user_id = $2 AND expense_entry_id IS NULL`,
        [purchaseId, userId, expenseEntryId],
      );
      if ((rowCount ?? 0) === 0) throw new Error("purchase_already_posted");
    }

    // ── 3) รายการ + เข้าสต็อก ──
    for (const p of prepared) {
      const res = await applyReceiveLine(client, userId, p.row, {
        qtyIn: p.stockQty,
        lineCost: p.totalCents > 0 ? p.totalCents / 100 : null,
        expenseEntryId,
        purchaseId,
        note: `${documentNo} · ${p.row.name}`,
      });

      const purchaseQty = p.stockQty / p.factor;
      await client.query(
        `INSERT INTO stock_purchase_items
           (user_id, purchase_id, ingredient_id, ingredient_name,
            purchase_quantity, purchase_unit_name, conversion_factor,
            stock_quantity, stock_unit, unit_price, total_price, cost_per_stock_unit,
            qty_before, qty_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          userId,
          purchaseId,
          p.row.id,
          p.row.name,
          purchaseQty,
          p.unitName,
          p.factor,
          p.stockQty,
          p.row.purchase_unit,
          // ราคาต่อ 1 หน่วยที่ซื้อ (เช่น ต่อแพ็ค)
          p.totalCents > 0 ? (p.totalCents / 100 / purchaseQty).toFixed(4) : "0",
          centsToDecimalString(p.totalCents),
          res.unitCost == null ? "0" : res.unitCost.toFixed(4),
          res.qtyBefore.toFixed(4),
          res.qtyAfter.toFixed(4),
        ],
      );

      // จำ supplier ล่าสุดของวัตถุดิบตัวนี้
      if (input.supplierName?.trim()) {
        await client.query(
          `UPDATE ingredients SET supplier_name = $3, updated_at = now()
           WHERE id = $1 AND user_id = $2`,
          [p.row.id, userId, input.supplierName.trim().slice(0, 120)],
        );
      }
    }

    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
       VALUES ($1, 'owner', $2, 'purchase_received', $3)`,
      [
        userId,
        input.createdBy ?? null,
        JSON.stringify({
          purchaseId, documentNo, lines: prepared.length,
          total: centsToDecimalString(totalCents), businessDate: bizDate,
        }),
      ],
    );

    await client.query("COMMIT");
    const done = await getPurchase(userId, purchaseId);
    if (!done) throw new PurchaseNotFoundError();
    return { ...done, reused: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function findByIdempotencyKey(
  userId: string,
  key: string,
): Promise<{ purchase: PurchaseView; items: PurchaseItemView[] } | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM stock_purchases WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key],
  );
  if (!rows[0]) return null;
  return getPurchase(userId, rows[0].id);
}

// ═══ อ่านประวัติ ═══════════════════════════════════════════════

const PURCHASE_COLS = `id, document_no, supplier_name, invoice_no,
  business_date::text AS business_date, subtotal::text AS subtotal,
  discount::text AS discount, total::text AS total, status, payment_method,
  note, expense_entry_id, received_at, created_at`;

type PurchaseRow = {
  id: string; document_no: string; supplier_name: string | null; invoice_no: string | null;
  business_date: string; subtotal: string; discount: string; total: string;
  status: PurchaseView["status"]; payment_method: string; note: string | null;
  expense_entry_id: string | null; received_at: Date | string | null;
  created_at: Date | string; item_count?: number;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

function mapPurchase(r: PurchaseRow): PurchaseView {
  return {
    id: r.id,
    documentNo: r.document_no,
    supplierName: r.supplier_name,
    invoiceNo: r.invoice_no,
    businessDate: r.business_date,
    subtotal: r.subtotal,
    discount: r.discount,
    total: r.total,
    status: r.status,
    paymentMethod: r.payment_method,
    note: r.note,
    expenseEntryId: r.expense_entry_id,
    itemCount: r.item_count ?? 0,
    receivedAt: iso(r.received_at),
    createdAt: iso(r.created_at)!,
  };
}

export async function listPurchases(
  userId: string,
  limit = 50,
): Promise<PurchaseView[]> {
  const { rows } = await pool.query<PurchaseRow>(
    `SELECT ${PURCHASE_COLS},
            (SELECT COUNT(*)::int FROM stock_purchase_items i WHERE i.purchase_id = p.id)
              AS item_count
     FROM stock_purchases p
     WHERE user_id = $1
     ORDER BY business_date DESC, created_at DESC
     LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map(mapPurchase);
}

export async function getPurchase(
  userId: string,
  id: string,
): Promise<{ purchase: PurchaseView; items: PurchaseItemView[] } | null> {
  const { rows } = await pool.query<PurchaseRow>(
    `SELECT ${PURCHASE_COLS},
            (SELECT COUNT(*)::int FROM stock_purchase_items i WHERE i.purchase_id = p.id)
              AS item_count
     FROM stock_purchases p
     WHERE p.id = $2 AND p.user_id = $1`,
    [userId, id],
  );
  if (!rows[0]) return null;

  const { rows: items } = await pool.query<{
    id: string; ingredient_id: string | null; ingredient_name: string;
    purchase_quantity: string; purchase_unit_name: string; conversion_factor: string;
    stock_quantity: string; stock_unit: string; unit_price: string; total_price: string;
    cost_per_stock_unit: string; qty_before: string | null; qty_after: string | null;
  }>(
    `SELECT id, ingredient_id, ingredient_name,
            purchase_quantity::text AS purchase_quantity, purchase_unit_name,
            conversion_factor::text AS conversion_factor,
            stock_quantity::text AS stock_quantity, stock_unit,
            unit_price::text AS unit_price, total_price::text AS total_price,
            cost_per_stock_unit::text AS cost_per_stock_unit,
            qty_before::text AS qty_before, qty_after::text AS qty_after
     FROM stock_purchase_items
     WHERE purchase_id = $2 AND user_id = $1
     ORDER BY created_at ASC`,
    [userId, id],
  );

  return {
    purchase: mapPurchase(rows[0]),
    items: items.map((i) => ({
      id: i.id,
      ingredientId: i.ingredient_id,
      ingredientName: i.ingredient_name,
      purchaseQuantity: i.purchase_quantity,
      purchaseUnitName: i.purchase_unit_name,
      conversionFactor: i.conversion_factor,
      stockQuantity: i.stock_quantity,
      stockUnit: i.stock_unit,
      unitPrice: i.unit_price,
      totalPrice: i.total_price,
      costPerStockUnit: i.cost_per_stock_unit,
      qtyBefore: i.qty_before,
      qtyAfter: i.qty_after,
    })),
  };
}

/** ประวัติราคาซื้อของวัตถุดิบ — ครั้งก่อน vs ครั้งนี้ */
export async function ingredientPurchaseHistory(
  userId: string,
  ingredientId: string,
  limit = 10,
): Promise<
  { businessDate: string; documentNo: string; costPerStockUnit: string; stockQuantity: string }[]
> {
  const { rows } = await pool.query<{
    business_date: string; document_no: string;
    cost_per_stock_unit: string; stock_quantity: string;
  }>(
    `SELECT p.business_date::text AS business_date, p.document_no,
            i.cost_per_stock_unit::text AS cost_per_stock_unit,
            i.stock_quantity::text AS stock_quantity
     FROM stock_purchase_items i
     JOIN stock_purchases p ON p.id = i.purchase_id
     WHERE i.user_id = $1 AND i.ingredient_id = $2 AND p.status = 'received'
       AND i.cost_per_stock_unit > 0
     ORDER BY p.business_date DESC, p.created_at DESC
     LIMIT $3`,
    [userId, ingredientId, Math.min(Math.max(limit, 1), 50)],
  );
  return rows.map((r) => ({
    businessDate: r.business_date,
    documentNo: r.document_no,
    costPerStockUnit: r.cost_per_stock_unit,
    stockQuantity: r.stock_quantity,
  }));
}
