// Exact-decimal money helpers. Money is handled as integer *cents* internally
// for arithmetic so we NEVER route a value through a JS float. Values coming
// from Postgres NUMERIC arrive as strings (see lib/db.ts) and are parsed here.

const CURRENCY_SYMBOLS: Record<string, string> = {
  THB: "฿",
  USD: "$",
  EUR: "€",
  GBP: "£",
  MYR: "RM",
  IDR: "Rp",
  VND: "₫",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? `${currency} `;
}

/**
 * Parse a decimal money string ("1850", "1850.5", "1850.00") into integer cents.
 * Throws on malformed input. Used for DB values and validated user input.
 */
export function toCents(value: string | number): number {
  const s = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid money value: ${value}`);
  }
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [whole, frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = Number(whole) * 100 + Number(fracPadded);
  return negative ? -cents : cents;
}

/** Convert integer cents back to a "1234.56" decimal string. */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Sum any number of decimal money strings, returning a decimal string. */
export function sumDecimals(...values: (string | number)[]): string {
  const total = values.reduce<number>((acc, v) => acc + toCents(v), 0);
  return centsToDecimalString(total);
}

/** income − expense (both decimal strings) → decimal string. Never stored. */
export function computeProfit(income: string | number, expense: string | number): string {
  return centsToDecimalString(toCents(income) - toCents(expense));
}

/** Sign of a money value: 1 positive, -1 negative, 0 zero. */
export function moneySign(value: string | number): -1 | 0 | 1 {
  const c = toCents(value);
  return c > 0 ? 1 : c < 0 ? -1 : 0;
}

/**
 * Format a decimal money string for display: "฿1,210.00", "-฿640.00".
 * Grouping uses Intl on the integer/fraction parts (not on a float).
 */
export function formatMoney(value: string | number, currency = "THB"): string {
  const cents = toCents(value);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = new Intl.NumberFormat("en-US").format(whole);
  return `${negative ? "-" : ""}${currencySymbol(currency)}${grouped}.${frac}`;
}

/** Compact display for inline lines, signed with + / −: "+ ฿420.00". */
export function formatSigned(value: string | number, currency = "THB"): string {
  const cents = toCents(value);
  const sign = cents < 0 ? "− " : "+ ";
  return `${sign}${formatMoney(centsToDecimalString(Math.abs(cents)), currency)}`;
}
