import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // ignore
  }
}

const key = process.env.GEMINI_API_KEY;
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
);
const data = await res.json();
for (const m of (data.models ?? []).filter((x) => x.name.includes("flash"))) {
  console.log(m.name, (m.supportedGenerationMethods ?? []).join(","));
}
