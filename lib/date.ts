// All "today" / date-boundary logic uses Asia/Bangkok (UTC+7, no DST),
// NOT the server's UTC clock. An owner closing up at 00:30 still sees the
// correct local calendar day.

export const APP_TZ = "Asia/Bangkok";

const isoDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Asia/Bangkok as "YYYY-MM-DD". */
export function today(): string {
  // en-CA formats as YYYY-MM-DD.
  return isoDateFmt.format(new Date());
}

/** Current month in Asia/Bangkok as "YYYY-MM". */
export function currentMonth(): string {
  return today().slice(0, 7);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** True if `s` is a real calendar date in "YYYY-MM-DD" form. */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True if `s` is a valid month in "YYYY-MM" form. */
export function isValidMonth(s: string): boolean {
  if (!MONTH_RE.test(s)) return false;
  const [, m] = s.split("-").map(Number);
  return m >= 1 && m <= 12;
}

/** First and (exclusive) day-after-last date of a "YYYY-MM" month. */
export function monthRange(month: string): { start: string; endExclusive: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endExclusive = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

/** Add `days` to a "YYYY-MM-DD" string, returning "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Add `months` to a "YYYY-MM" string, returning "YYYY-MM". */
export function addMonths(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Human label like "Mon, 8 Jun 2026" for a "YYYY-MM-DD" date. */
export function formatDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dt);
}

/** Short label like "8 Jun" for a "YYYY-MM-DD" date. */
export function formatDayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(dt);
}

/** Human label like "June 2026" for a "YYYY-MM" month. */
export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(dt);
}
