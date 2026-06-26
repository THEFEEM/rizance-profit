import { readFileSync } from "node:fs";
import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
} from "@google/generative-ai";

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

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("NO GEMINI_API_KEY");
  process.exit(1);
}

const client = new GoogleGenerativeAI(apiKey);

for (const modelName of ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-flash-latest"]) {
  try {
    const model = client.getGenerativeModel({
      model: modelName,
      tools: [
        {
          functionDeclarations: [
            {
              name: "record_entry",
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  kind: {
                    type: SchemaType.STRING,
                    format: "enum",
                    nullable: true,
                    enum: ["income", "expense"],
                  },
                  amount: { type: SchemaType.NUMBER, nullable: true },
                  confidence: {
                    type: SchemaType.STRING,
                    format: "enum",
                    enum: ["low", "medium", "high"],
                  },
                },
                required: ["kind", "amount", "confidence"],
              },
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: ["record_entry"],
        },
      },
    });
    const result = await model.generateContent('ผู้ใช้พิมพ์: "ซื้อกาแฟ 100"');
    const calls = result.response.functionCalls();
    console.log(`OK ${modelName}:`, JSON.stringify(calls?.[0]?.args));
  } catch (err) {
    console.error(`ERR ${modelName}:`, err.message);
    if (err.errorDetails) console.error(JSON.stringify(err.errorDetails, null, 2));
  }
}
