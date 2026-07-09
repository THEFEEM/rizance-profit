/**
 * Production regression after POS .app migration (section E).
 * Run: $env:NODE_TLS_REJECT_UNAUTHORIZED='0'; node scripts/prod-pos-app-regression.mjs
 */
import { chromium } from "../node_modules/playwright/index.mjs";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT_APP = "https://rizance.app";
const PROFIT_COM = "https://www.rizance.com";
const POS = "https://pos.rizance.app";

function loadDbUrl() {
  const envPath = join(__dirname, "..", ".env.local");
  const text = readFileSync(envPath, "utf8");
  const dbUrl = text.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!dbUrl) throw new Error("DATABASE_URL not in .env.local");
  return dbUrl;
}

async function upgradeBusiness(email) {
  const c = new pg.Client({ connectionString: loadDbUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = now() + interval '30 days' WHERE email = $1`,
    [email],
  );
  const { rows } = await c.query(`SELECT id::text FROM users WHERE email = $1`, [email]);
  await c.end();
  return rows[0]?.id;
}

const results = [];
const pass = (n, d = "") => { results.push({ n, ok: true }); console.log(`PASS ${n}${d ? `: ${d}` : ""}`); };
const fail = (n, d) => { results.push({ n, ok: false }); console.log(`FAIL ${n}: ${d}`); };

const stamp = Date.now();
const emailApp = `pos-e2e-app-${stamp}@rizance.test`;
const emailCom = `pos-e2e-com-${stamp}@rizance.test`;
const password = `E2e${stamp}!`;
const productName = `E2E Product ${stamp}`;

const browser = await chromium.launch({ headless: true });

try {
  // --- E1: cross-subdomain session ---
  console.log("\n=== E1: login rizance.app → pos.rizance.app ===");
  const ctx = await browser.newContext();
  const profitPage = await ctx.newPage();

  await profitPage.goto(PROFIT_APP);
  const regOk = await profitPage.evaluate(
    async ({ email, password }) => {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, shopName: "E2E App Shop", mode: "regular" }),
      });
      return r.ok;
    },
    { email: emailApp, password },
  );
  if (!regOk) fail("e1_register", "register failed");
  else pass("e1_register");

  const userId = await upgradeBusiness(emailApp);
  if (!userId) fail("e1_business", "no user id");
  else pass("e1_business", userId);

  await profitPage.evaluate(
    async ({ productName }) => {
      const res = await fetch("/api/pos/products", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: productName,
          sellPrice: 50,
          unit: "ชิ้น",
          trackStock: false,
        }),
      });
      if (!res.ok) throw new Error(`product ${res.status}`);
    },
    { productName },
  );

  const posPage = await ctx.newPage();
  await posPage.goto(POS);
  await posPage.waitForLoadState("networkidle");
  try {
    await posPage.waitForSelector("text=E2E App Shop", { timeout: 25000 });
    pass("e1_pos_session", "sell page loaded without re-login");
  } catch {
    const url = posPage.url();
    fail("e1_pos_session", `expected shop name, url=${url}`);
  }

  // --- E3: sell 1 cash bill via API (same browser context) ---
  console.log("\n=== E3: sell cash bill + DB ===");
  const billResult = await profitPage.evaluate(
    async ({ productName }) => {
      const cat = await fetch("/api/pos/products", { credentials: "include" }).then((r) => r.json());
      const products = cat.data?.products ?? cat.data ?? [];
      const list = Array.isArray(products) ? products : [];
      const product = list.find((p) => p.name === productName);
      if (!product) return { ok: false, err: "product not in catalog", keys: Object.keys(cat) };
      const res = await fetch("/api/pos/bills", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: product.id, qty: 1 }],
          paymentMethod: "cash",
        }),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    },
    { productName },
  );

  let billId = null;
  const billPayload = billResult.body?.data?.bill;
  if (billResult.ok && billPayload?.id) {
    billId = billPayload.id;
    pass("e3_close_bill", `bill ${billPayload.billNo ?? billId}`);
  } else if (billResult.ok && billResult.body?.data?.id) {
    billId = billResult.body.data.id;
    pass("e3_close_bill", `bill ${billResult.body.data.billNo ?? billId}`);
  } else {
    fail("e3_close_bill", JSON.stringify(billResult));
  }

  if (billId && userId) {
    const c = new pg.Client({ connectionString: loadDbUrl(), ssl: { rejectUnauthorized: false } });
    await c.connect();
    const bill = await c.query(
      `SELECT status, total_amount::text, income_entry_id FROM pos_bills WHERE id = $1 AND user_id = $2`,
      [billId, userId],
    );
    const incomeId = bill.rows[0]?.income_entry_id;
    const income = incomeId
      ? await c.query(`SELECT id, voided_at FROM income_entries WHERE id = $1`, [incomeId])
      : { rows: [] };
    const journal = await c.query(
      `SELECT je.id FROM journal_entries je
       WHERE je.source_module = 'pos' AND je.source_event_id = $1 AND je.source_event_type = 'pos_bill_paid'`,
      [billId],
    );
    const tb = await c.query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS sum
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1`,
      [userId],
    );
    await c.end();

    if (bill.rows[0]?.status === "paid") pass("e3_db_bill", `total=${bill.rows[0].total_amount}`);
    else fail("e3_db_bill", bill.rows[0] ? `status=${bill.rows[0].status}` : "no bill row");

    if (income.rows.length === 1 && !income.rows[0].voided_at) pass("e3_db_income", income.rows[0].id);
    else fail("e3_db_income", `rows=${income.rows.length}`);

    if (journal.rows.length >= 1) pass("e3_db_journal", `${journal.rows.length} entries`);
    else fail("e3_db_journal", "no journal");

    const sum = Number(tb.rows[0]?.sum ?? "nan");
    if (Math.abs(sum) < 0.01) pass("e3_trial_balance", `SUM=${sum}`);
    else fail("e3_trial_balance", `SUM=${sum}`);
  }

  // --- E4: void bill ---
  console.log("\n=== E4: void bill + soft-void ===");
  if (billId) {
    const voidResult = await profitPage.evaluate(
      async ({ billId }) => {
        const res = await fetch(`/api/pos/bills/${billId}/void`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "e2e migration test void" }),
        });
        const body = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, body };
      },
      { billId },
    );
    if (voidResult.ok) pass("e4_void_api", `status ${voidResult.status}`);
    else fail("e4_void_api", JSON.stringify(voidResult));

    const c = new pg.Client({ connectionString: loadDbUrl(), ssl: { rejectUnauthorized: false } });
    await c.connect();
    const bill = await c.query(`SELECT status, voided_at, income_entry_id FROM pos_bills WHERE id = $1`, [billId]);
    const incomeId = bill.rows[0]?.income_entry_id;
    const income = incomeId
      ? await c.query(`SELECT voided_at IS NOT NULL AS voided FROM income_entries WHERE id = $1`, [incomeId])
      : { rows: [] };
    const reversal = await c.query(
      `SELECT COUNT(*)::int AS n FROM journal_entries
       WHERE source_module = 'pos' AND source_event_id = $1 AND source_event_type = 'pos_bill_paid_reversal'`,
      [billId],
    );
    await c.end();

    if (bill.rows[0]?.status === "voided" && bill.rows[0].voided_at) pass("e4_db_bill_voided");
    else fail("e4_db_bill_voided", JSON.stringify(bill.rows[0]));

    if (income.rows[0]?.voided) pass("e4_db_income_soft_void");
    else fail("e4_db_income_soft_void", JSON.stringify(income.rows[0]));

    if (reversal.rows[0]?.n >= 1) pass("e4_db_journal_reversal", `n=${reversal.rows[0].n}`);
    else fail("e4_db_journal_reversal", "no reversal entry");
  }

  await ctx.close();

  // --- E2: www.rizance.com login/logout (separate context) ---
  console.log("\n=== E2: www.rizance.com login/logout ===");
  const ctxCom = await browser.newContext();
  const comPage = await ctxCom.newPage();
  await comPage.goto(PROFIT_COM);

  const comReg = await comPage.evaluate(
    async ({ email, password }) => {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, shopName: "E2E Com Shop", mode: "personal" }),
      });
      return r.status;
    },
    { email: emailCom, password },
  );
  if (comReg === 200 || comReg === 201) pass("e2_register_com", `status ${comReg}`);
  else fail("e2_register_com", `status ${comReg}`);

  const homeRes = await comPage.goto(`${PROFIT_COM}/home`, { waitUntil: "networkidle" });
  const homeUrl = comPage.url();
  if (homeRes?.ok() && !homeUrl.includes("/login")) pass("e2_home_after_login", homeUrl);
  else fail("e2_home_after_login", `url=${homeUrl}`);

  const logoutOk = await comPage.evaluate(async () => {
    const r = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    return r.ok;
  });
  if (logoutOk) pass("e2_logout");
  else fail("e2_logout", "logout API failed");

  await comPage.goto(`${PROFIT_COM}/home`, { waitUntil: "networkidle" });
  const afterLogout = comPage.url();
  if (afterLogout.includes("/login")) pass("e2_redirect_login", afterLogout);
  else fail("e2_redirect_login", `url=${afterLogout}`);

  await ctxCom.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
