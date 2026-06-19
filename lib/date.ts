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
  return todayAt(new Date());
}

/** Calendar date in Asia/Bangkok for an arbitrary instant (used in tests). */
export function todayAt(instant: Date): string {
  return isoDateFmt.format(instant);
}

/** What Postgres CURRENT_DATE would be if the server clock is UTC. */
export function utcCalendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
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

/** Clamp a calendar date to an inclusive [start, end] range. */
export function clampDateToRange(date: string, start: string, end: string): string {
  if (date < start) return start;
  if (date > end) return end;
  return date;
}

/** Default entry date for a booth: Bangkok today, clamped to the event range. */
export function defaultBoothEntryDate(startDate: string, endDate: string): string {
  return clampDateToRange(today(), startDate, endDate);
}

/** Default entry date for a project activity: Bangkok today, clamped when dates exist. */
export function defaultProjectEntryDate(
  startDate: string | null,
  endDate: string | null,
): string {
  const t = today();
  if (startDate && endDate) return clampDateToRange(t, startDate, endDate);
  if (startDate && t < startDate) return startDate;
  if (endDate && t > endDate) return endDate;
  return t;
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

/** Single-letter Thai weekday (อา จ อ พ พฤ ศ ส) for chart axis labels. */
const THAI_WEEKDAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

export function formatWeekdayShortThai(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return THAI_WEEKDAY_SHORT[dt.getUTCDay()];
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

export const PERIOD_KEYS = ["today", "month", "last_7", "last_14", "last_30"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "วันนี้",
  month: "เดือนนี้",
  last_7: "7 วัน",
  last_14: "14 วัน",
  last_30: "30 วัน",
};

export function isValidPeriod(s: string): s is PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(s);
}

/**
 * Inclusive date range for a summary period, anchored to a Bangkok calendar day.
 * - month: calendar month-to-date (1st → anchor)
 * - last_N: rolling N calendar days inclusive of anchor (last_7 = anchor − 6 days … anchor)
 */
export function periodRange(
  period: PeriodKey,
  anchor: string = today(),
): { period: PeriodKey; start: string; end: string } {
  const end = anchor;
  let start: string;
  switch (period) {
    case "today":
      start = anchor;
      break;
    case "month":
      start = `${anchor.slice(0, 7)}-01`;
      break;
    case "last_7":
      start = addDays(anchor, -6);
      break;
    case "last_14":
      start = addDays(anchor, -13);
      break;
    case "last_30":
      start = addDays(anchor, -29);
      break;
    default:
      start = anchor;
  }
  return { period, start, end };
}

/** Short Thai-friendly range label for period summaries. */
export function formatPeriodRangeLabel(start: string, end: string): string {
  if (start === end) return formatDateLabel(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth) {
    return `${Number(start.slice(8, 10))}–${formatDayShort(end)}`;
  }
  return `${formatDayShort(start)} – ${formatDayShort(end)}`;
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
