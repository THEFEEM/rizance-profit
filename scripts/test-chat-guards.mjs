// Simulates handler decision (mirrors app/api/chat/route.ts) on test-parse output.
const BASE = process.env.TEST_PARSE_URL ?? "http://localhost:3000/api/ai/test-parse";
const DELAY_MS = Number(process.env.TEST_DELAY_MS ?? 4000);

function handlerDecision(result) {
  if (result.error) {
    return { wouldRecord: false, reason: "system-error", message: "ตอนนี้ใช้งานไม่ได้..." };
  }
  if (result.reply) {
    return { wouldRecord: false, reason: "reply", message: result.reply };
  }
  if (!result.kind || result.amount == null || result.amount <= 0) {
    return { wouldRecord: false, reason: "amount/kind", message: "fallback จำนวน" };
  }
  if (result.confidence === "low") {
    return {
      wouldRecord: false,
      reason: "confidence-low",
      message: "ไม่แน่ใจว่าจะบันทึกอะไร...",
    };
  }
  return {
    wouldRecord: true,
    reason: "record",
    message: `การ์ด ${result.kind} ฿${result.amount}`,
  };
}

async function parseOne(text) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.json();
  if (!res.ok) {
    return { text, error: body, wouldRecord: false, reason: "http-error" };
  }
  const decision = handlerDecision(body.result);
  return { text, result: body.result, ...decision };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function printRow(label, out) {
  const r = out.result ?? {};
  console.log(`\n--- ${label} ---`);
  if (out.error) {
    console.log("ERROR:", JSON.stringify(out.error));
    return;
  }
  console.log(
    JSON.stringify(
      {
        wouldRecord: out.wouldRecord,
        reason: out.reason,
        kind: r.kind,
        amount: r.amount,
        confidence: r.confidence,
        reply: r.reply,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const mode = process.argv[2] ?? "all";

  if (mode === "greeting" || mode === "all") {
    console.log("\n========== สวัสดี x6 ==========");
    for (let i = 1; i <= 6; i++) {
      const out = await parseOne("สวัสดี");
      printRow(`รอบ ${i}`, out);
      if (out.wouldRecord) {
        console.error("FAIL: รอบนี้จดหลุด!");
        process.exitCode = 1;
      }
      if (i < 6) await sleep(DELAY_MS);
    }
  }

  if (mode === "ambiguous" || mode === "all") {
    console.log("\n========== ก้ำกึ่ง (ต้องไม่จด) ==========");
    for (const text of ["ครับ", "ขอบคุณ", "วันนี้อากาศดี", "เท่าไหร่"]) {
      const out = await parseOne(text);
      printRow(text, out);
      if (out.wouldRecord) {
        console.error(`FAIL: "${text}" จดหลุด!`);
        process.exitCode = 1;
      }
      await sleep(DELAY_MS);
    }
  }

  if (mode === "real" || mode === "all") {
    console.log("\n========== ของจริง (ต้องจด) ==========");
    for (const text of ["ซื้อกาแฟ 100", "จ่ายค่าไฟ 850", "ขายของได้ 500"]) {
      const out = await parseOne(text);
      printRow(text, out);
      if (!out.wouldRecord) {
        console.error(`FAIL: "${text}" ถูก block!`);
        process.exitCode = 1;
      }
      await sleep(DELAY_MS);
    }
  }

  console.log("\n========== DONE ==========");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
