import { query } from "@/lib/db";
import { addDays, today } from "@/lib/date";
import { computeProfit, toCents } from "@/lib/money";
import type { PersonalExpenseInput, PersonalIncomeInput } from "@/lib/personal-validation";
import type {
  PersonalCategoryBreakdownItem,
  PersonalDailyPoint,
  PersonalEntryRow,
  PersonalExpense,
  PersonalIncome,
  PersonalSummary,
} from "@/types/personal";

type IncomeRow = {
  id: string;
  user_id: string;
  amount: string;
  category: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

type ExpenseRow = IncomeRow;

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapIncome(r: IncomeRow): PersonalIncome {
  return {
    id: r.id,
    userId: r.user_id,
    amount: r.amount,
    category: r.category,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

function mapExpense(r: ExpenseRow): PersonalExpense {
  return {
    id: r.id,
    userId: r.user_id,
    amount: r.amount,
    category: r.category,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

const INCOME_RETURN = `id, user_id, amount::text AS amount, category, note,
  entry_date::text AS entry_date, created_at`;

const EXPENSE_RETURN = INCOME_RETURN;

async function summaryBetween(
  userId: string,
  start: string,
  end: string,
): Promise<PersonalSummary> {
  const { rows } = await query<{
    income: string;
    expense: string;
    income_count: string;
    expense_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM personal_income_entries
                 WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM personal_expense_entries
                 WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date), 0)::text AS expense,
       (SELECT COUNT(*) FROM personal_income_entries
        WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date)::text AS income_count,
       (SELECT COUNT(*) FROM personal_expense_entries
        WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date)::text AS expense_count`,
    [userId, start, end],
  );
  const r = rows[0];
  return {
    income: r.income,
    expense: r.expense,
    balance: computeProfit(r.income, r.expense),
    incomeCount: Number(r.income_count),
    expenseCount: Number(r.expense_count),
  };
}

export async function personalAllTimeSummary(userId: string): Promise<PersonalSummary> {
  const { rows } = await query<{
    income: string;
    expense: string;
    income_count: string;
    expense_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM personal_income_entries WHERE user_id = $1), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM personal_expense_entries WHERE user_id = $1), 0)::text AS expense,
       (SELECT COUNT(*) FROM personal_income_entries WHERE user_id = $1)::text AS income_count,
       (SELECT COUNT(*) FROM personal_expense_entries WHERE user_id = $1)::text AS expense_count`,
    [userId],
  );
  const r = rows[0];
  return {
    income: r.income,
    expense: r.expense,
    balance: computeProfit(r.income, r.expense),
    incomeCount: Number(r.income_count),
    expenseCount: Number(r.expense_count),
  };
}

export async function personalPeriodSummary(
  userId: string,
  start: string,
  end: string,
): Promise<PersonalSummary> {
  return summaryBetween(userId, start, end);
}

export async function personalMonthlySummary(
  userId: string,
  year: number,
  month: number,
): Promise<PersonalSummary> {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endExclusive = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = addDays(endExclusive, -1);
  return summaryBetween(userId, start, end);
}

function mapBreakdownRows(
  rows: { category: string; amount: string; count: string }[],
): PersonalCategoryBreakdownItem[] {
  return rows
    .map((r) => ({
      category: r.category,
      amount: r.amount,
      count: Number(r.count),
    }))
    .filter((r) => r.count > 0 && toCents(r.amount) !== 0)
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

export async function personalCategoryBreakdown(
  userId: string,
  start: string,
  end: string,
  type: "income" | "expense",
): Promise<PersonalCategoryBreakdownItem[]> {
  const table = type === "income" ? "personal_income_entries" : "personal_expense_entries";
  const { rows } = await query<{ category: string; amount: string; count: string }>(
    `SELECT category,
            COALESCE(SUM(amount), 0)::text AS amount,
            COUNT(*)::text AS count
     FROM ${table}
     WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date
     GROUP BY category`,
    [userId, start, end],
  );
  return mapBreakdownRows(rows);
}

export async function personalDailyProfitSeries(
  userId: string,
  days: number,
): Promise<PersonalDailyPoint[]> {
  const end = today();
  const span = Math.max(1, Math.floor(days));
  const start = addDays(end, -(span - 1));

  const { rows } = await query<{ entry_date: string; income: string; expense: string }>(
    `WITH combined AS (
       SELECT entry_date, amount, 'income' AS type FROM personal_income_entries
       WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date
       UNION ALL
       SELECT entry_date, amount, 'expense' AS type FROM personal_expense_entries
       WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date
     )
     SELECT
       to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::text AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::text AS expense
     FROM combined
     GROUP BY entry_date
     ORDER BY entry_date ASC`,
    [userId, start, end],
  );

  const byDate = new Map(rows.map((r) => [r.entry_date, { income: r.income, expense: r.expense }]));
  const series: PersonalDailyPoint[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const row = byDate.get(d) ?? { income: "0.00", expense: "0.00" };
    series.push({
      date: d,
      income: row.income,
      expense: row.expense,
      balance: computeProfit(row.income, row.expense),
    });
  }
  return series;
}

export async function listPersonalIncomes(
  userId: string,
  limit?: number,
): Promise<PersonalIncome[]> {
  const base = `SELECT ${INCOME_RETURN}
     FROM personal_income_entries
     WHERE user_id = $1
     ORDER BY entry_date DESC, created_at DESC`;
  const { rows } = await query<IncomeRow>(
    limit && limit > 0 ? `${base} LIMIT $2` : base,
    limit && limit > 0 ? [userId, limit] : [userId],
  );
  return rows.map(mapIncome);
}

export async function listPersonalExpenses(
  userId: string,
  limit?: number,
): Promise<PersonalExpense[]> {
  const base = `SELECT ${EXPENSE_RETURN}
     FROM personal_expense_entries
     WHERE user_id = $1
     ORDER BY entry_date DESC, created_at DESC`;
  const { rows } = await query<ExpenseRow>(
    limit && limit > 0 ? `${base} LIMIT $2` : base,
    limit && limit > 0 ? [userId, limit] : [userId],
  );
  return rows.map(mapExpense);
}

export async function listPersonalEntriesAll(
  userId: string,
  limit = 20,
): Promise<PersonalEntryRow[]> {
  const { rows } = await query<{
    id: string;
    kind: string;
    amount: string;
    category: string;
    note: string | null;
    entry_date: string;
    created_at: Date | string;
  }>(
    `SELECT id, kind, amount::text AS amount, category, note,
            entry_date::text AS entry_date, created_at
     FROM (
       SELECT id, 'income' AS kind, amount, category, note, entry_date, created_at
       FROM personal_income_entries WHERE user_id = $1
       UNION ALL
       SELECT id, 'expense' AS kind, amount, category, note, entry_date, created_at
       FROM personal_expense_entries WHERE user_id = $1
     ) merged
     ORDER BY entry_date DESC, created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "income" | "expense",
    amount: r.amount,
    category: r.category,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  }));
}

export async function createPersonalIncome(
  userId: string,
  input: PersonalIncomeInput,
): Promise<PersonalIncome> {
  const entryDate = input.entryDate ?? today();
  const { rows } = await query<IncomeRow>(
    `INSERT INTO personal_income_entries (user_id, amount, category, note, entry_date)
     VALUES ($1, $2, $3, $4, $5::date)
     RETURNING ${INCOME_RETURN}`,
    [userId, input.amount.toFixed(2), input.category, input.note ?? null, entryDate],
  );
  return mapIncome(rows[0]);
}

export async function createPersonalExpense(
  userId: string,
  input: PersonalExpenseInput,
): Promise<PersonalExpense> {
  const entryDate = input.entryDate ?? today();
  const { rows } = await query<ExpenseRow>(
    `INSERT INTO personal_expense_entries (user_id, amount, category, note, entry_date)
     VALUES ($1, $2, $3, $4, $5::date)
     RETURNING ${EXPENSE_RETURN}`,
    [userId, input.amount.toFixed(2), input.category, input.note ?? null, entryDate],
  );
  return mapExpense(rows[0]);
}

export async function deletePersonalIncome(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM personal_income_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function deletePersonalExpense(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM personal_expense_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}
