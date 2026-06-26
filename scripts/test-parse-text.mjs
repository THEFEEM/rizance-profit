// Temporary: POST each phrase to /api/ai/test-parse (dev server must be running).
const BASE = process.env.TEST_PARSE_URL ?? "http://localhost:3000/api/ai/test-parse";

const PHRASES = [
  "ซื้อกาแฟ 100",
  "ขายของได้ 500",
  "จ่ายค่าเช่า 3000 โอน",
  "เมื่อวานซื้อวัตถุดิบ 200",
  "กาแฟ",
  "สวัสดี",
  "จ่ายค่าไฟ 850 บาท",
];

async function main() {
  for (let i = 0; i < PHRASES.length; i++) {
    const text = PHRASES[i];
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => ({}));
    console.log(`\n=== ${i + 1}. ${text} ===`);
    console.log(JSON.stringify(body, null, 2));
    if (!res.ok) {
      console.error(`HTTP ${res.status}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
