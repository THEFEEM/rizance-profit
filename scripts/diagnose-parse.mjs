import { readFileSync } from "node:fs";
import OpenAI from "openai";

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

try {
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    max_tokens: 512,
    tools: [
      {
        type: "function",
        function: {
          name: "record_entry",
          description: "test",
          parameters: {
            type: "object",
            properties: {
              kind: {
                type: ["string", "null"],
                enum: ["income", "expense", null],
              },
              amount: { type: ["number", "null"] },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["kind", "amount", "confidence"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "record_entry" } },
    messages: [{ role: "user", content: 'ผู้ใช้พิมพ์: "ซื้อกาแฟ 100"' }],
  });
  console.log("OK", completion.choices[0]?.message?.tool_calls?.[0]?.function?.arguments);
} catch (err) {
  console.error("ERR", err.message);
  if (err.error) console.error(JSON.stringify(err.error, null, 2));
}
