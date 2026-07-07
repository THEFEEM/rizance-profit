import type { PoolClient } from "pg";
import { toCents } from "@/lib/money";

export type JournalLineInput = {
  accountCode: string;
  debit: string | number;
  credit: string | number;
};

export type PostJournalEntryParams = {
  userId: string;
  entryDate: string;
  description: string;
  sourceModule: string;
  sourceEventId: string;
  sourceEventType: string;
  lines: JournalLineInput[];
};

export type JournalEntry = {
  id: string;
  userId: string;
  entryDate: string;
  description: string;
  sourceModule: string;
  sourceEventId: string;
  sourceEventType: string;
  reversedByEntryId: string | null;
  createdAt: Date | string;
};

type JournalEntryRow = {
  id: string;
  user_id: string;
  entry_date: string;
  description: string;
  source_module: string;
  source_event_id: string;
  source_event_type: string;
  reversed_by_entry_id: string | null;
  created_at: Date | string;
};

type JournalLineRow = {
  account_code: string;
  debit: string;
  credit: string;
};

export class JournalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalValidationError";
  }
}

export class JournalDuplicatePostingError extends Error {
  constructor(
    public sourceModule: string,
    public sourceEventId: string,
    public sourceEventType: string,
  ) {
    super("journal entry already posted for this source event");
    this.name = "JournalDuplicatePostingError";
  }
}

export class JournalEntryNotFoundError extends Error {
  constructor(public entryId: string) {
    super("journal entry not found");
    this.name = "JournalEntryNotFoundError";
  }
}

function lineAmountCents(value: string | number): number {
  const cents = toCents(value);
  if (cents < 0) {
    throw new JournalValidationError("debit and credit must be non-negative");
  }
  return cents;
}

function isValidLine(line: JournalLineInput): boolean {
  const debitCents = lineAmountCents(line.debit);
  const creditCents = lineAmountCents(line.credit);
  return (debitCents > 0 && creditCents === 0) || (creditCents > 0 && debitCents === 0);
}

/** Fail-fast validation before any DB write. */
export function validateJournalLines(lines: JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new JournalValidationError("journal entry requires at least two lines");
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    if (!line.accountCode?.trim()) {
      throw new JournalValidationError("every line requires an account code");
    }
    if (!isValidLine(line)) {
      throw new JournalValidationError(
        "each line must have exactly one of debit or credit greater than zero",
      );
    }
    totalDebit += lineAmountCents(line.debit);
    totalCredit += lineAmountCents(line.credit);
  }

  if (totalDebit !== totalCredit) {
    throw new JournalValidationError("total debits must equal total credits");
  }
}

function mapEntryRow(row: JournalEntryRow): JournalEntry {
  return {
    id: row.id,
    userId: row.user_id,
    entryDate: row.entry_date,
    description: row.description,
    sourceModule: row.source_module,
    sourceEventId: row.source_event_id,
    sourceEventType: row.source_event_type,
    reversedByEntryId: row.reversed_by_entry_id,
    createdAt: row.created_at,
  };
}

function isDuplicatePostingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === "23505" && pgErr.constraint === "idx_journal_source_unique";
}

export async function postJournalEntry(
  client: PoolClient,
  params: PostJournalEntryParams,
): Promise<JournalEntry> {
  validateJournalLines(params.lines);

  try {
    const { rows } = await client.query<JournalEntryRow>(
      `INSERT INTO journal_entries (
         user_id, entry_date, description,
         source_module, source_event_id, source_event_type
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.userId,
        params.entryDate,
        params.description,
        params.sourceModule,
        params.sourceEventId,
        params.sourceEventType,
      ],
    );

    const entry = rows[0];
    if (!entry) {
      throw new Error("journal entry insert returned no row");
    }

    for (const line of params.lines) {
      await client.query(
        `INSERT INTO journal_lines (entry_id, account_code, debit, credit)
         VALUES ($1, $2, $3, $4)`,
        [entry.id, line.accountCode, line.debit, line.credit],
      );
    }

    return mapEntryRow(entry);
  } catch (err) {
    if (isDuplicatePostingError(err)) {
      throw new JournalDuplicatePostingError(
        params.sourceModule,
        params.sourceEventId,
        params.sourceEventType,
      );
    }
    throw err;
  }
}

export async function reverseJournalEntry(
  client: PoolClient,
  originalEntryId: string,
  params: { description: string },
): Promise<JournalEntry> {
  const { rows: entryRows } = await client.query<JournalEntryRow>(
    `SELECT * FROM journal_entries WHERE id = $1`,
    [originalEntryId],
  );
  const original = entryRows[0];
  if (!original) {
    throw new JournalEntryNotFoundError(originalEntryId);
  }

  const { rows: lineRows } = await client.query<JournalLineRow>(
    `SELECT account_code, debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY id`,
    [originalEntryId],
  );

  if (lineRows.length === 0) {
    throw new JournalValidationError("original journal entry has no lines");
  }

  const reversedLines: JournalLineInput[] = lineRows.map((line) => ({
    accountCode: line.account_code,
    debit: line.credit,
    credit: line.debit,
  }));

  const reversal = await postJournalEntry(client, {
    userId: original.user_id,
    entryDate: original.entry_date,
    description: params.description,
    sourceModule: original.source_module,
    sourceEventId: original.source_event_id,
    sourceEventType: `${original.source_event_type}_reversal`,
    lines: reversedLines,
  });

  await client.query(
    `UPDATE journal_entries SET reversed_by_entry_id = $1 WHERE id = $2`,
    [reversal.id, originalEntryId],
  );

  return reversal;
}
