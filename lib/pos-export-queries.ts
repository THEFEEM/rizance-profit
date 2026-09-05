import { pool } from "@/lib/db";

/**
 * ส่งออกยอดขายเป็น CSV (30 ส.ค. 2569) — 4 ระดับความละเอียด
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * · ตัวเลขทุกตัวมาจาก DB ตรง ๆ ในช่วง [start, end] ที่ผู้ใช้เลือกบนจอ
 *   ไม่คำนวณซ้ำฝั่ง client (ไฟล์ที่ส่งบัญชี/สรรพากรต้องตรงกับที่จอโชว์)
 * · บิลที่ยกเลิก: ระดับสรุปไม่นับในยอด แต่รายงาน "จำนวนบิลยกเลิก" ไว้
 *   ระดับรายบิล/รายบรรทัดแสดงแถวพร้อมคอลัมน์สถานะ — ตรวจสอบย้อนได้
 * · ยอดแยกวิธีจ่ายใช้ pattern เดียวกับ pos-summary: บิล split เก็บใน
 *   pos_bill_payments · บิลปกติใช้หัวบิล (นับหัวบิลอย่างเดียว = พลาด split)
 */

export type ExportKind = "daily" | "bills" | "products" | "items";

export const EXPORT_KINDS: ExportKind[] = ["daily", "bills", "products", "items"];

export type CsvTable = { headers: string[]; rows: (string | number)[][] };

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toFixed(2);

const METHOD_TH: Record<string, string> = {
  cash: "เงินสด",
  promptpay: "PromptPay",
  thai_chuay_thai: "ไทยช่วยไทย",
  split: "แบ่งจ่าย",
};

/** วิธีจ่ายแบบอ่านออก — ค่าที่ไม่รู้จักคืนค่าดิบ (ไม่กลืนข้อมูล) */
const methodTh = (m: string | null) => (m ? (METHOD_TH[m] ?? m) : "-");

// ═══ 1. สรุปรายวัน ════════════════════════════════════════════

async function dailyTable(userId: string, start: string, end: string): Promise<CsvTable> {
  const { rows } = await pool.query<{
    entry_date: string; bills: string; total: string;
    cash: string; promptpay: string; thai: string;
    voided_bills: string; voided_total: string;
  }>(
    `WITH paid AS (
       SELECT entry_date, COUNT(*)::text AS bills,
              COALESCE(SUM(total_amount), 0) AS total
       FROM pos_bills
       WHERE user_id = $1 AND entry_date BETWEEN $2::date AND $3::date
         AND status = 'paid'
       GROUP BY entry_date
     ),
     -- split-aware: ส่วนเงินสดของบิลจ่ายผสมอยู่ใน pos_bill_payments
     methods AS (
       SELECT entry_date,
              COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END), 0) AS cash,
              COALESCE(SUM(CASE WHEN method = 'promptpay' THEN amount END), 0) AS promptpay,
              COALESCE(SUM(CASE WHEN method = 'thai_chuay_thai' THEN amount END), 0) AS thai
       FROM (
         SELECT b.entry_date, p.method, p.amount
         FROM pos_bill_payments p
         JOIN pos_bills b ON b.id = p.bill_id
         WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
           AND b.status = 'paid'
         UNION ALL
         SELECT b.entry_date, b.payment_method, b.total_amount
         FROM pos_bills b
         WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
           AND b.status = 'paid'
           AND NOT EXISTS (SELECT 1 FROM pos_bill_payments p WHERE p.bill_id = b.id)
       ) x
       GROUP BY entry_date
     ),
     voided AS (
       SELECT entry_date, COUNT(*)::text AS voided_bills,
              COALESCE(SUM(total_amount), 0) AS voided_total
       FROM pos_bills
       WHERE user_id = $1 AND entry_date BETWEEN $2::date AND $3::date
         AND status = 'voided'
       GROUP BY entry_date
     ),
     dates AS (
       SELECT DISTINCT entry_date FROM pos_bills
       WHERE user_id = $1 AND entry_date BETWEEN $2::date AND $3::date
     )
     SELECT d.entry_date::text AS entry_date,
            COALESCE(p.bills, '0') AS bills,
            COALESCE(p.total, 0)::text AS total,
            COALESCE(m.cash, 0)::text AS cash,
            COALESCE(m.promptpay, 0)::text AS promptpay,
            COALESCE(m.thai, 0)::text AS thai,
            COALESCE(v.voided_bills, '0') AS voided_bills,
            COALESCE(v.voided_total, 0)::text AS voided_total
     FROM dates d
     LEFT JOIN paid p ON p.entry_date = d.entry_date
     LEFT JOIN methods m ON m.entry_date = d.entry_date
     LEFT JOIN voided v ON v.entry_date = d.entry_date
     ORDER BY d.entry_date`,
    [userId, start, end],
  );

  return {
    headers: [
      "วันที่", "จำนวนบิล", "ยอดขายรวม", "เฉลี่ยต่อบิล",
      "เงินสด", "PromptPay", "ไทยช่วยไทย",
      "บิลยกเลิก", "ยอดที่ยกเลิก",
    ],
    rows: rows.map((r) => {
      const bills = Number(r.bills);
      return [
        r.entry_date,
        bills,
        money(r.total),
        bills > 0 ? money(Number(r.total) / bills) : "0.00",
        money(r.cash),
        money(r.promptpay),
        money(r.thai),
        Number(r.voided_bills),
        money(r.voided_total),
      ];
    }),
  };
}

