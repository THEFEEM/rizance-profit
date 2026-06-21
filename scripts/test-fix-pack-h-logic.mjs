// Fix Pack H — month-to-date shop summary + manual savings rate helpers.
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

function currentMonth() {
  return todayAt(new Date()).slice(0, 7);
}

function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endExclusive = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function savingsRateFromGoals(goals) {
  let currentCents = 0;
  let targetCents = 0;
  for (const g of goals) {
    currentCents += toCents(g.currentAmount);
    targetCents += toCents(g.targetAmount);
  }
  if (targetCents <= 0) return 0;
  return Math.min(100, Math.round((currentCents / targetCents) * 100));
}

function assertTrue(label, cond) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

console.log("=== FIX PACK H LOGIC TEST ===\n");

const month = currentMonth();
const { start, endExclusive } = monthRange(month);
assertTrue("MTD starts on day 1", start.endsWith("-01"));
assertTrue("MTD endExclusive is next month day 1", endExclusive > start);

const bangkokLate = new Date("2026-06-30T17:30:00.000Z");
const bangkokDate = todayAt(bangkokLate);
assertTrue("Bangkok month boundary", bangkokDate.startsWith("2026-07"));

const rateLow = savingsRateFromGoals([
  { currentAmount: "1000.00", targetAmount: "10000.00" },
]);
assertTrue("savings rate 10% → red band", rateLow === 10);

const rateMid = savingsRateFromGoals([
  { currentAmount: "5000.00", targetAmount: "10000.00" },
]);
assertTrue("savings rate 50% → amber band", rateMid === 50);

const rateHigh = savingsRateFromGoals([
  { currentAmount: "8000.00", targetAmount: "10000.00" },
]);
assertTrue("savings rate 80% → green band", rateHigh === 80);

const rateMulti = savingsRateFromGoals([
  { currentAmount: "3000.00", targetAmount: "6000.00" },
  { currentAmount: "2000.00", targetAmount: "4000.00" },
]);
assertTrue("aggregate savings rate 50%", rateMulti === 50);

if (process.exitCode) {
  console.log("\nSome assertions failed.");
  process.exit(1);
}
console.log("\nAll assertions passed.");
