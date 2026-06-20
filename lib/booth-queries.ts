// Mode Even (booth/event) data access. Booth data lives in separate tables —
// nothing in here touches income_entries / expense_entries.
import { query } from "@/lib/db";
import {
  boothCategoryFromCostType,
  isFixed,
  normalizeExpenseCategory,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";
import {
  computeSplitProfit,
  computeWageCost,
  inclusiveEventDays,
  type SplitProfitResult,
} from "@/lib/booth-split";
import { centsToDecimalString, computeProfit, sumDecimals, toCents } from "@/lib/money";
import { addDays, today } from "@/lib/date";
import type { DailyProfitPoint } from "@/types";
import type {
  Booth,
  BoothCostType,
  BoothEntryResult,
  BoothExpense,
  BoothIncome,
  BoothMember,
  BoothMemberResult,
  BoothStatus,
  BoothCloseResult,
  BoothSummary,
  BoothUpdateResult,
  MemberRole,
  PaymentMethod,
  WageType,
} from "@/types/booth";

const ADVANCE_NOTE = "ออกเงินก่อน";

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

type BoothRow = {
  id: string;
  name: string;
  pool_budget: string;
  pool_gets_share: boolean;
  profit_split_method: string;
  member_equity: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: Date | string | null;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapBooth(r: BoothRow): Booth {
  const memberEquity = r.member_equity ?? "0.00";
  return {
    id: r.id,
    name: r.name,
    poolBudget: r.pool_budget,
    poolGetsShare: r.pool_gets_share,
    profitSplitMethod: r.profit_split_method as Booth["profitSplitMethod"],
    memberEquity,
    totalBudget: sumDecimals(r.pool_budget, memberEquity),
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status as BoothStatus,
    closedAt: r.closed_at === null ? null : toIso(r.closed_at),
    note: r.note,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

const MEMBER_EQUITY_SQL = `COALESCE((
  SELECT SUM(m.investment_amount)
  FROM booth_members m
  WHERE m.booth_id = b.id AND m.role IN ('investor', 'manager')
), 0)::text AS member_equity`;

const BOOTH_COLS = `b.id, b.name, b.pool_budget, b.pool_gets_share, b.profit_split_method,
  ${MEMBER_EQUITY_SQL},
  b.start_date::text AS start_date, b.end_date::text AS end_date,
  b.status, b.closed_at, b.note, b.created_at, b.updated_at`;

type BoothIncomeRow = {
  id: string;
  booth_id: string;
  amount: string;
  category: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

const INCOME_RETURN = `id, booth_id, amount, category, payment_method, note,
  entry_date::text AS entry_date, created_at`;

function mapBoothIncome(r: BoothIncomeRow): BoothIncome {
  return {
    id: r.id,
    boothId: r.booth_id,
    amount: r.amount,
    category: r.category,
    paymentMethod: r.payment_method as PaymentMethod,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

type BoothExpenseRow = {
  id: string;
  booth_id: string;
  amount: string;
  cost_type: string;
  category: string;
  label: string | null;
  note: string | null;
  payer_member_id: string | null;
  external_payer_name: string | null;
  entry_date: string;
  created_at: Date | string;
};

function mapBoothExpense(r: BoothExpenseRow): BoothExpense {
  const externalRaw = r.external_payer_name?.trim() ?? "";
  return {
    id: r.id,
    boothId: r.booth_id,
    amount: r.amount,
    costType: r.cost_type as BoothCostType,
    category: r.category,
    label: r.label,
    note: r.note,
    payerMemberId: r.payer_member_id,
    externalPayerName: externalRaw.length > 0 ? externalRaw : null,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

type BoothMemberRow = {
  id: string;
  booth_id: string;
  name: string;
  role: string;
  investment_amount: string;
  wage_amount: string | null;
  wage_type: string | null;
  created_at: Date | string;
};

function mapBoothMember(r: BoothMemberRow): BoothMember {
  return {
    id: r.id,
    boothId: r.booth_id,
    name: r.name,
    role: r.role as MemberRole,
    investmentAmount: r.investment_amount,
    wageAmount: r.wage_amount,
    wageType: r.wage_type as WageType | null,
    createdAt: toIso(r.created_at),
  };
}

const EXPENSE_RETURN = `id, booth_id, amount, cost_type, category, label, note, payer_member_id,
  external_payer_name, entry_date::text AS entry_date, created_at`;

/** Fixed vs variable totals from expense category — never from cost_type. */
function aggregateBoothExpenseTotals(
  rows: { amount: string; category: string }[],
): { fixedExpense: string; variableExpense: string } {
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

const MEMBER_RETURN = `id, booth_id, name, role, investment_amount, wage_amount, wage_type, created_at`;

function toSplitMemberInput(m: BoothMember) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    investmentAmount: m.investmentAmount,
    wageAmount: m.wageAmount,
    wageType: m.wageType,
  };
}

// ---- booths ----------------------------------------------------------------

export type BoothInput = {
  name: string;
  poolBudget: number;
  poolGetsShare?: boolean;
  profitSplitMethod?: Booth["profitSplitMethod"];
  startDate: string;
  endDate: string;
  note?: string;
};

export async function listBooths(userId: string): Promise<Booth[]> {
  const { rows } = await query<BoothRow>(
    `SELECT ${BOOTH_COLS} FROM booths b
     WHERE b.user_id = $1
     ORDER BY b.status ASC, b.start_date DESC, b.created_at DESC`,
    [userId],
  );
  return rows.map(mapBooth);
}

export async function getBooth(userId: string, id: string): Promise<Booth | null> {
  const { rows } = await query<BoothRow>(
    `SELECT ${BOOTH_COLS} FROM booths b WHERE b.user_id = $1 AND b.id = $2`,
    [userId, id],
  );
  return rows[0] ? mapBooth(rows[0]) : null;
}

export async function createBooth(userId: string, input: BoothInput): Promise<Booth> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO booths (user_id, name, pool_budget, pool_gets_share, profit_split_method, start_date, end_date, note)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8)
     RETURNING id`,
    [
      userId,
      input.name,
      input.poolBudget.toFixed(2),
      input.poolGetsShare ?? false,
      input.profitSplitMethod ?? "equal",
      input.startDate,
      input.endDate,
      input.note ?? null,
    ],
  );
  const booth = await getBooth(userId, rows[0].id);
  if (!booth) throw new Error("Booth create failed");
  return booth;
}

async function countBoothEntriesOutsideRange(
  boothId: string,
  start: string,
  end: string,
): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM booth_income_entries
        WHERE booth_id = $1 AND (entry_date < $2::date OR entry_date > $3::date)) +
       (SELECT COUNT(*) FROM booth_expense_entries
        WHERE booth_id = $1 AND (entry_date < $2::date OR entry_date > $3::date))
     )::text AS count`,
    [boothId, start, end],
  );
  return Number(rows[0].count);
}

export async function updateBooth(
  userId: string,
  id: string,
  input: Partial<BoothInput>,
): Promise<BoothUpdateResult> {
  const existing = await getBooth(userId, id);
  if (!existing) return { ok: false, reason: "booth_not_found" };
  if (existing.status === "closed") return { ok: false, reason: "booth_closed" };

  const newStart = input.startDate ?? existing.startDate;
  const newEnd = input.endDate ?? existing.endDate;
  const rangeNarrowed = newStart > existing.startDate || newEnd < existing.endDate;

  if (rangeNarrowed) {
    const outside = await countBoothEntriesOutsideRange(id, newStart, newEnd);
    if (outside > 0) {
      return { ok: false, reason: "entries_outside_new_range", count: outside };
    }
  }

  const { rows } = await query<BoothRow>(
    `UPDATE booths b SET name = $3, pool_budget = $4, pool_gets_share = $5,
       profit_split_method = $6, start_date = $7::date, end_date = $8::date, note = $9, updated_at = now()
     WHERE b.user_id = $1 AND b.id = $2 AND b.status = 'open'
     RETURNING ${BOOTH_COLS}`,
    [
      userId,
      id,
      input.name ?? existing.name,
      (input.poolBudget ?? Number(existing.poolBudget)).toFixed(2),
      input.poolGetsShare ?? existing.poolGetsShare,
      input.profitSplitMethod ?? existing.profitSplitMethod,
      newStart,
      newEnd,
      input.note !== undefined ? input.note : existing.note,
    ],
  );
  if (!rows[0]) return { ok: false, reason: "booth_not_found" };
  return { ok: true, booth: mapBooth(rows[0]) };
}

export async function closeBooth(userId: string, id: string): Promise<BoothCloseResult> {
  const existing = await getBooth(userId, id);
  if (!existing) return { ok: false, reason: "booth_not_found" };
  if (existing.status === "closed") return { ok: false, reason: "already_closed" };

  const { rows } = await query<BoothRow>(
    `UPDATE booths b SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE b.user_id = $1 AND b.id = $2 AND b.status = 'open'
     RETURNING ${BOOTH_COLS}`,
    [userId, id],
  );
  if (!rows[0]) return { ok: false, reason: "already_closed" };
  return { ok: true, booth: mapBooth(rows[0]) };
}

// ---- entry guards -----------------------------------------------------------

function dateWithinBooth(booth: Booth, entryDate: string): boolean {
  return entryDate >= booth.startDate && entryDate <= booth.endDate;
}

async function guardBoothEntry(
  userId: string,
  boothId: string,
  entryDate: string,
): Promise<
  | { ok: true; booth: Booth }
  | { ok: false; reason: "booth_not_found" | "booth_closed" | "date_out_of_range" }
> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return { ok: false, reason: "booth_not_found" };
  if (booth.status !== "open") return { ok: false, reason: "booth_closed" };
  if (!dateWithinBooth(booth, entryDate)) return { ok: false, reason: "date_out_of_range" };
  return { ok: true, booth };
}

async function guardBoothMemberWrite(
  userId: string,
  boothId: string,
): Promise<
  | { ok: true; booth: Booth }
  | { ok: false; reason: "booth_not_found" | "booth_closed" }
> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return { ok: false, reason: "booth_not_found" };
  if (booth.status !== "open") return { ok: false, reason: "booth_closed" };
  return { ok: true, booth };
}

async function memberBelongsToBooth(boothId: string, memberId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM booth_members WHERE id = $1 AND booth_id = $2`,
    [memberId, boothId],
  );
  return rows.length > 0;
}

// ---- booth income -----------------------------------------------------------

export type BoothIncomeInput = {
  amount: number;
  category?: IncomeCategoryKey;
  paymentMethod: PaymentMethod;
  note?: string;
  entryDate?: string;
};

export async function createBoothIncome(
  userId: string,
  boothId: string,
  input: BoothIncomeInput,
): Promise<BoothEntryResult<BoothIncome>> {
  const entryDate = input.entryDate ?? today();
  const guard = await guardBoothEntry(userId, boothId, entryDate);
  if (!guard.ok) return guard;

  const category = input.category ?? "storefront";
  const { rows } = await query<BoothIncomeRow>(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, category, payment_method, note, entry_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date)
     RETURNING ${INCOME_RETURN}`,
    [boothId, userId, input.amount.toFixed(2), category, input.paymentMethod, input.note ?? null, entryDate],
  );
  return { ok: true, entry: mapBoothIncome(rows[0]) };
}

export type BoothDaySummary = {
  income: string;
  expense: string;
  profit: string;
};

export async function boothDaySummary(
  userId: string,
  boothId: string,
  date: string,
): Promise<BoothDaySummary | null> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return null;

  const { rows } = await query<{ income: string; expense: string }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND user_id = $2 AND entry_date = $3::date), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND user_id = $2 AND entry_date = $3::date), 0)::text AS expense`,
    [boothId, userId, date],
  );
  const r = rows[0];
  return {
    income: r.income,
    expense: r.expense,
    profit: computeProfit(r.income, r.expense),
  };
}

/** Per-day booth income/expense/profit — all event days filled with zero. */
export async function boothDailyProfitSeries(
  userId: string,
  boothId: string,
): Promise<DailyProfitPoint[]> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return [];

  const start = booth.startDate;
  const end = booth.endDate;

  const { rows } = await query<{ entry_date: string; income: string; expense: string }>(
    `WITH combined AS (
       SELECT entry_date, amount, 'income' AS type FROM booth_income_entries
       WHERE booth_id = $1 AND user_id = $2 AND entry_date >= $3::date AND entry_date <= $4::date
       UNION ALL
       SELECT entry_date, amount, 'expense' AS type FROM booth_expense_entries
       WHERE booth_id = $1 AND user_id = $2 AND entry_date >= $3::date AND entry_date <= $4::date
     )
     SELECT
       to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::text AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::text AS expense
     FROM combined
     GROUP BY entry_date
     ORDER BY entry_date ASC`,
    [boothId, userId, start, end],
  );

  const byDate = new Map(rows.map((r) => [r.entry_date, { income: r.income, expense: r.expense }]));
  const series: DailyProfitPoint[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const row = byDate.get(d) ?? { income: "0.00", expense: "0.00" };
    series.push({
      date: d,
      income: row.income,
      expense: row.expense,
      profit: computeProfit(row.income, row.expense),
    });
  }
  return series;
}

export async function listBoothIncomeByDate(
  userId: string,
  boothId: string,
  date: string,
): Promise<BoothIncome[]> {
  const { rows } = await query<BoothIncomeRow>(
    `SELECT ${INCOME_RETURN}
     FROM booth_income_entries
     WHERE user_id = $1 AND booth_id = $2 AND entry_date = $3::date
     ORDER BY created_at DESC`,
    [userId, boothId, date],
  );
  return rows.map(mapBoothIncome);
}

export async function listBoothExpenseByDate(
  userId: string,
  boothId: string,
  date: string,
): Promise<BoothExpense[]> {
  const { rows } = await query<BoothExpenseRow>(
    `SELECT ${EXPENSE_RETURN}
     FROM booth_expense_entries
     WHERE user_id = $1 AND booth_id = $2 AND entry_date = $3::date
     ORDER BY created_at DESC`,
    [userId, boothId, date],
  );
  return rows.map(mapBoothExpense);
}

export async function listBoothIncome(userId: string, boothId: string): Promise<BoothIncome[]> {
  const { rows } = await query<BoothIncomeRow>(
    `SELECT ${INCOME_RETURN}
     FROM booth_income_entries
     WHERE user_id = $1 AND booth_id = $2
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, boothId],
  );
  return rows.map(mapBoothIncome);
}

