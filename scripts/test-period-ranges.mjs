// Period range correctness (Asia/Bangkok boundaries, MTD vs rolling windows).
// Usage: npm run test:period-ranges
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local only if we add DB tests later; pure date math needs no DB.
for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // skip
  }
}

/** Keep in sync with lib/date.ts */
const APP_TZ = "Asia/Bangkok";
const bkkFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayAt(instant) {
  return bkkFmt.format(instant);
}

function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function periodRange(period, anchor) {
  const end = anchor;
  let start;
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

function daysInclusive(start, end) {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

let failed = 0;

function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

console.log("=== PERIOD RANGE TEST ===\n");

const anchor = "2026-06-08";

const month = periodRange("month", anchor);
assert("month MTD start", month.start === "2026-06-01");
assert("month MTD end", month.end === "2026-06-08");

const last30 = periodRange("last_30", anchor);
assert("last_30 start", last30.start === "2026-05-10", `got ${last30.start}`);
assert("last_30 end", last30.end === "2026-06-08");

assert("month ≠ last_30 range", month.start !== last30.start || month.end !== last30.end);

const last7 = periodRange("last_7", anchor);
assert("last_7 start", last7.start === "2026-06-02");
assert("last_7 end", last7.end === anchor);
assert("last_7 is 7 days inclusive", daysInclusive(last7.start, last7.end) === 7);

const last14 = periodRange("last_14", anchor);
assert("last_14 is 14 days inclusive", daysInclusive(last14.start, last14.end) === 14);

const last30days = daysInclusive(last30.start, last30.end);
assert("last_30 is 30 days inclusive", last30days === 30);

// Bangkok "today" at 00:30 local should be next calendar day vs UTC
const at0030Bkk = new Date("2026-06-08T17:30:00.000Z");
const bkkDay = todayAt(at0030Bkk);
const utcDay = at0030Bkk.toISOString().slice(0, 10);
assert("Bangkok day at 00:30 local", bkkDay === "2026-06-09", `got ${bkkDay}`);
assert("UTC day differs at 00:30 BKK", utcDay !== bkkDay, `both ${utcDay}`);

console.log("");
if (failed === 0) {
  console.log("All assertions passed.");
} else {
  console.error(`${failed} assertion(s) FAILED.`);
  process.exitCode = 1;
}
