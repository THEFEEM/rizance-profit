/**
 * Test parseUserMessage via dev route POST /api/dev/test-rizq
 * Run: npm run dev (separate terminal) then node scripts/test-rizq-parse.mjs
 */
import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // ignore
  }
}

const BASE = process.env.TEST_RIZQ_URL ?? "http://localhost:3000/api/dev/test-rizq";
const DELAY_MS = Number(process.env.TEST_DELAY_MS ?? 3000);

const CASES = [
  { n: 1, text: "ซื้อกาแฟ 100", expect: "record" },
  { n: 2, text: "ขายของได้ 500", expect: "record" },
  { n: 3, text: "จ่ายค่าไฟ 850", expect: "record" },
  { n: 4, text: "เดือนนี้กำไรเท่าไหร่", expect: "query", period: "month", metric: "summary" },
  { n: 5, text: "เงินคงเหลือเท่าไหร่", expect: "query", metric: "on_hand" },
  { n: 6, text: "วันนี้ขายได้เท่าไหร่", expect: "query", period: "today" },
  { n: 7, text: "จ่ายค่าอะไรบ้าง", expect: "query", metric: "category" },
  { n: 8, text: "สวัสดี", expect: "reply" },
];

function summarize(action) {
  if (action.type === "record") {
    const e = action.entry;
    return {
      type: action.type,
      kind: e.kind,
      amount: e.amount,
      confidence: e.confidence,
      category: e.category,
      reply: e.reply,
    };
  }
  if (action.type === "query") {
    return { type: action.type, period: action.period, metric: action.metric };
  }
  return {
    type: action.type,
    reply: action.reply?.slice(0, 80) + (action.reply?.length > 80 ? "…" : ""),
  };
}

function pass(caseDef, action) {
  if (action.type !== caseDef.expect) return false;
  if (caseDef.expect === "record") {
    return (
      action.entry?.kind &&
      action.entry.amount != null &&
      action.entry.amount > 0 &&
      !action.entry.reply
    );
  }
  if (caseDef.expect === "query") {
    if (caseDef.period && action.period !== caseDef.period) return false;
    if (caseDef.metric && action.metric !== caseDef.metric) return false;
    return true;
  }
  return action.type === "reply";
}

async function parseOne(text) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body.action;
}

const results = [];

for (const c of CASES) {
  if (results.length > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
  try {
    const action = await parseOne(c.text);
    const ok = pass(c, action);
    results.push({ ...c, ok, action: summarize(action) });
    const mark = ok ? "PASS" : "FAIL";
    console.log(`\n${c.n}. "${c.text}" → ${mark}`);
    console.log(JSON.stringify(summarize(action), null, 2));
  } catch (err) {
    results.push({ ...c, ok: false, error: String(err?.message ?? err) });
    console.log(`\n${c.n}. "${c.text}" → ERROR`);
    console.log(err);
  }
}

const recordFails = results.filter((r) => r.expect === "record" && !r.ok);
const totalPass = results.filter((r) => r.ok).length;

console.log("\n--- SUMMARY ---");
console.log(`${totalPass}/${results.length} passed`);
if (recordFails.length > 0) {
  console.log("⚠️ RECORD REGRESSION — cases 1-3 failed (mode AUTO may need prompt fix)");
  for (const r of recordFails) {
    console.log(`  #${r.n} "${r.text}" got type=${r.action?.type ?? "error"}`);
  }
}

process.exit(recordFails.length > 0 ? 1 : 0);
