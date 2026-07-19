import { pool } from "@/lib/db";

/**
 * Sales summary for the POS dashboard over an inclusive [start, end] range.
 * Single-day range additionally returns the hourly breakdown; every range
 * returns a per-day series + previous-period totals (same length, immediately
 * before start) for ±% comparison. Aggregates in SQL, no new tables.
 */

export type PosSummary = {
  start: string;
  end: string;
  paidTotal: string;
  paidCount: number;
  voidedCount: number;
  byMethod: { cash: string; promptpay: string; thaiChuayThai: string };
  topProducts: { productName: string; quantity: string; total: string }[];
  /** Per-day series covering the whole range (gaps filled with zeros). */
  daily: { date: string; count: number; total: string }[];
  /** 24 entries, hour 0-23 Asia/Bangkok — only when start === end. */
  hourly?: { count: number; total: string }[];
  /** Previous period of equal length, for comparison. */
  prev: { paidTotal: string; paidCount: number };
};

type TotalsRow = {
  status: string;
  bill_count: string;
  total: string;
};

type MethodRow = { method: string; total: string };
type TopProductRow = { product_name: string; quantity: string; total: string };
type HourlyRow = { hour: number; bill_count: string; total: string };
type DailyRow = { entry_date: string; bill_count: string; total: string };

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function toUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daySpan(start: string, end: string): number {
  return Math.round((toUtcMs(end) - toUtcMs(start)) / 86_400_000) + 1;
}

export async function getPosRangeSummary(
  userId: string,
  start: string,
  end: string,
): Promise<PosSummary> {
  const days = daySpan(start, end);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const singleDay = start === end;

  const [totalsResult, methodResult, topResult, dailyResult, prevResult, hourlyResult] =
    await Promise.all([
      pool.query<TotalsRow>(
        `SELECT status, COUNT(*)::text AS bill_count,
                COALESCE(SUM(total_amount), 0)::text AS total
         FROM pos_bills
         WHERE user_id = $1 AND entry_date BETWEEN $2::date AND $3::date
         GROUP BY status`,
        [userId, start, end],
      ),
      // Split-aware per-method totals; pre-0051 bills fall back to bill method.
      pool.query<MethodRow>(
        `SELECT method, COALESCE(SUM(amount), 0)::text AS total
         FROM (
           SELECT p.method, p.amount
           FROM pos_bill_payments p
           JOIN pos_bills b ON b.id = p.bill_id
           WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
             AND b.status = 'paid'
           UNION ALL
           SELECT b.payment_method AS method, b.total_amount AS amount
           FROM pos_bills b
           WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
             AND b.status = 'paid'
             AND NOT EXISTS (SELECT 1 FROM pos_bill_payments p WHERE p.bill_id = b.id)
         ) x
         GROUP BY method`,
        [userId, start, end],
      ),
      pool.query<TopProductRow>(
        `SELECT bi.product_name,
                SUM(bi.quantity)::text AS quantity,
                SUM(bi.line_total)::text AS total
         FROM pos_bill_items bi
         JOIN pos_bills b ON b.id = bi.bill_id
         WHERE b.user_id = $1 AND b.entry_date BETWEEN $2::date AND $3::date
           AND b.status = 'paid'
         GROUP BY bi.product_name
         ORDER BY SUM(bi.line_total) DESC, SUM(bi.quantity) DESC
         LIMIT 5`,
        [userId, start, end],
      ),
      pool.query<DailyRow>(
        `SELECT entry_date::text AS entry_date,
                COUNT(*)::text AS bill_count,
                COALESCE(SUM(total_amount), 0)::text AS total
         FROM pos_bills
         WHERE user_id = $1 AND entry_date BETWEEN $2::date AND $3::date
           AND status = 'paid'
         GROUP BY entry_date
         ORDER BY entry_date`,
        [userId, start, end],
      ),
      pool.query<TotalsRow>(
        `SELECT 'paid' AS status, COUNT(*)::text AS bill_count,
                COALESCE(SUM(total_amount), 0)::text AS total
         FROM pos_bills
         WHERE user_id = $1 AND entry_date BETWEEN $2::date AND $3::date
           AND status = 'paid'`,
        [userId, prevStart, prevEnd],
      ),
      singleDay
        ? pool.query<HourlyRow>(
            `SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Bangkok'))::int AS hour,
                    COUNT(*)::text AS bill_count,
                    COALESCE(SUM(total_amount), 0)::text AS total
             FROM pos_bills
             WHERE user_id = $1 AND entry_date = $2::date AND status = 'paid'
             GROUP BY 1
             ORDER BY 1`,
            [userId, start],
          )
        : Promise.resolve({ rows: [] as HourlyRow[] }),
    ]);

  let paidTotal = 0;
  let paidCount = 0;
  let voidedCount = 0;
  for (const r of totalsResult.rows) {
    if (r.status === "paid") {
      paidCount += parseInt(r.bill_count, 10);
      paidTotal += parseFloat(r.total);
    } else if (r.status === "voided") {
      voidedCount += parseInt(r.bill_count, 10);
    }
  }

  let cash = 0;
  let promptpay = 0;
  let thaiChuayThai = 0;
  for (const r of methodResult.rows) {
    const total = parseFloat(r.total);
    if (r.method === "cash") cash += total;
    else if (r.method === "promptpay") promptpay += total;
    else if (r.method === "thai_chuay_thai") thaiChuayThai += total;
  }

  // Fill day gaps with zeros so charts render a continuous axis.
  const byDate = new Map(dailyResult.rows.map((r) => [r.entry_date, r]));
  const daily: PosSummary["daily"] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const row = byDate.get(date);
    daily.push({
      date,
      count: row ? parseInt(row.bill_count, 10) : 0,
      total: row ? parseFloat(row.total).toFixed(2) : "0.00",
    });
  }

  let hourly: PosSummary["hourly"];
  if (singleDay) {
    hourly = Array.from({ length: 24 }, () => ({ count: 0, total: "0.00" }));
    for (const r of hourlyResult.rows) {
      if (r.hour >= 0 && r.hour <= 23) {
        hourly[r.hour] = {
          count: parseInt(r.bill_count, 10),
          total: parseFloat(r.total).toFixed(2),
        };
      }
    }
  }

  const prevRow = prevResult.rows[0];

  return {
    start,
    end,
    paidTotal: paidTotal.toFixed(2),
    paidCount,
    voidedCount,
    byMethod: {
      cash: cash.toFixed(2),
      promptpay: promptpay.toFixed(2),
      thaiChuayThai: thaiChuayThai.toFixed(2),
    },
    topProducts: topResult.rows.map((r) => ({
      productName: r.product_name,
      quantity: parseFloat(r.quantity).toString(),
      total: parseFloat(r.total).toFixed(2),
    })),
    daily,
    hourly,
    prev: {
      paidTotal: prevRow ? parseFloat(prevRow.total).toFixed(2) : "0.00",
      paidCount: prevRow ? parseInt(prevRow.bill_count, 10) : 0,
    },
  };
}
