import { query } from "@/lib/db";
import { computeProfit, sumDecimals, toCents } from "@/lib/money";
import type {
  AllTimeSummary,
  CategoryBreakdown,
  CategoryBreakdownItem,
  DailySummary,
  Expense,
  ExpenseCategory,
  Income,
  IncomeCategory,
  MonthlyDay,
  MonthlySummary,
  PeriodKey,
  PeriodSummary,
  User,
} from "@/types";
import type { ExpenseInput, IncomeInput } from "@/lib/validation";
import { monthRange, periodRange, today } from "@/lib/date";
import { isFixed } from "@/lib/expense-categories";
import { centsToDecimalString } from "@/lib/money";

// ---- row → domain mappers -------------------------------------------------

type UserRow = {
  id: string;
  email: string;
  shop_name: string;
  currency: string;
  created_at: Date | string;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    shopName: r.shop_name,
    currency: r.currency,
    createdAt: toIso(r.created_at),
  };
}

type IncomeRow = {
  id: string;
  amount: string;
  category: string;
  payment_method?: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

function mapIncome(r: IncomeRow): Income {
  return {
    id: r.id,
    amount: r.amount,
    category: r.category as IncomeCategory,
    paymentMethod: r.payment_method,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

type ExpenseRow = IncomeRow & { category: string };

function mapExpense(r: ExpenseRow): Expense {
  return {
    id: r.id,
    amount: r.amount,
    category: r.category as ExpenseCategory,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

// ---- auth -----------------------------------------------------------------

export type UserWithHash = User & { passwordHash: string };

export async function createUser(params: {
  email: string;
  passwordHash: string;
  shopName: string;
}): Promise<User> {
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, shop_name, currency, created_at`,
    [params.email, params.passwordHash, params.shopName],
  );
  return mapUser(rows[0]);
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const { rows } = await query<UserRow & { password_hash: string }>(
    `SELECT id, email, password_hash, shop_name, currency, created_at
     FROM users WHERE email = $1`,
    [email],
  );
  if (!rows[0]) return null;
  return { ...mapUser(rows[0]), passwordHash: rows[0].password_hash };
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `SELECT id, email, shop_name, currency, created_at FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updateUserShopName(userId: string, shopName: string): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `UPDATE users SET shop_name = $2 WHERE id = $1
     RETURNING id, email, shop_name, currency, created_at`,
    [userId, shopName],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function emailExists(email: string): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) AS exists`,
    [email],
  );
  return rows[0]?.exists ?? false;
}

// ---- income ---------------------------------------------------------------

export async function createIncome(userId: string, input: IncomeInput): Promise<Income> {
  const entryDate = input.entryDate ?? today();
  const category = input.category ?? "storefront";
  const paymentMethod = input.paymentMethod ?? "cash";
  const { rows } = await query<IncomeRow>(
    `INSERT INTO income_entries (user_id, amount, category, payment_method, note, entry_date)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     RETURNING id, amount, category, payment_method, note, entry_date::text AS entry_date, created_at`,
    [userId, input.amount.toFixed(2), category, paymentMethod, input.note ?? null, entryDate],
  );
  return mapIncome(rows[0]);
}

export async function listIncomeByDate(userId: string, date: string): Promise<Income[]> {
  const { rows } = await query<IncomeRow>(
    `SELECT id, amount, category, note, entry_date::text AS entry_date, created_at
     FROM income_entries
     WHERE user_id = $1 AND entry_date = $2
     ORDER BY created_at DESC`,
    [userId, date],
  );
  return rows.map(mapIncome);
}

export async function listIncomeInPeriod(
  userId: string,
  start: string,
  end: string,
): Promise<Income[]> {
  const { rows } = await query<IncomeRow>(
    `SELECT id, amount, category, note, entry_date::text AS entry_date, created_at
     FROM income_entries
     WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, start, end],
  );
  return rows.map(mapIncome);
}

/** Delete an income row scoped to the owner. Returns true if a row was removed. */
export async function deleteIncome(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM income_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ---- expense --------------------------------------------------------------

export async function createExpense(userId: string, input: ExpenseInput): Promise<Expense> {
  const entryDate = input.entryDate ?? today();
  const category = input.category ?? "expense_misc";
  const { rows } = await query<ExpenseRow>(
    `INSERT INTO expense_entries (user_id, amount, category, note, entry_date)
     VALUES ($1, $2, $3, $4, $5::date)
     RETURNING id, amount, category, note, entry_date::text AS entry_date, created_at`,
    [userId, input.amount.toFixed(2), category, input.note ?? null, entryDate],
  );
  return mapExpense(rows[0]);
}

export async function listExpenseByDate(userId: string, date: string): Promise<Expense[]> {
  const { rows } = await query<ExpenseRow>(
    `SELECT id, amount, category, note, entry_date::text AS entry_date, created_at
     FROM expense_entries
     WHERE user_id = $1 AND entry_date = $2
     ORDER BY created_at DESC`,
    [userId, date],
  );
  return rows.map(mapExpense);
}

export async function listExpenseInPeriod(
  userId: string,
  start: string,
  end: string,
): Promise<Expense[]> {
  const { rows } = await query<ExpenseRow>(
    `SELECT id, amount, category, note, entry_date::text AS entry_date, created_at
     FROM expense_entries
     WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, start, end],
  );
  return rows.map(mapExpense);
}

export async function deleteExpense(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM expense_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ---- summaries (computed, never stored) -----------------------------------

export async function allTimeSummary(userId: string): Promise<AllTimeSummary> {
  const { rows } = await query<{
    income: string;
    expense: string;
    income_count: string;
    expense_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries  WHERE user_id = $1), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries WHERE user_id = $1), 0)::text AS expense,
       (SELECT COUNT(*) FROM income_entries  WHERE user_id = $1)::text AS income_count,
       (SELECT COUNT(*) FROM expense_entries WHERE user_id = $1)::text AS expense_count`,
    [userId],
  );
  const r = rows[0];
  return {
    income: r.income,
    expense: r.expense,
    profit: computeProfit(r.income, r.expense),
    incomeCount: Number(r.income_count),
    expenseCount: Number(r.expense_count),
  };
}

export async function periodSummary(userId: string, period: PeriodKey): Promise<PeriodSummary> {
  const { start, end } = periodRange(period);
  const { rows } = await query<{
    income: string;
    expense: string;
    income_count: string;
    expense_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS expense,
       (SELECT COUNT(*) FROM income_entries
        WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3)::text AS income_count,
       (SELECT COUNT(*) FROM expense_entries
        WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3)::text AS expense_count`,
    [userId, start, end],
  );
  const r = rows[0];
  return {
    period,
    start,
    end,
    income: r.income,
    expense: r.expense,
    profit: computeProfit(r.income, r.expense),
    incomeCount: Number(r.income_count),
    expenseCount: Number(r.expense_count),
  };
}

function mapBreakdownRows(
  rows: { category: string; amount: string; count: string }[],
): CategoryBreakdownItem[] {
  return rows
    .map((r) => ({
      category: r.category,
      amount: r.amount,
      count: Number(r.count),
    }))
    .filter((r) => r.count > 0 && toCents(r.amount) !== 0)
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

/** Per-category income/expense totals for a date range — regular tables only. */
export async function categoryBreakdown(
  userId: string,
  start: string,
  end: string,
): Promise<CategoryBreakdown> {
  const [incomeRes, expenseRes] = await Promise.all([
    query<{ category: string; amount: string; count: string }>(
      `SELECT category,
              COALESCE(SUM(amount), 0)::text AS amount,
              COUNT(*)::text AS count
       FROM income_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
       GROUP BY category`,
      [userId, start, end],
    ),
    query<{ category: string; amount: string; count: string }>(
      `SELECT category,
              COALESCE(SUM(amount), 0)::text AS amount,
              COUNT(*)::text AS count
       FROM expense_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
       GROUP BY category`,
      [userId, start, end],
    ),
  ]);

  return {
    start,
    end,
    income: mapBreakdownRows(incomeRes.rows),
    expense: mapBreakdownRows(expenseRes.rows),
  };
}

/** Cash vs transfer income totals for a date range — regular shop only. */
export async function periodIncomeByCashTransfer(
  userId: string,
  start: string,
  end: string,
): Promise<{ cashIncome: string; transferIncome: string }> {
  const { rows } = await query<{ cash_income: string; transfer_income: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0)::text AS cash_income,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END), 0)::text AS transfer_income
     FROM income_entries
     WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3`,
    [userId, start, end],
  );
  const r = rows[0];
  return { cashIncome: r.cash_income, transferIncome: r.transfer_income };
}

/** Fixed vs variable expense totals for a date range — derived from category via isFixed(). */
export async function periodExpenseByFixedVariable(
  userId: string,
  start: string,
  end: string,
): Promise<{ fixedExpense: string; variableExpense: string }> {
  const { rows } = await query<{ amount: string; category: string }>(
    `SELECT amount, category FROM expense_entries
     WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3`,
    [userId, start, end],
  );
  let fixedCents = 0;
  let variableCents = 0;
  for (const row of rows) {
    const cents = toCents(row.amount);
    if (isFixed(row.category)) fixedCents += cents;
    else variableCents += cents;
  }
  return {
    fixedExpense: centsToDecimalString(fixedCents),
    variableExpense: centsToDecimalString(variableCents),
  };
}

export async function dailySummary(userId: string, date: string): Promise<DailySummary> {
  const { rows } = await query<{
    income: string;
    expense: string;
    income_count: string;
    expense_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries  WHERE user_id = $1 AND entry_date = $2), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries WHERE user_id = $1 AND entry_date = $2), 0)::text AS expense,
       (SELECT COUNT(*) FROM income_entries  WHERE user_id = $1 AND entry_date = $2)::text AS income_count,
       (SELECT COUNT(*) FROM expense_entries WHERE user_id = $1 AND entry_date = $2)::text AS expense_count`,
    [userId, date],
  );
  const r = rows[0];
  return {
    date,
    income: r.income,
    expense: r.expense,
    profit: computeProfit(r.income, r.expense),
    incomeCount: Number(r.income_count),
    expenseCount: Number(r.expense_count),
  };
}

export async function monthlySummary(userId: string, month: string): Promise<MonthlySummary> {
  const { start, endExclusive } = monthRange(month);
  const { rows } = await query<{ date: string; income: string; expense: string }>(
    `WITH inc AS (
       SELECT entry_date, SUM(amount) AS income FROM income_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date < $3
       GROUP BY entry_date
     ),
     exp AS (
       SELECT entry_date, SUM(amount) AS expense FROM expense_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date < $3
       GROUP BY entry_date
     )
     SELECT
       to_char(COALESCE(inc.entry_date, exp.entry_date), 'YYYY-MM-DD') AS date,
       COALESCE(inc.income, 0)::text  AS income,
       COALESCE(exp.expense, 0)::text AS expense
     FROM inc FULL OUTER JOIN exp ON inc.entry_date = exp.entry_date
     ORDER BY date DESC`,
    [userId, start, endExclusive],
  );

  const days: MonthlyDay[] = rows.map((r) => ({
    date: r.date,
    income: r.income,
    expense: r.expense,
    profit: computeProfit(r.income, r.expense),
  }));

  const income = sumDecimals(...days.map((d) => d.income), 0);
  const expense = sumDecimals(...days.map((d) => d.expense), 0);

  return {
    month,
    income,
    expense,
    profit: computeProfit(income, expense),
    days,
  };
}
