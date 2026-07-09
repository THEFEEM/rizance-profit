/** Temporary flags — flip to re-enable UI without hunting call sites. */

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "true" || raw === "1";
}

/** Partner list + equity/profit-split UI (member names, investment, share ratio). */
export const SHOW_PARTNERS_SECTION = true;

/** Capital ledger UI: add/withdraw capital, profit withdrawals, "กำลังคืนทุน" banner. */
export const SHOW_CAPITAL_WITHDRAWAL = false;

/** Personal mode tiles, switcher, and routes (existing users with data keep access). */
export const SHOW_PERSONAL_MODE = envFlag("SHOW_PERSONAL_MODE", false);

/** Org/project mode tiles, switcher, and routes (existing users with data keep access). */
export const SHOW_ORG_MODE = envFlag("SHOW_ORG_MODE", false);