// ═══ 2. รายบิล ════════════════════════════════════════════════

async function billsTable(userId: string, start: string, end: string): Promise<CsvTable> {
  const { rows } = await pool.query<{
    entry_date: string; bill_no: string; paid_at: string; status: string;
    payment_method: string | null; split_detail: string | null;
    total_amount: string; item_count: string;
    partner_name: string | null; partner_discount: string | null;
    campaign_discount: string | null;
    line_cost: string; void_reason: string | null;
  }>(
    // ส่วนลดในระบบมี 2 ทาง แยกคอลัมน์ให้เห็นชัด (ไม่ยุบรวมเป็นก้อนเดียว):
    //   partner_discount_amount (0086 · สิทธิ์หุ้นส่วน) · campaign redemption (0074)
    `SELECT b.entry_date::text AS entry_date, b.bill_no,
            to_char(b.created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS paid_at,
            b.status, b.payment_method,
            (SELECT string_agg(p.method || ' ' || p.amount::text, ' + ' ORDER BY p.amount DESC)
             FROM pos_bill_payments p WHERE p.bill_id = b.id) AS split_detail,
            b.total_amount::text AS total_amount,
            (SELECT COALESCE(SUM(i.quantity), 0)::text
             FROM pos_bill_items i WHERE i.bill_id = b.id) AS item_count,
            b.partner_name,
            b.partner_discount_amount::text AS partner_discount,
            (SELECT COALESCE(SUM(u.discount_amount), 0)::text
             FROM pos_campaign_usages u WHERE u.bill_id = b.id) AS campaign_discount,
            (SELECT COALESCE(SUM(i.line_cost), 0)::text
             FROM pos_bill_items i WHERE i.bill_id = b.id) AS line_cost,
            b.void_reason
     FROM pos_bills b
     WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
     ORDER BY b.entry_date, b.created_at`,
    [userId, start, end],
  );

  return {
    headers: [
      // ทุกบิลมีแถวใน pos_bill_payments ตั้งแต่ 0051 (ไม่ใช่เฉพาะบิลแบ่งจ่าย)
      // คอลัมน์นี้จึงมีค่าเสมอ — ชื่อ "รายละเอียดการจ่าย" ไม่ใช่ "แบ่งจ่าย"
      "วันที่", "เลขบิล", "เวลา", "สถานะ", "วิธีจ่าย", "รายละเอียดการจ่าย",
      "จำนวนชิ้น", "ส่วนลดโปรโมชัน", "หุ้นส่วน", "ส่วนลดหุ้นส่วน",
      "ยอดบิล", "ต้นทุนรวม", "กำไรขั้นต้น", "เหตุผลที่ยกเลิก",
    ],
    rows: rows.map((r) => [
      r.entry_date,
      r.bill_no,
      r.paid_at,
      r.status === "voided" ? "ยกเลิก" : "ขายแล้ว",
      methodTh(r.payment_method),
      r.split_detail ?? "",
      Number(r.item_count),
      money(r.campaign_discount),
      r.partner_name ?? "",
      money(r.partner_discount),
      money(r.total_amount),
      money(r.line_cost),
      money(Number(r.total_amount) - Number(r.line_cost)),
      r.void_reason ?? "",
    ]),
  };
}

// ═══ 3. สรุปรายสินค้า (เฉพาะบิลที่ขายจริง) ══════════════════════