export async function deleteBoothIncome(
  userId: string,
  boothId: string,
  entryId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM booth_income_entries WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
    [entryId, boothId, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ---- booth expense ----------------------------------------------------------

export type BoothExpenseInput = {
  amount: number;
  category?: ExpenseCategoryKey;
  /** @deprecated Legacy API — derived from category when omitted. */
  costType?: BoothCostType;
  label?: string;
  note?: string;
  entryDate?: string;
  payerMemberId?: string;
  externalPayerName?: string;
  advancePayment?: boolean;
};

export async function createBoothExpense(
  userId: string,
  boothId: string,
  input: BoothExpenseInput,
): Promise<BoothEntryResult<BoothExpense>> {
  const entryDate = input.entryDate ?? today();
  const guard = await guardBoothEntry(userId, boothId, entryDate);
  if (!guard.ok) return guard;

  const payerMemberId: string | null = input.payerMemberId ?? null;
  const externalTrimmed = input.externalPayerName?.trim() ?? "";
  const externalPayerName = externalTrimmed.length > 0 ? externalTrimmed : null;

  if (payerMemberId && externalPayerName) {
    return { ok: false, reason: "invalid_advance_payer" };
  }

  if (payerMemberId) {
    const valid = await memberBelongsToBooth(boothId, payerMemberId);
    if (!valid) return { ok: false, reason: "invalid_payer" };
  }

  const isAdvance = !!(input.advancePayment || payerMemberId || externalPayerName);
  if (input.advancePayment && !payerMemberId && !externalPayerName) {
    return { ok: false, reason: "invalid_advance_payer" };
  }

  let note = input.note ?? null;
  if (isAdvance && (!note || !note.includes(ADVANCE_NOTE))) {
    note = note ? `${note} · ${ADVANCE_NOTE}` : ADVANCE_NOTE;
  }

  const category =
    input.category !== undefined
      ? normalizeExpenseCategory(input.category)
      : boothCategoryFromCostType(input.costType ?? "variable", input.label);
  const costType: BoothCostType = isFixed(category) ? "fixed" : "variable";

  const { rows } = await query<BoothExpenseRow>(
    `INSERT INTO booth_expense_entries
       (booth_id, user_id, amount, cost_type, category, label, note, payer_member_id, external_payer_name, entry_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date)
     RETURNING ${EXPENSE_RETURN}`,
    [
      boothId,
      userId,
      input.amount.toFixed(2),
      costType,
      category,
      input.label ?? null,
      note,
      payerMemberId,
      externalPayerName,
      entryDate,
    ],
  );
  return { ok: true, entry: mapBoothExpense(rows[0]) };
}

export async function listBoothExpense(userId: string, boothId: string): Promise<BoothExpense[]> {
  const { rows } = await query<BoothExpenseRow>(
    `SELECT ${EXPENSE_RETURN}
     FROM booth_expense_entries
     WHERE user_id = $1 AND booth_id = $2
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, boothId],
  );
  return rows.map(mapBoothExpense);
}

export async function deleteBoothExpense(
  userId: string,
  boothId: string,
  entryId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM booth_expense_entries WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
    [entryId, boothId, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ---- booth members ----------------------------------------------------------

export async function listBoothMembers(userId: string, boothId: string): Promise<BoothMember[]> {
  const { rows } = await query<BoothMemberRow>(
    `SELECT m.id, m.booth_id, m.name, m.role, m.investment_amount,
            m.wage_amount, m.wage_type, m.created_at
     FROM booth_members m JOIN booths b ON b.id = m.booth_id
     WHERE b.user_id = $1 AND m.booth_id = $2
     ORDER BY m.created_at ASC`,
    [userId, boothId],
  );
  return rows.map(mapBoothMember);
}

export type BoothMemberInput = {
  name: string;
  role: MemberRole;
  investmentAmount?: number;
  wageAmount?: number;
  wageType?: WageType;
};

function memberValues(input: BoothMemberInput): {
  investment: string;
  wageAmount: string | null;
  wageType: WageType | null;
} {
  if (input.role === "investor") {
    return {
      investment: (input.investmentAmount ?? 0).toFixed(2),
      wageAmount: null,
      wageType: null,
    };
  }
  if (input.role === "employee") {
    return {
      investment: "0.00",
      wageAmount: (input.wageAmount ?? 0).toFixed(2),
      wageType: input.wageType ?? null,
    };
  }
  return {
    investment: (input.investmentAmount ?? 0).toFixed(2),
    wageAmount:
      input.wageAmount !== undefined ? input.wageAmount.toFixed(2) : null,
    wageType: input.wageType ?? null,
  };
}

export async function createBoothMember(
  userId: string,
  boothId: string,
  input: BoothMemberInput,
): Promise<BoothMemberResult> {
  const guard = await guardBoothMemberWrite(userId, boothId);
  if (!guard.ok) return guard;

  const vals = memberValues(input);

  const { rows } = await query<BoothMemberRow>(
    `INSERT INTO booth_members (booth_id, name, role, investment_amount, wage_amount, wage_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MEMBER_RETURN}`,
    [boothId, input.name, input.role, vals.investment, vals.wageAmount, vals.wageType],
  );

  return { ok: true, member: mapBoothMember(rows[0]) };
}

export async function updateBoothMember(
  userId: string,
  boothId: string,
  memberId: string,
  input: Partial<BoothMemberInput>,
): Promise<BoothMemberResult> {
  const guard = await guardBoothMemberWrite(userId, boothId);
  if (!guard.ok) return guard;

  const allMembers = await listBoothMembers(userId, boothId);
  const existing = allMembers.find((m) => m.id === memberId);
  if (!existing) return { ok: false, reason: "member_not_found" };

  const merged: BoothMemberInput = {
    name: input.name ?? existing.name,
    role: input.role ?? existing.role,
    investmentAmount:
      input.investmentAmount ??
      (existing.investmentAmount ? Number(existing.investmentAmount) : 0),
    wageAmount: input.wageAmount ?? (existing.wageAmount ? Number(existing.wageAmount) : undefined),
    wageType: input.wageType ?? existing.wageType ?? undefined,
  };
  const vals = memberValues(merged);

  const { rows } = await query<BoothMemberRow>(
    `UPDATE booth_members m SET name = $4, role = $5, investment_amount = $6,
       wage_amount = $7, wage_type = $8
     FROM booths b
     WHERE m.id = $3 AND m.booth_id = $2 AND b.id = m.booth_id AND b.user_id = $1
     RETURNING m.id, m.booth_id, m.name, m.role, m.investment_amount,
               m.wage_amount, m.wage_type, m.created_at`,
    [userId, boothId, memberId, merged.name, merged.role, vals.investment, vals.wageAmount, vals.wageType],
  );
  if (!rows[0]) return { ok: false, reason: "member_not_found" };

  return { ok: true, member: mapBoothMember(rows[0]) };
}

export async function deleteBoothMember(
  userId: string,
  boothId: string,
  memberId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM booth_members m USING booths b
     WHERE m.id = $1 AND m.booth_id = $2 AND b.id = m.booth_id AND b.user_id = $3`,
    [memberId, boothId, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ---- profit split (derived) -------------------------------------------------

async function listBoothAdvances(userId: string, boothId: string) {
  const { rows } = await query<{
    creditor_key: string;
    member_id: string | null;
    creditor_name: string;
    amount: string;
    entry_date: string;
    is_external: boolean;
  }>(
    `SELECT e.payer_member_id::text AS creditor_key,
            e.payer_member_id AS member_id,
            m.name AS creditor_name,
            e.amount,
            e.entry_date::text AS entry_date,
            false AS is_external
     FROM booth_expense_entries e
     JOIN booth_members m ON m.id = e.payer_member_id
     JOIN booths b ON b.id = e.booth_id
     WHERE b.user_id = $1 AND e.booth_id = $2 AND e.payer_member_id IS NOT NULL
     UNION ALL
     SELECT ('external:' || NULLIF(btrim(e.external_payer_name), '')) AS creditor_key,
            NULL::uuid AS member_id,
            NULLIF(btrim(e.external_payer_name), '') AS creditor_name,
            e.amount,
            e.entry_date::text AS entry_date,
            true AS is_external
     FROM booth_expense_entries e
     JOIN booths b ON b.id = e.booth_id
     WHERE b.user_id = $1 AND e.booth_id = $2
       AND NULLIF(btrim(e.external_payer_name), '') IS NOT NULL
     ORDER BY entry_date ASC`,
    [userId, boothId],
  );
  return rows.map((r) => ({
    creditorKey: r.creditor_key,
    memberId: r.member_id,
    creditorName: r.creditor_name,
    amount: r.amount,
    entryDate: r.entry_date,
    isExternal: r.is_external,
  }));
}

export async function splitProfit(
  userId: string,
  boothId: string,
): Promise<SplitProfitResult | null> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return null;

  const summary = await boothSummary(userId, boothId);
  if (!summary) return null;

  const members = await listBoothMembers(userId, boothId);
  const advances = await listBoothAdvances(userId, boothId);

  return computeSplitProfit({
    poolBudget: booth.poolBudget,
    poolGetsShare: booth.poolGetsShare,
    profitSplitMethod: booth.profitSplitMethod,
    startDate: booth.startDate,
    endDate: booth.endDate,
    totalIncome: summary.totalIncome,
    totalExpense: summary.entryExpense,
    advances,
    members: members.map(toSplitMemberInput),
  });
}

// ---- booth net for period ---------------------------------------------------

export async function boothNetForPeriod(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<string> {
  const { rows } = await query<{ income: string; expense: string }>(
    `SELECT
       COALESCE((
         SELECT SUM(i.amount)
         FROM booth_income_entries i
         JOIN booths b ON b.id = i.booth_id
         WHERE b.user_id = $1
           AND i.entry_date >= $2::date AND i.entry_date <= $3::date
           AND i.entry_date >= b.start_date AND i.entry_date <= b.end_date
       ), 0)::text AS income,
       COALESCE((
         SELECT SUM(e.amount)
         FROM booth_expense_entries e
         JOIN booths b ON b.id = e.booth_id
         WHERE b.user_id = $1
           AND e.entry_date >= $2::date AND e.entry_date <= $3::date
           AND e.entry_date >= b.start_date AND e.entry_date <= b.end_date
       ), 0)::text AS expense`,
    [userId, periodStart, periodEnd],
  );
  const r = rows[0];
  return computeProfit(r.income, r.expense);
}

// ---- booth summary ----------------------------------------------------------

export async function boothSummary(userId: string, boothId: string): Promise<BoothSummary | null> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return null;

  const members = await listBoothMembers(userId, boothId);
  const eventDays = inclusiveEventDays(booth.startDate, booth.endDate);
  const wageCost = computeWageCost(members.map(toSplitMemberInput), eventDays);

  const [{ rows: incomeRows }, { rows: expenseRows }] = await Promise.all([
    query<{
      cash_income: string;
      transfer_income: string;
      income_count: string;
    }>(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM booth_income_entries
                   WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash_income,
         COALESCE((SELECT SUM(amount) FROM booth_income_entries
                   WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer_income,
         (SELECT COUNT(*) FROM booth_income_entries WHERE booth_id = $1)::text AS income_count`,
      [boothId],
    ),
    query<{ amount: string; category: string }>(
      `SELECT amount, category FROM booth_expense_entries WHERE booth_id = $1`,
      [boothId],
    ),
  ]);
  const r = incomeRows[0];
  const { fixedExpense, variableExpense } = aggregateBoothExpenseTotals(expenseRows);
  const totalIncome = sumDecimals(r.cash_income, r.transfer_income);
  const entryExpense = sumDecimals(fixedExpense, variableExpense);
  const totalExpense = sumDecimals(entryExpense, wageCost);

  return {
    booth,
    cashIncome: r.cash_income,
    transferIncome: r.transfer_income,
    totalIncome,
    fixedExpense,
    variableExpense,
    entryExpense,
    wageCost,
    totalExpense,
    profit: computeProfit(totalIncome, totalExpense),
    incomeCount: Number(r.income_count),
    expenseCount: expenseRows.length,
  };
}

// Legacy aliases
export const addBoothMember = createBoothMember;
