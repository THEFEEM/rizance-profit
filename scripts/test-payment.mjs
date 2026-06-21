// E8.2 — server-side tier pricing (keep in sync with lib/pricing.ts getTierPlan).
// Usage: npm run test:payment
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // optional
  }
}

const SUBSCRIPTION_PLANS = [
  { tier: "event_pass", periodDays: 7, priceBaht: 39 },
  { tier: "business", periodDays: 30, priceBaht: 59 },
  { tier: "business_pro", periodDays: 30, priceBaht: 99 },
  { tier: "org_lite", periodDays: 30, priceBaht: 199 },
  { tier: "org_pro", periodDays: 30, priceBaht: 399 },
  { tier: "org_pro", periodDays: 365, priceBaht: 3990 },
];

const PAID_TIERS = new Set([
  "event_pass",
  "business",
  "business_pro",
  "org_lite",
  "org_pro",
]);

function isPaidSubscriptionTier(tier) {
  return PAID_TIERS.has(tier);
}

function findPlan(tier, periodDays) {
  return SUBSCRIPTION_PLANS.find((p) => p.tier === tier && p.periodDays === periodDays);
}

function getTierPlan(tier, cycle = "period") {
  if (!isPaidSubscriptionTier(tier)) {
    throw new Error(`Invalid subscription tier: ${tier}`);
  }
  if (cycle === "year") {
    if (tier !== "org_pro") throw new Error(`Annual billing not available for tier: ${tier}`);
    const annual = findPlan("org_pro", 365);
    if (!annual) throw new Error(`No annual plan for tier: ${tier}`);
    return { amountTHB: annual.priceBaht, periodDays: annual.periodDays };
  }
  const monthly = SUBSCRIPTION_PLANS.find((p) => p.tier === tier && p.periodDays !== 365);
  if (!monthly) throw new Error(`Invalid subscription tier: ${tier}`);
  return { amountTHB: monthly.priceBaht, periodDays: monthly.periodDays };
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

function assertEq(label, actual, expected) {
  return assertTrue(label, actual === expected);
}

function assertThrows(label, fn) {
  try {
    fn();
    console.error(`✗ ${label} (expected throw)`);
    process.exitCode = 1;
    return false;
  } catch {
    console.log(`✓ ${label}`);
    return true;
  }
}

console.log("=== E8.2 PAYMENT PRICING TEST ===\n");

const event = getTierPlan("event_pass");
assertEq("event_pass amount", event.amountTHB, 39);
assertEq("event_pass days", event.periodDays, 7);

const business = getTierPlan("business");
assertEq("business amount", business.amountTHB, 59);
assertEq("business days", business.periodDays, 30);

const orgPro = getTierPlan("org_pro");
assertEq("org_pro monthly amount", orgPro.amountTHB, 399);
assertEq("org_pro monthly days", orgPro.periodDays, 30);

const orgProYear = getTierPlan("org_pro", "year");
assertEq("org_pro annual amount", orgProYear.amountTHB, 3990);
assertEq("org_pro annual days", orgProYear.periodDays, 365);

assertThrows("free tier rejected", () => getTierPlan("free"));
assertThrows("unknown tier rejected", () => getTierPlan("vip"));
assertThrows("annual only for org_pro", () => getTierPlan("business", "year"));

// Omise satang conversion sanity
assertEq("satang = baht * 100", getTierPlan("event_pass").amountTHB * 100, 3900);

if (process.exitCode) {
  console.log("\nSome assertions failed.");
  process.exit(1);
}
console.log("\nAll assertions passed.");
