import { pool } from "@/lib/db";

/** Daily sales summary for the POS dashboard — aggregates in SQL, no new tables. */

export type PosDailySummary = {
  date: string;
  paidTotal: string;
  paidCount: number;
  voidedCount: number;
  byMethod: { cash: string; promptpay: string };
  topProducts: { productName: string; quantity: string; total: string }[];
  /** 24 entries, index = hour 0-23 (Asia/Bangkok), paid bills only. */
  hourly: { count: number; total: string }[];
};

type TotalsRow = {
  status: string;
  payment_method: string;
  bill_count: string;
  total: string;
};

type TopProductRow = {
  product_name: string;
  quantity: string;
  total: string;
};

type HourlyRow = {
  hour: number;
  bill_count: string;
  total: string;
};

export async function getPosDailySummary(
  userId: string,
  date: string,
): Promise<PosDailySummary> {
  const [totalsResult, topResult, hourlyResult] = await Promise.all([
    pool.query<TotalsRow>(
      `SELECT status, payment_method,
              COUNT(*)::text AS bill_count,
              COALESCE(SUM(total_amount), 0)::text AS total
       FROM pos_bills
       WHERE user_id = $1 AND entry_date = $2
       GROUP BY status, payment_method`,
      [userId, date],
    ),
    pool.query<TopProductRow>(
      `SELECT bi.product_name,
              SUM(bi.quantity)::text AS quantity,
              SUM(bi.line_total)::text AS total
       FROM pos_bill_items bi
       JOIN pos_bills b ON b.id = bi.bill_id
       WHERE b.user_id = $1 AND b.entry_date = $2 AND b.status = 'paid'
       GROUP BY bi.product_name
       ORDER BY SUM(bi.line_total) DESC, SUM(bi.quantity) DESC
       LIMIT 5`,
      [userId, date],
    ),
    pool.query<HourlyRow>(
      `SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Bangkok'))::int AS hour,
              COUNT(*)::text AS bill_count,
              COALESCE(SUM(total_amount), 0)::text AS total
       FROM pos_bills
       WHERE user_id = $1 AND entry_date = $2 AND status = 'paid'
       GROUP BY 1
       ORDER BY 1`,
      [userId, date],
    ),
  ]);

  let paidTotal = 0;
  let paidCount = 0;
  let voidedCount = 0;
  let cash = 0;
  let promptpay = 0;

  for (const r of totalsResult.rows) {
    const count = parseInt(r.bill_count, 10);
    const total = parseFloat(r.total);
    if (r.status === "paid") {
      paidCount += count;
      paidTotal += total;
      if (r.payment_method === "cash") cash += total;
      else if (r.payment_method === "promptpay") promptpay += total;
    } else if (r.status === "voided") {
      voidedCount += count;
    }
  }

  const hourly = Array.from({ length: 24 }, () => ({ count: 0, total: "0.00" }));
  for (const r of hourlyResult.rows) {
    if (r.hour >= 0 && r.hour <= 23) {
      hourly[r.hour] = {
        count: parseInt(r.bill_count, 10),
        total: parseFloat(r.total).toFixed(2),
      };
    }
  }

  return {
    date,
    paidTotal: paidTotal.toFixed(2),
    paidCount,
    voidedCount,
    byMethod: { cash: cash.toFixed(2), promptpay: promptpay.toFixed(2) },
    topProducts: topResult.rows.map((r) => ({
      productName: r.product_name,
      quantity: parseFloat(r.quantity).toString(),
      total: parseFloat(r.total).toFixed(2),
    })),
    hourly,
  };
}
