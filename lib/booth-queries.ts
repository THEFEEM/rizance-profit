// Mode Even (booth/event) data access. Booth data lives in separate tables —
// nothing in here touches income_entries / expense_entries, so regular-shop
// queries in lib/queries.ts stay isolated by construction.
import { query } from "@/lib/db";
import { computeProfit, sumDecimals } from "@/lib/money";
import { today } from "@/lib/date";
import type {
  Booth,
  BoothCostType,
  BoothEntryResult,
  BoothExpense,
  BoothIncome,
  BoothMember,
  BoothStatus,
  BoothCloseResult,
  BoothSummary,
  BoothUpdateResult,
  PaymentMethod,
} from "@/types/booth";

// ---- row → domain mappers -------------------------------------------------

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

type BoothRow = {
  id: string;
  name: string;
  starting_budget: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: Date | string | null;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapBooth(r: BoothRow): Booth {
  return {
    id: r.id,
    name: r.name,
    startingBudget: r.starting_budget,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status as BoothStatus,
    closedAt: r.closed_at === null ? null : toIso(r.closed_at),
    note: r.note,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

type BoothIncomeRow = {
  id: string;
  booth_id: string;
  amount: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

function mapBoothIncome(r: BoothIncomeRow): BoothIncome {
  return {
    id: r.id,
    boothId: r.booth_id,
    amount: r.amount,
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
  label: string | null;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

function mapBoothExpense(r: BoothExpenseRow): BoothExpense {
  return {
    id: r.id,
    boothId: r.booth_id,
    amount: r.amount,
    costType: r.cost_type as BoothCostType,
    label: r.label,
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

const BOOTH_COLS = `id, name, starting_budget, start_date::text AS start_date,
  end_date::text AS end_date, status, closed_at, note, created_at, updated_at`;

// ---- booths ----------------------------------------------------------------

export type BoothInput = {
  name: string;
  startingBudget: number;
  startDate: string;
  endDate: string;
  note?: string;
};

export async function listBooths(userId: string): Promise<Booth[]> {
  const { rows } = await query<BoothRow>(
    `SELECT ${BOOTH_COLS} FROM booths
     WHERE user_id = $1
     ORDER BY status ASC, start_date DESC, created_at DESC`,
    [userId],
  );
  return rows.map(mapBooth);
}

export async function getBooth(userId: string, id: string): Promise<Booth | null> {
  const { rows } = await query<BoothRow>(
    `SELECT ${BOOTH_COLS} FROM booths WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return rows[0] ? mapBooth(rows[0]) : null;
}

export async function createBooth(userId: string, input: BoothInput): Promise<Booth> {
  const { rows } = await query<BoothRow>(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date, note)
     VALUES ($1, $2, $3, $4::date, $5::date, $6)
     RETURNING ${BOOTH_COLS}`,
    [
      userId,
      input.name,
      input.startingBudget.toFixed(2),
      input.startDate,
      input.endDate,
      input.note ?? null,
    ],
  );
  return mapBooth(rows[0]);
}

/** Count income + expense rows whose entry_date falls outside [start, end]. */
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
  const rangeNarrowed =
    newStart > existing.startDate || newEnd < existing.endDate;

  if (rangeNarrowed) {
    const outside = await countBoothEntriesOutsideRange(id, newStart, newEnd);
    if (outside > 0) {
      return { ok: false, reason: "entries_outside_new_range", count: outside };
    }
  }

  const { rows } = await query<BoothRow>(
    `UPDATE booths SET name = $3, starting_budget = $4, start_date = $5::date,
       end_date = $6::date, note = $7, updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status = 'open'
     RETURNING ${BOOTH_COLS}`,
    [
      userId,
      id,
      input.name ?? existing.name,
      (input.startingBudget ?? Number(existing.startingBudget)).toFixed(2),
      newStart,
      newEnd,
      input.note !== undefined ? input.note : existing.note,
    ],
  );
  if (!rows[0]) return { ok: false, reason: "booth_not_found" };
  return { ok: true, booth: mapBooth(rows[0]) };
}

/** Close a booth (permanent in v1). No reopen — double-close returns already_closed. */
export async function closeBooth(userId: string, id: string): Promise<BoothCloseResult> {
  const existing = await getBooth(userId, id);
  if (!existing) return { ok: false, reason: "booth_not_found" };
  if (existing.status === "closed") return { ok: false, reason: "already_closed" };

  const { rows } = await query<BoothRow>(
    `UPDATE booths SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status = 'open'
     RETURNING ${BOOTH_COLS}`,
    [userId, id],
  );
  if (!rows[0]) return { ok: false, reason: "already_closed" };
  return { ok: true, booth: mapBooth(rows[0]) };
}

// ---- entry-date rule (app layer) -------------------------------------------
// entry_date must fall within booth.start_date..end_date AND the booth must be
// open. Enforced HERE (not a DB constraint) because booth dates are editable
// while open — a CHECK against another table isn't possible in Postgres, and a
// trigger would hide business logic away from the codebase conventions.

function dateWithinBooth(booth: Booth, entryDate: string): boolean {
  return entryDate >= booth.startDate && entryDate <= booth.endDate;
}

async function guardBoothEntry(
  userId: string,
  boothId: string,
  entryDate: string,
): Promise<{ ok: true; booth: Booth } | { ok: false; reason: "booth_not_found" | "booth_closed" | "date_out_of_range" }> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return { ok: false, reason: "booth_not_found" };
  if (booth.status !== "open") return { ok: false, reason: "booth_closed" };
  if (!dateWithinBooth(booth, entryDate)) return { ok: false, reason: "date_out_of_range" };
  return { ok: true, booth };
}

// ---- booth income -----------------------------------------------------------

export type BoothIncomeInput = {
  amount: number;
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

  const { rows } = await query<BoothIncomeRow>(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, note, entry_date)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     RETURNING id, booth_id, amount, payment_method, note, entry_date::text AS entry_date, created_at`,
    [boothId, userId, input.amount.toFixed(2), input.paymentMethod, input.note ?? null, entryDate],
  );
  return { ok: true, entry: mapBoothIncome(rows[0]) };
}

export async function listBoothIncome(userId: string, boothId: string): Promise<BoothIncome[]> {
  const { rows } = await query<BoothIncomeRow>(
    `SELECT id, booth_id, amount, payment_method, note, entry_date::text AS entry_date, created_at
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
  costType: BoothCostType;
  label?: string;
  note?: string;
  entryDate?: string;
};

export async function createBoothExpense(
  userId: string,
  boothId: string,
  input: BoothExpenseInput,
): Promise<BoothEntryResult<BoothExpense>> {
  const entryDate = input.entryDate ?? today();
  const guard = await guardBoothEntry(userId, boothId, entryDate);
  if (!guard.ok) return guard;

  const { rows } = await query<BoothExpenseRow>(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, label, note, entry_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date)
     RETURNING id, booth_id, amount, cost_type, label, note, entry_date::text AS entry_date, created_at`,
    [
      boothId,
      userId,
      input.amount.toFixed(2),
      input.costType,
      input.label ?? null,
      input.note ?? null,
      entryDate,
    ],
  );
  return { ok: true, entry: mapBoothExpense(rows[0]) };
}

export async function listBoothExpense(userId: string, boothId: string): Promise<BoothExpense[]> {
  const { rows } = await query<BoothExpenseRow>(
    `SELECT id, booth_id, amount, cost_type, label, note, entry_date::text AS entry_date, created_at
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
  const { rows } = await query<{
    id: string;
    booth_id: string;
    name: string;
    role: string | null;
    created_at: Date | string;
  }>(
    `SELECT m.id, m.booth_id, m.name, m.role, m.created_at
     FROM booth_members m JOIN booths b ON b.id = m.booth_id
     WHERE b.user_id = $1 AND m.booth_id = $2
     ORDER BY m.created_at ASC`,
    [userId, boothId],
  );
  return rows.map((r) => ({
    id: r.id,
    boothId: r.booth_id,
    name: r.name,
    role: r.role,
    createdAt: toIso(r.created_at),
  }));
}

export async function addBoothMember(
  userId: string,
  boothId: string,
  input: { name: string; role?: string },
): Promise<BoothMember | null> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return null;
  const { rows } = await query<{
    id: string;
    booth_id: string;
    name: string;
    role: string | null;
    created_at: Date | string;
  }>(
    `INSERT INTO booth_members (booth_id, name, role)
     VALUES ($1, $2, $3)
     RETURNING id, booth_id, name, role, created_at`,
    [boothId, input.name, input.role ?? null],
  );
  const r = rows[0];
  return { id: r.id, boothId: r.booth_id, name: r.name, role: r.role, createdAt: toIso(r.created_at) };
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

// ---- booth summary (fully derived, never stored) ----------------------------

export async function boothSummary(userId: string, boothId: string): Promise<BoothSummary | null> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return null;

  const { rows } = await query<{
    cash_income: string;
    transfer_income: string;
    fixed_expense: string;
    variable_expense: string;
    income_count: string;
    expense_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash_income,
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer_income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'fixed'), 0)::text AS fixed_expense,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'variable'), 0)::text AS variable_expense,
       (SELECT COUNT(*) FROM booth_income_entries  WHERE booth_id = $1)::text AS income_count,
       (SELECT COUNT(*) FROM booth_expense_entries WHERE booth_id = $1)::text AS expense_count`,
    [boothId],
  );
  const r = rows[0];
  const totalIncome = sumDecimals(r.cash_income, r.transfer_income);
  const totalExpense = sumDecimals(r.fixed_expense, r.variable_expense);

  return {
    booth,
    cashIncome: r.cash_income,
    transferIncome: r.transfer_income,
    totalIncome,
    fixedExpense: r.fixed_expense,
    variableExpense: r.variable_expense,
    totalExpense,
    profit: computeProfit(totalIncome, totalExpense),
    incomeCount: Number(r.income_count),
    expenseCount: Number(r.expense_count),
  };
}
