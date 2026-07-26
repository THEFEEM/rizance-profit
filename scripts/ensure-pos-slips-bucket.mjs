import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(root, file), "utf8");
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
    // skip
  }
}

const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${key}`,
  apikey: key,
  "Content-Type": "application/json",
};

const listRes = await fetch(`${base}/storage/v1/bucket`, { headers });
const buckets = await listRes.json();
if (!Array.isArray(buckets)) {
  console.error("list buckets failed:", listRes.status, buckets);
  process.exit(1);
}

const existing = buckets.find((b) => b.id === "pos-slips" || b.name === "pos-slips");
if (existing) {
  console.log(`pos-slips exists public=${existing.public}`);
  if (!existing.public) {
    const upd = await fetch(`${base}/storage/v1/bucket/pos-slips`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ public: true }),
    });
    console.log("set public:", upd.status, (await upd.text()).slice(0, 200));
  }
  process.exit(0);
}

const createRes = await fetch(`${base}/storage/v1/bucket`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    id: "pos-slips",
    name: "pos-slips",
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  }),
});
const text = await createRes.text();
console.log("create pos-slips:", createRes.status, text.slice(0, 300));
if (!createRes.ok) process.exit(1);