async function productsTable(userId: string, start: string, end: string): Promise<CsvTable> {
  const { rows } = await pool.query<{
    product_name: string; qty: string; total: string; cost: string; bills: string;
  }>(
    `SELECT bi.product_name,
            SUM(bi.quantity)::text AS qty,
            SUM(bi.line_total)::text AS total,
            SUM(bi.line_cost)::text AS cost,
            COUNT(DISTINCT bi.bill_id)::text AS bills
     FROM pos_bill_items bi
     JOIN pos_bills b ON b.id = bi.bill_id
     WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
       AND b.status = 'paid'
     GROUP BY bi.product_name
     ORDER BY SUM(bi.line_total) DESC, SUM(bi.quantity) DESC`,
    [userId, start, end],
  );

  return {
    headers: [
      "สินค้า", "จำนวนขาย", "ยอดขาย", "ต้นทุนรวม", "กำไรขั้นต้น",
      "กำไร %", "จำนวนบิลที่มีสินค้านี้",
    ],
    rows: rows.map((r) => {
      const total = Number(r.total);
      const cost = Number(r.cost);
      const gross = total - cost;
      return [
        r.product_name,
        Number(r.qty),
        money(total),
        money(cost),
        money(gross),
        total > 0 ? ((gross / total) * 100).toFixed(1) : "0.0",
        Number(r.bills),
      ];
    }),
  };
}

// ═══ 4. รายบรรทัดสินค้าในบิล ════════════════════════════════════

async function itemsTable(userId: string, start: string, end: string): Promise<CsvTable> {
  const { rows } = await pool.query<{
    entry_date: string; bill_no: string; paid_at: string; status: string;
    payment_method: string | null; product_name: string; note: string | null;
    quantity: string; unit_sell_price: string; line_total: string;
    unit_cost_price: string; line_cost: string;
  }>(
    `SELECT b.entry_date::text AS entry_date, b.bill_no,
            to_char(b.created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS paid_at,
            b.status, b.payment_method,
            bi.product_name, bi.note,
            bi.quantity::text, bi.unit_sell_price::text, bi.line_total::text,
            bi.unit_cost_price::text, bi.line_cost::text
     FROM pos_bill_items bi
     JOIN pos_bills b ON b.id = bi.bill_id
     WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
     ORDER BY b.entry_date, b.created_at, bi.sort_order, bi.id`,
    [userId, start, end],
  );

  return {
    headers: [
      "วันที่", "เลขบิล", "เวลา", "สถานะ", "วิธีจ่าย", "สินค้า", "หมายเหตุ",
      "จำนวน", "ราคาต่อหน่วย", "ยอดรวมบรรทัด", "ต้นทุนต่อหน่วย", "ต้นทุนรวมบรรทัด",
      "กำไรขั้นต้น",
    ],
    rows: rows.map((r) => [
      r.entry_date,
      r.bill_no,
      r.paid_at,
      r.status === "voided" ? "ยกเลิก" : "ขายแล้ว",
      methodTh(r.payment_method),
      r.product_name,
      r.note ?? "",
      Number(r.quantity),
      money(r.unit_sell_price),
      money(r.line_total),
      money(r.unit_cost_price),
      money(r.line_cost),
      money(Number(r.line_total) - Number(r.line_cost)),
    ]),
  };
}

// ═══ CSV ══════════════════════════════════════════════════════

/** escape ตามมาตรฐาน RFC 4180 — คั่นด้วย , และครอบ " เมื่อจำเป็น */
function csvCell(v: string | number): string {
  let s = String(v ?? "");
  // กัน CSV formula injection: ชื่อสินค้า/แคมเปญที่เริ่มด้วย = + - @ จะถูก Excel รันเป็นสูตร
  // (ตัวเลขติดลบเป็น number อยู่แล้ว จึงไม่โดน — เฉพาะ string ที่เริ่มด้วยอักขระเหล่านี้)
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: CsvTable): string {
  const lines = [table.headers, ...table.rows].map((r) => r.map(csvCell).join(","));
  // CRLF: Excel บน Windows อ่านตรงกว่า \n เปล่า ๆ
  return lines.join("\r\n");
}

const KIND_LABEL: Record<ExportKind, string> = {
  daily: "สรุปรายวัน",
  bills: "รายบิล",
  products: "สรุปรายสินค้า",
  items: "รายบรรทัดสินค้า",
};

export async function buildSalesCsv(
  userId: string,
  kind: ExportKind,
  start: string,
  end: string,
): Promise<{ csv: string; filename: string }> {
  const table =
    kind === "daily"
      ? await dailyTable(userId, start, end)
      : kind === "bills"
        ? await billsTable(userId, start, end)
        : kind === "products"
          ? await productsTable(userId, start, end)
          : await itemsTable(userId, start, end);

  const range = start === end ? start : `${start}_ถึง_${end}`;
  return {
    csv: toCsv(table),
    filename: `rizance_${KIND_LABEL[kind]}_${range}.csv`,
  };
}
